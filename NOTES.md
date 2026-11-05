# Game Lab - implementation notes

These are the engineering notes behind `README.md`: what each part does, why it
is shaped this way, and the traps measured while building it. API surface and
user-facing behaviour are documented in the README; this file is for the next
person editing the plugin.

## Files

```
package.json        bundle manifest: dsh.bundle.patch + dsh.client (web, immediately)
cordis.patch.yml    inserts row id `game-lab`, name @local/game-lab, with config
index.js            host entry: `inject: ['webServer']`, mounts GameLab + routes
host/emulator.js    GameLab controller: AVD lifecycle, adb, input, install, build
host/frame.js       in-process PNG frame pipeline + multipart writer
host/routes.js      /_dsh/game-lab/* HTTP routes and the loopback/origin fence
host/library.js     APK/Gradle-project scanner, aapt2 metadata, grouping
client.js           the whole page: plain-JS React, sidebar icon + main page
locale/*.json       Plugin Manager display metadata (en, zh)
icon.svg            original gamepad artwork
test/*.mjs          node --test suites (frame, fence, integration, library, locale keys)
```

`client.js` and `host/*.js` are plain ESM/script files with no bundler and no
npm dependencies. `node --check` must pass on all of them; the tests run with
`node --test test/frame.test.mjs test/fence.test.mjs test/integration.test.mjs
host/library.test.mjs` from the plugin directory (44 assertions, ~1 s).

## Host lifecycle

`apply(ctx, config)` creates one `GameLab`, starts its timers and mounts the
routes inside `ctx.effect`. Teardown disposes the routes and `GameLab.dispose()`:
frame loop stopped, build child killed, owned emulator stopped. No emulator is
started at load; `status()` is inert until the page posts `start`.

`GameLab` keeps one emulator slot. `startEmulator`:
1. if a device is already online, **adopt** it (`owned: false`) instead of
   booting a second emulator;
2. otherwise ensure the AVD exists (auto-create from the newest installed
   x86_64 system image via `avdmanager`, then patch `config.ini`), spawn it
   detached headless, and poll `adb devices` for a *new* emulator serial;
3. poll `getprop sys.boot_completed` until 1, then persist resolution from
   `wm size` and start the frame loop.

The launcher is intentionally detached and not reaped: if the host process is
restarted the emulator keeps running, the plugin re-adopts it on the next
`start`, and the desktop `emulator-watchdog.ps1` is the second safety net
(it force-closes idle `-no-window` emulators). `stopEmulator` uses
`adb emu kill` first and only then `taskkill /T /F` on the spawned pid. A
hard kill of the host-side frame child is followed by
`sh pkill -f screencap` on the device, otherwise device-side screencap shells
can accumulate.

## Frame pipeline (`host/frame.js`)

One persistent `adb -s <serial> exec-out "while :; do screencap -p; sleep X; done"`
child produces back-to-back PNGs. `PngFrameSplitter` cuts frames by walking PNG
chunk headers (signature, length/type/CRC, until IEND) - never by scanning image
data, so a marker inside pixels cannot cut a frame; on desync it drops to the
next signature. `FrameLoop` keeps the latest frame, a rolling 3 s fps estimate,
and a listener set. Routes write the newest frame as
`multipart/x-mixed-replace` (Chromium renders it in an `<img>` like MJPEG);
backpressure is latest-wins so a slow tab cannot grow an unbounded buffer.

**Measured trap:** on this machine `screencap -p` at 720x1280 costs ~1.0-1.2 s
per frame (≈0.7-1.6 fps), raw `screencap` ~0.5-0.7 s, and `screenrecord`
H.264 was not usable as a drop-in stream. The plugin therefore does not promise
a smooth view; `maxFps`/`intervalMs` only affect pacing when capture is fast
enough, which it is not at this resolution. The way to a 30-60 fps view is a
different source (scrcpy-server H.264 consumed with WebCodecs), which is why
`FrameLoop` is a separate module with a narrow interface.

Frame production is **demand driven**: `openStream`/`framePng`/heartbeat set a
demand deadline; `#tickFrames` stops the loop when there are no consumers and
the deadline passed (60 s after the last reader). This is what keeps CPU near
zero when the page is hidden even if the emulator must stay up.

## Input

Coordinates are normalized 0..1 of the current frame and converted with the
latest frame dimensions (fallback `wm size`); the client does the same
letterbox math from the `<img>` object-fit box, so the two agree for portrait
and landscape. Keys map to `KEYCODE_*`; text is ASCII-only (`input text`,
spaces as `%s`) because there is no ADBKeyboard installation. `rotate` sets
`accelerometer_rotation 0` + `user_rotation`; a manifest-locked landscape game
ignores it, which is correct Android behaviour.

## Install / launch / build

`adb install -r -g <apk>`, then metadata from `aapt2 dump badging` when
available (fallback: before/after diff of `pm list packages -3`).
`aapt2` reports the launchable activity as a bare class name
(`com.pkg.MainActivity`); `am start -n` needs `package/class`, so
`normalizeComponent()` converts it. Without that conversion the launch fails
silently while the APK is installed - the first Shadowmire run showed exactly
that (install OK, launcher still foreground). `#launchPackage` now checks the
`am start -W` output for `Error`, falls back to a `monkey` category launch, and
throws if both fail, so `/install` cannot report `launched: true` for a launch
that did not happen.

`buildProject` runs `<project>/gradlew.bat assembleDebug --console=plain`
through `cmd /c` in the project directory (JAVA_HOME inherited,
`ANDROID_HOME` from the resolved SDK), keeps the last 400 log lines, then finds
the newest `*.apk` under `build/outputs` produced after the build started and
installs+launches it. A fully up-to-date Gradle run writes **no** APK, so when
no fresh file exists the installer falls back to the newest existing APK under
`build/outputs` and logs that it did so (the first build test failed with
"no new APK" before this fallback; the retry succeeded: build 2 s, install and
launch confirmed in the foreground). If the emulator is off when a build is
requested, the plugin starts it in parallel and waits up to 150 s for it before
the install step, so "Build & play" is one click. The idle timer must not stop
the emulator while a build is running (a build can outlast `idleMinutes`); that
is enforced in `#tickIdle`.

## Library scanner (`host/library.js`)

Walks the configured roots depth-first (bounded depth, symlinks not followed).
Skip list: `node_modules .git .gradle .idea .vs .dart_tool __pycache__ .venv
venv .pnpm-store obj .godot .next dist coverage .agents` - but a `build`
directory is kept because release/debug APKs live in `build/outputs` (only
`intermediates tmp .transforms kotlin` inside it are skipped). 281 APKs and 5
Gradle projects were found in `C:\dev\dsh-workspace` + `Deliverables` in ~95 ms.
APKs are grouped by file name with trailing version tokens stripped (known
variant words like `debug`, `preview`, `painted` also stripped; unknown words
kept). aapt2 is not run for every APK - metadata is filled at install time into
`installedInfo` and merged into later scans, and only small scans (≤12 APKs)
are enriched eagerly.

## Routes and fence (`host/routes.js`)

One prefix route (`/_dsh/game-lab`) on `ctx.webServer`. Every request must come
from a loopback socket with a loopback `Host`; POSTs additionally need a
same-origin `Origin` (and `sec-fetch-site` must not be `cross-site`). Body is
bounded JSON (64 KiB). Errors are `{ok:false, code, error}` with a hint, never
an unhandled throw. The start/stop actions answer `202` immediately and the page
polls `/status`; install/build/input answer when done. `/stream` is the only
long-lived response and is torn down on socket close.

## Resource sampling

Every 12 s while online, a single PowerShell `Get-CimInstance
Win32_PerfFormattedData_PerfProc_Process` call sums `WorkingSet` (bytes ->
MB) and `PercentProcessorTime` for `qemu-system*`/`emulator*`. CPU is per-one-
core and can exceed 100 on a 2-vCPU emulator; the page shows it as-is. If
PowerShell is unavailable the readouts stay null; nothing else depends on it.

## Live reload semantics (verified)

- Installing the bundle was applied live; the host routes answered immediately.
- The **client** half registered in the already-connected page
  (`main#game-lab` and `sidebar.panellist#game-lab` occupants) without a manual
  restart.
- After editing a host module, toggling the row
  (`plugin_manager set_plugin include:game-lab enabled:false` then `true`)
  re-evaluated the module - verified by changing an exported `HOST_BUILD`
  marker and reading it back from `/status`. No app restart was needed. Editing
  only `client.js` needs a page reload, not a host restart.

## AVD / disk traps (measured)

- The AVD created by the lab script had `disk.dataPartition.size = 6G` (the
  script did not patch that key) and grew from ~1 MB to ~3.8 GB after the first
  boot. The plugin's auto-create writes `disk.dataPartition.size = 2G`,
  `fastboot.forceColdBoot = yes`, `-no-snapshot` launches, and 720x1280/320dpi
  so a fresh `gamelab` stays smaller. It is still a real Android userdata
  partition; a couple of GB is unavoidable without `-wipe-data`-style resets.
- API 34 `google_apis` raises guest RAM to ~2.5 GB even with `-memory 2048`,
  which is why host qemu working set is ~3.1-3.7 GB. A lighter (AOSP/ATD)
  image or lower resolution is the lever for less RAM/CPU; do not claim the
  configured `ramMb` as the host footprint.

## Things not to re-learn the hard way

- `adb exec-out` is required for binary frames; `adb shell` may translate
  newlines and corrupt PNGs.
- Never block the Node event loop while a frame child streams; the lab's first
  throughput run read 0 frames because a synchronous sleep starved the stdout
  callbacks. Use async streams/timers.
- A game can be installed but not foregrounded. Always verify the component
  string and the `am start` result.
- A `-kill <pid> -sleep 20` `emulator.exe` process can linger for ~20 s after
  `emu kill`; it is the shutdown helper, not a second emulator.
- Another session on the same machine can hold adb/emulator state (this box
  runs multiple agents). Adopt an existing online emulator instead of booting
  another, and never kill emulators or processes you did not start.
- A DSH restart/profile repair can reset the profile's `dsh.profile.bundles`
  list to only the base bundles while the packages stay linked. The plugin then
  disappears (404 on its routes) until the bundle is re-selected
  (`plugin_manager set_bundle target: @local/game-lab enabled: true`), which
  applies live - no reinstall and no new dependency needed. This happened once
  during development (app restarted at 12:39, profile bundles reset).
