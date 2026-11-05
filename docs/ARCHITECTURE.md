# Architecture

Game Lab has two halves that never share memory beyond the DSH webserver
routes: a **Client** page rendered by the Harness Web UI, and a **Host**
controller running in the DSH host process. The host is the only side that
speaks adb; the browser never sees an adb port.

```
+----------------------------- DSH Web UI ------------------------------+
|  client.js                                                            |
|  GameLabPage ── status poll ── games library ── live view             |
|       │  fetch /stream (PNG multipart)                                 |
|       │  fetch /stream.h264 (Annex-B) -> WebCodecs -> <canvas>         |
|       │  POST /input, /install, /build, /emulator, /heartbeat          |
+-------------------------------│----------------------------------------+
                                │ same-origin HTTP on the DSH origin
+-------------------------------▼----------------------------------------+
|  host/routes.js   loopback + Origin fence, JSON envelopes, streams     |
|       │                                                                |
|  host/emulator.js  GameLab: one emulator slot, state, timers, builds  |
|       ├── host/frame.js   screencap PNG -> splitter -> multipart       |
|       ├── host/video.js   screenrecord H.264 -> NAL stats -> bytes     |
|       ├── host/library.js APK/project scan + aapt2 metadata            |
|       ├── host/build.js   Gradle/Capacitor plan + APK search           |
|       └── adb ▸ emulator  (headless AVD "gamelab")                     |
+-------------------------------------------------------------------------+
```

## Host lifecycle

`index.js` declares `inject: ['webServer']` and, inside `ctx.effect`:

1. creates one `GameLab` (from `host/emulator.js`) with the bundle config;
2. calls `lab.begin()` (timers + initial toolchain note);
3. mounts `host/routes.js` on `ctx.webServer`;
4. on teardown disposes the routes and calls `lab.dispose()` (kills child
   processes, closes streams, stops an owned emulator).

Nothing is booted at plugin load. `/status` is cheap and inert until the page
posts `{action:'start'}`.

### Emulator state machine

```
off ──start──▶ booting ──boot_completed=1──▶ online ──stop/idle──▶ stopping ──▶ off
  ▲               │                                              │
  └────error──────┴──────────────────────────────────────────────┘
```

`startEmulator`:

1. shows `booting` immediately and increments a generation counter (older
   boot attempts become no-ops);
2. **adopts** an already-online emulator if one exists, instead of booting a
   second one. Adopted devices are marked `owned:false` but can still be
   stopped with `adb emu kill`;
3. otherwise ensures the AVD exists. A missing AVD is created with
   `avdmanager` from the newest installed x86_64 system image, then its
   `config.ini` is patched (`hw.lcd` 720x1280/320, RAM, vCPU, host GPU,
   `disk.dataPartition.size=2G`, cold boot, no snapshots);
4. spawns the emulator detached and headless:
   `-no-window -no-audio -no-boot-anim -no-snapshot -gpu <mode> -memory <ram>
   -cores <n> -no-metrics`;
5. waits for a *new* emulator serial in `adb devices`, then polls
   `getprop sys.boot_completed` until 1 (bounded by `bootTimeoutMs`);
6. calls `#markOnline`: records resolution from `wm size`, prepares the device
   (`svc power stayon true`, long screen timeout, dismiss keyguard, WAKEUP),
   starts the PNG frame loop and samples resources.

Stop path: `adb emu kill`, wait up to 10 s for the serial to disappear, then
`taskkill /T /F` on the spawned launcher as a last resort. Device-side
`screencap`/`screenrecord` shells are cleaned up (`pkill -f screencap`) when a
loop is stopped so a closed page leaves no work behind.

A periodic leftover check adopts an online emulator whose **AVD name matches
the configured one** (e.g. after a DSH restart) instead of ignoring it.

## Live view paths

There are two independent frame sources; the page uses one at a time.

### Compat: PNG (`host/frame.js`)

- One persistent `adb -s <serial> exec-out "while :; do screencap -p; done"`
  child emits back-to-back PNGs.
- `PngFrameSplitter` cuts frames by walking PNG chunk headers (signature,
  length/type/CRC, until IEND), never by scanning image data. On desync it
  drops to the next signature.
- `/stream` writes the newest frame as `multipart/x-mixed-replace`, latest-wins
  so a slow client drops frames instead of queueing. `/frame.png` returns one
  frame (screenshot button).
- Measured cost at 720x1280 on the test host: about 1.0-1.2 s per frame
  (~0.7-1.6 fps). This is the fallback, not the default.

### Smooth: H.264 + WebCodecs (`host/video.js` + client)

- One persistent
  `adb -s <serial> exec-out screenrecord --output-format=h264 --bit-rate 6000000
  --time-limit 180 -` child streams raw Annex-B bytes.
- `H264Stats` counts VCL NALs/sps/pps and computes fps/kbps for `/status`.
- `/stream.h264` has exactly one viewer. Every new stream restarts the
  screenrecord child so the decoder always starts at SPS/PPS + IDR.
- The client parses NALs across chunk boundaries, derives
  `avc1.<profile><constraints><level>` from the SPS, configures
  `VideoDecoder({codec, optimizeForLatency:true})`, feeds one
  `EncodedVideoChunk` per VCL NAL (SPS+PPS included on keyframes) and draws
  each decoded `VideoFrame` to a canvas. Pointer coordinates use the decoded
  frame dimensions, so portrait/landscape mapping stays correct.
- Backpressure: `res.write()` returning false is normal (a 20 KB keyframe
  chunk exceeds the socket high-water mark). The loop keeps writing; only a
  client with more than 8 MB queued is disconnected so it can reconnect for a
  fresh keyframe.
- `screenrecord` stops at 180 s; the controller restarts it and the same HTTP
  response keeps flowing (new SPS/PPS + keyframe).
- Frames are produced when the display content changes. A static menu can send
  one frame for seconds; a moving game measured ~19 fps. This is MediaCodec
  behaviour, not a bug.

Both paths are demand-driven: `openStream`/`openVideoStream`/`heartbeat` set a
deadline; ticks stop the child when no consumer is left and the deadline has
passed.

## Game library (`host/library.js`)

- Walks `gameRoots` depth-first (default depth 5, symlinks not followed).
- Skip list: `node_modules .git .gradle .idea .vs .dart_tool __pycache__ .venv
  venv .pnpm-store obj .godot .next dist coverage .agents`. A `build` folder is
  kept (APKs live in `build/outputs`), but its bulky children (`intermediates`,
  `tmp`, `.transforms`, `kotlin`) are skipped.
- `*.apk` files up to 300 MB become `games`; grouping strips trailing version
  tokens and known variant words (`debug`, `release`, `preview`, `online`,
  `painted`, ...). Newest per group is `isLatest`; `versions` counts the group.
- Gradle projects are directories with `settings.gradle(.kts)` **and** a
  `gradlew`/`gradlew.bat`. APKs inside `build/outputs` link back to the nearest
  project (`projectPath`, `fromBuild`).
- aapt2 metadata is lazy: never for all APKs during a scan (60+ builds would be
  slow), only at install time and for small scans (<=12 APKs), then merged
  back through the controller's `installedInfo` cache.

## Build & play (`host/build.js`)

`detectBuildPlan(projectPath)` walks from the selected directory (usually
`<app>/android`) up to the JavaScript app root, reads `package.json` and
Capacitor config, and returns ordered steps:

| layout | steps |
|---|---|
| plain Gradle | `gradlew assembleDebug` |
| Capacitor with `android:apk` script | `npm run android:apk` (the project's own web build + cap sync + Gradle) |
| other Capacitor | `npm run build`, `npx --no-install cap sync android`, `gradlew assembleDebug` |

The controller runs the steps sequentially through `cmd /c` (Windows) or
`sh -c`, captures the log, enforces a 12-minute per-step timeout, reports
`kind`/`phase`/`stepIndex` in `/status`, then searches the plan's
`searchRoots` for the newest APK. A fully up-to-date Gradle build writes no
APK, so it falls back to the newest existing one. The idle timer skips while a
build is running; the install step waits up to 150 s for an emulator that is
still booting.

## Input

`/input` accepts tap, swipe, key, text and rotate. Coordinates are normalized
0..1 and converted with the latest frame/decoded dimensions. Keys map to
`KEYCODE_*`; text is ASCII-only (`input text`, spaces as `%s`) because the AVD
has no ADBKeyboard. Rotation sets `accelerometer_rotation 0` +
`user_rotation`; manifest-locked games ignore it (correct Android behaviour).

## Routes and security fence

All routes live under `/_dsh/game-lab` on the existing DSH webserver. The fence
is applied per request:

- transport peer must be loopback (`127.0.0.1`, `::1`, mapped IPv4);
- `Host` must be a loopback hostname;
- `sec-fetch-site: cross-site` is refused;
- POSTs require an `Origin` whose host:port equals the request `Host`.

Body size is capped at 64 KiB and parsed as JSON; errors are
`{ok:false, code, error}`. `/stream` and `/stream.h264` are GET-only and
long-lived; `/frame.png` is a single PNG. No CORS headers, no extra listening
port.

## Status and resources

`/status` is a snapshot derived from controller memory. It contains the
emulator state, resolution, fps, idle deadline, RAM/CPU (sampled every 12 s
with one PowerShell CIM query for `qemu*`/`emulator*`), video statistics, build
state, public config and a short notes ring. The page polls every 2.5 s
(1 s while booting) and sends `/heartbeat` every 10 s only while it is visible.

## Client implementation notes

- The page is plain-JS React (`h()` calls, no JSX) loaded through
  `window.__ModuleLoader__.load`. It registers `main#game-lab` and
  `sidebar.panellist#game-lab` through `ctx.slots.inject/register`.
- All styling uses `--dsw-alias-*` theme tokens; icons are inline SVG.
- `useH264View` owns the fetch/decoder lifecycle and falls back by calling the
  page's `onFatal`, which switches to Compat and persists that choice.
- Visibility is `document.visibilityState === 'visible'` **and** an
  IntersectionObserver on the page root, so a hidden tab stops the streams.
- Pointer coordinates are normalized to the visible content box (object-fit
  contain), not to the element rectangle, for both `<img>` and `<canvas>`.
