# Engineering notes

Implementation notes for people changing Game Lab: what each part does, why it
is shaped this way, and the traps measured while building it. User-facing
behaviour lives in `README.md`; the deep design is in `docs/ARCHITECTURE.md`.

## Files

```
package.json        bundle manifest: dsh.bundle.patch + dsh.client (web, immediately)
cordis.patch.yml    inserts row id `game-lab`, name @local/game-lab, with config
index.js            host entry: inject ['webServer'], mounts GameLab + routes
host/emulator.js    GameLab controller: AVD lifecycle, adb, input, install, build
host/frame.js       in-process PNG frame pipeline + multipart writer
host/video.js       screenrecord H.264 loop + NAL statistics
host/build.js       Gradle / Capacitor build-plan detection
host/routes.js      /_dsh/game-lab/* HTTP routes and the loopback/origin fence
host/library.js     APK/Gradle-project scanner, aapt2 metadata, grouping
client.js           the whole page: plain-JS React, sidebar icon + main page
locale/*.json       Plugin Manager display metadata (en, zh)
icon.svg            original gamepad artwork
test/*.mjs          node --test suites (portable fixtures + optional real-APK tests)
docs/               architecture, install, configuration, API, development, verification
assets/             icon, architecture diagram, live-view screenshot
```

No bundler, no runtime npm dependencies. `node --check` must pass on every host
file and `client.js`.

## Host lifecycle

`apply(ctx, config)` creates one `GameLab`, starts its timers, mounts the routes
inside `ctx.effect`, and disposes everything on teardown (routes, streams,
build child, emulator). Nothing boots until the page posts `{action:'start'}`.

`startEmulator` sets `booting` synchronously, then either adopts an already
online emulator or ensures/spawns the configured AVD, waits for a new serial,
polls `sys.boot_completed`, and calls `#markOnline`. A generation counter makes
stale boot loops no-ops after stop/restart. AVD auto-create uses the newest
x86_64 system image and patches only the newly written `config.ini`; it never
rewrites an existing user AVD.

The launcher is detached: a DSH restart does not kill the emulator, and a
periodic leftover check re-adopts it only when `ro.boot.qemu.avd_name` matches
the configured AVD. The desktop `emulator-watchdog` is a second safety net for
headless `-no-window` emulators.

Stop path: `adb emu kill`, wait for the serial to disappear, then
`taskkill /T /F` on the spawned launcher if needed. Device-side
`screencap`/`screenrecord` shells are cleaned up when a loop stops.

## PNG frame pipeline (`host/frame.js`)

One persistent `adb exec-out "while :; do screencap -p; done"` child emits
back-to-back PNGs. `PngFrameSplitter` walks chunk headers (signature, length +
type + CRC until IEND); it never scans image data for markers. On desync it
drops to the next signature. `MultipartFrameWriter` is latest-wins: a slow
socket skips frames instead of queueing.

**Measured trap:** `screencap -p` at 720x1280 costs ~1.0-1.2 s per frame on the
test host (~0.7-1.6 fps). The PNG path is the compatibility fallback, not a
smooth view. Raw `screencap` is ~2.5x faster but still far from smooth.

Frame production is demand-driven: streams/screenshots/heartbeats set a
deadline; `#tickFrames` stops the child after the deadline with no consumers,
and `/frame.png` warms it again.

## H.264 smooth view (`host/video.js`)

One persistent
`adb exec-out screenrecord --output-format=h264 --bit-rate 6000000 --time-limit 180 -`
child; raw Annex-B bytes fan out to the single `/stream.h264` viewer.
`H264Stats` counts VCL NALs and SPS/PPS for status. `/stream.h264` stops any old
loop before starting, so every stream begins with SPS/PPS + IDR. The client
parses NALs across chunk boundaries, derives
`avc1.<profile><constraints><level>` from SPS, feeds `EncodedVideoChunk`s to
WebCodecs and draws frames to a canvas.

Measured behaviour and traps:

- **Frames flow when the picture changes.** Continuous scrolling produced 114
  frames in 6 s (~19 fps); a static game board produced 1-2 frames over many
  seconds. That is MediaCodec/surface behaviour, not a plugin bug, and it is
  why the fps readout can be low on a static screen.
- **Never treat `res.write() === false` as a dead socket.** A 20 KB SPS+IDR
  chunk exceeds the 16 KB high-water mark; the first implementation closed the
  response after the first keyframe (curl got exactly ~21 KB). Node buffers
  the rest; only a client with > 8 MB queued is disconnected so it can
  reconnect for a fresh keyframe.
- **One viewer, fresh encoder.** A second viewer gets 409 `video_busy`; the page
  retries briefly. This avoids mid-GOP joins the decoder cannot configure.
- **`--time-limit` is real.** The controller restarts screenrecord after
  180 s; the same HTTP response continues with new SPS/PPS + keyframe.
- **The display must stay awake.** `#prepareDevice()` runs
  `svc power stayon true`, an effectively infinite screen timeout, dismisses the
  keyguard and sends WAKEUP after boot/adopt. A sleeping display freezes both
  the game and screenrecord.
- **Validate with ffmpeg only after trimming the last partial NAL** of an
  aborted capture; tail errors ("Invalid level prefix") are expected. After
  trimming, the same capture decoded all frames cleanly.

## Build & Play (`host/build.js`)

The selected row is usually `<app>/android`; detection walks up to the app root
and reads `package.json` + Capacitor config. Plans:

- plain Gradle: `gradlew assembleDebug`;
- Capacitor with `android:apk` script: run it verbatim (web build + cap sync +
  Gradle);
- other Capacitor: `npm run build`, `npx --no-install cap sync android`,
  `gradlew assembleDebug`.

`#runBuildPlan` runs steps sequentially through `cmd /c` (`sh -c` elsewhere),
keeps 500 log lines, enforces a 12-minute per-step timeout, reports
`kind/phase/stepIndex` in `/status`, then searches the plan's `searchRoots` for
the newest APK. An up-to-date Gradle run writes no APK, so the newest existing
one is used and logged. The install step waits up to 150 s for an emulator that
is still booting; `#tickIdle` skips while a build is running.

The old Gradle-only path installed APKs with stale web assets for Capacitor
games - this was a correctness fix, not just convenience.

## Install / launch

`adb install -r -g <apk>`, then metadata from `aapt2 dump badging` when
available (fallback: before/after diff of `pm list packages -3`). aapt2 reports
the launchable activity as a bare class name (`com.pkg.MainActivity`);
`am start -n` needs `package/class`, so `normalizeComponent()` converts it.
Without that conversion the launch failed silently while the APK installed.
`#launchPackage` checks `am start -W` output for `Error`, falls back to a
`monkey` category launch, and throws if both fail so `/install` cannot report
`launched:true` for a launch that did not happen.

## Library scanner (`host/library.js`)

Walks `gameRoots` depth-first (bounded, symlinks not followed). Skip list:
`node_modules .git .gradle .idea .vs .dart_tool __pycache__ .venv venv
.pnpm-store obj .godot .next dist coverage .agents`; a `build` folder is kept
because APKs live in `build/outputs` (only `intermediates tmp .transforms
kotlin` inside it are skipped). APKs are grouped by filename with trailing
version tokens (and known variant words) stripped. aapt2 metadata is lazy: only
at install time and for scans of <= 12 APKs; the controller merges remembered
metadata into later scans.

## Routes and fence

One prefix route (`/_dsh/game-lab`) on `ctx.webServer`. Every request must come
from a loopback socket with a loopback `Host`; POSTs additionally require the
same-origin `Origin` (and `sec-fetch-site` must not be `cross-site`). Bodies are
64 KiB JSON. Errors are `{ok:false, code, error}`. `/stream` and
`/stream.h264` are long-lived GETs; `/frame.png` is one PNG. No extra port, no
CORS headers, no adb in the browser.

## Resource sampling

Every 12 s while online, one PowerShell
`Get-CimInstance Win32_PerfFormattedData_PerfProc_Process` call sums
`WorkingSet` (bytes -> MB) and `PercentProcessorTime` for `qemu-system*` /
`emulator*`. CPU is per one core and can exceed 100 on a 2-vCPU emulator. If
PowerShell is unavailable the readouts stay null; nothing else depends on it.

## Live reload semantics (verified)

- Installing the bundle applies live; routes answer immediately.
- The client half registers in the already-connected page (`main#game-lab`,
  `sidebar.panellist#game-lab`) once the page loads; a brand-new client plugin
  needs a page reload.
- After editing a host module, toggling the row
  (`plugin_manager set_plugin target: include:game-lab enabled:false` then
  `true`) re-evaluates it. `HOST_BUILD` in `host/emulator.js` is a marker to
  prove which generation is live. No app restart was needed.
- Editing only `client.js` needs a page reload, not a host restart.
- A DSH profile reset can drop `dsh.profile.bundles` to the base bundles while
  the package stays linked. Re-select with
  `plugin_manager set_bundle target: @local/game-lab enabled: true`.

## Traps to remember

- `adb exec-out` is required for binary frames; `adb shell` may translate
  newlines and corrupt PNGs.
- Never block the Node event loop while a frame child streams (a synchronous
  sleep starves stdout callbacks and looks like 0 frames).
- A screenrecord capture can start only when content changes; test with motion.
- A `-kill <pid> -sleep 20` `emulator.exe` process can linger ~20 s after
  `emu kill`; it is the shutdown helper, not a second emulator.
- Other sessions/agents can hold adb/emulator state. Adopt an online emulator
  instead of booting another, and never kill emulators you did not start.
- Idle Gradle/Kotlin daemons can hold several GB. They are compiler daemons, not
  user apps, and restart cheaply when the emulator needs RAM.
- A capture file with a truncated final NAL is not evidence of a corrupt live
  stream; trim it before decoding.
