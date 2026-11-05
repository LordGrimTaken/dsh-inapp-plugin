# Game Lab - an in-app Android emulator for testing the games you build

Game Lab puts a game-testing Android emulator **inside the DeepSeek Harness app**.
Open the page, press **Start emulator**, pick one of your game APKs (or a Gradle
game project) and play it on the live screen - no MEmu, BlueStacks, LDPlayer or
Android Studio needed to try a build, and no second application to keep open.

It is a normal DSH plugin: a sidebar icon plus a full page in the Web UI, a
host-side controller, and webserver routes under `/_dsh/game-lab/*`. The plugin
uses the Android SDK already on the machine; it does not bundle or install a new
emulator engine.

**v1.1** adds a smooth H.264/WebCodecs live view (with automatic PNG fallback),
Capacitor-aware **Build & play**, a keyboard panel for text fields, and an
always-awake emulator display so games do not freeze on a lock screen.

```
left sidebar:  [gamepad icon] Game Lab
```

## What it does

- **Boots a lean, headless AVD on demand.** The AVD (`gamelab` by default) is
  launched with `-no-window -no-audio -no-boot-anim -no-snapshot`, 720x1280,
  2 vCPU at most, host GPU. No visible emulator window ever appears. It is
  auto-created from an installed x86_64 system image the first time the AVD
  named in the config is missing.
- **Streams the real screen smoothly.** The default **Smooth** mode takes the
  emulator's H.264 encoder stream (`screenrecord`) and decodes it with WebCodecs
  in the page: measured ~19 fps while the screen content changes, at roughly
  0.1-1.0 Mbps. **Compat** mode is the original PNG stream (~1 fps) and is used
  automatically if WebCodecs or the H.264 stream is unavailable. Bytes are
  served from the DSH webserver - no extra port, no adb in the browser. The
  page forwards **taps, swipes, Back/Home/Recents, rotation, keys and typed
  ASCII text** straight to the device.
- **Finds your games**: scans the configured folders for `*.apk` files, groups
  builds by name (newest expanded, older builds under "N builds"), and lists
  Gradle game projects. **Play** installs the APK and launches it. **Build &
  play** detects the project type: a plain Gradle project runs
  `gradlew assembleDebug`; a **Capacitor** game runs its own `android:apk`
  script if present, otherwise `npm run build` + `npx cap sync android` +
  `gradlew assembleDebug`, then installs and launches the resulting APK. This
  means the APK carries the current web bundle instead of stale assets.
- **Keeps the machine free**: the live streams only run while the page is
  watching, and the emulator stops itself after 5 minutes without a heartbeat
  or input (configurable). While it runs, the plugin keeps the emulator display
  awake so a game cannot freeze behind the lock screen. Close the page, walk
  away - RAM comes back.
- **Readouts**: state, AVD, resolution, live fps, emulator RAM/CPU, idle
  countdown and uptime; logcat tail per game; one-click PNG screenshot; a
  **Keyboard** panel for text fields inside the game.

## Measured on this machine (2026-11-05)

| fact | value |
|---|---|
| cold boot to usable Android (start -> `sys.boot_completed=1`) | **36-50 s** |
| ADB online (start -> `adb devices` shows the device) | 24-32 s |
| emulator host memory (qemu working set, 720x1280, API 34 google_apis) | **~3.1-3.7 GB** |
| emulator host CPU while online and streaming | **~2.1-2.4 cores** (~13-15 % of a 16-thread CPU) |
| smooth live view (H.264 via WebCodecs) | **~19 fps** while the screen changes (114 decoded frames / 6 s of scrolling), ~0.1-1.0 Mbps |
| compatibility live view (PNG screencap) | ~0.7-1.6 fps (~1.0-1.2 s/frame) |
| tap round trip (POST -> `input tap` -> 200) | ~0.7 s |
| install + launch an APK (9.6 MB Shadowmire) | 3.7 s |
| install + launch (6.0 MB Little Lanterns) | 14.0 s |
| AVD disk after first boot | ~3.8 GB logical (sparse; includes userdata/cache) |
| build & play, plain Gradle project, emulator off at start | **66.6 s total**: emulator boot ~45 s, `assembleDebug` 2 s (up to date), install + launch |
| build & play, Capacitor game (`npm run android:apk` = web build + cap sync + Gradle) | **71.4 s total** from emulator-off, Gradle part 37 s, current web bundle installed |
| idle auto-stop | fired after the 5-minute window; state returned to `off`, host RAM went from ~3.5 GB used to ~6 GB free |
| host tests | **25 pass** (`node --test` in the plugin dir) |

## Try it now

1. In the left sidebar, click the **Game Lab** icon (a gamepad; it sits after
   the browser icon). If it is not there yet, reload the page once - the client
   half is served on page load.
2. Press **Start emulator**. First boot takes ~40-50 s (progress bar + status).
3. Pick a game in the left list and press **Play** (or **Build & play** for a
   Gradle or Capacitor project). The screen appears on the right; click/drag it
   to interact; the toolbar has Back/Home/Recents, rotate, screenshot and a
   **Smooth/Compat** view toggle, plus a **Keyboard** panel for text fields.
4. When you are done, press **Stop emulator** - or just close the page; it
   stops itself after 5 minutes of no activity.

The **Smooth** view is the default. `screenrecord` emits frames when the screen
content changes, so a moving game updates at roughly 10-20 fps while a static
menu may only refresh when something changes (that is also when the picture
matters). Touch input is fast and reliable, and screenshots are exact. If
WebCodecs or the H.264 stream fails, the page automatically switches to the PNG
**Compat** view, so the emulator remains usable.

The RAM figure is the real cost while the emulator runs. It is the Android 14
system image's minimum (~2.5 GB guest) plus QEMU overhead; the plugin cannot
lower it further without a lighter system image. That is why the plugin boots
on demand and stops on idle instead of running from app start.

## Install / uninstall

Installed in the `desktop` profile already. To reinstall after moving the
directory:

```text
plugin_manager install_bundle target: C:\Users\Austin\dsh-plugins\game-lab
plugin_manager remove_bundle  target: @local/game-lab
```

The page appears after the next page load / app launch (client half), the host
half activates through the profile loader. Toggling the row (or editing the
config) restarts the host plugin without restarting the app.

## Configuration

The bundle patch inserts one row:

```yaml
- insert:
    - id: game-lab
      name: '@local/game-lab'
      config:
        avdName: gamelab        # AVD this page owns; created if missing
        ramMb: 2048             # guest RAM request (image may raise its own floor)
        cores: 2                # vCPU count
        gpuMode: host           # host | swiftshader_indirect | auto
        maxFps: 8               # frame-loop pacing cap (device capture is slower)
        idleMinutes: 5          # auto-stop after this long with no page/input
        gameRoots:              # where Play/build finds your games
          - C:\dev\dsh-workspace
          - C:\Users\Austin\Deliverables
        bootTimeoutMs: 240000   # hard boot bound
        sdkDir: null            # optional; auto-detected from ANDROID_HOME
```

Override the row's `config` in the profile's own `cordis.patch.yml` (same
`id: game-lab`, name `@local/game-lab`). Saving a config change restarts the
plugin row, which also stops a running emulator; the page re-reads the config
from `/status`.

## API (used by the page; all loopback + same-origin fenced)

`GET /_dsh/game-lab/status`, `GET /games`, `GET /frame.png`,
`GET /stream` (multipart PNG), `GET /stream.h264` (raw Annex-B H.264),
`GET /logs?packageName=&lines=`,
`POST /emulator` `{action:'start'|'stop', avd?}`, `POST /install` `{path}`,
`POST /launch` `{packageName}`, `POST /build` `{projectPath}`,
`POST /input` (tap/swipe/key/text/rotate, normalized 0..1 coordinates),
`POST /heartbeat`. Every POST requires the same-origin `Origin` header, and all
routes require a loopback peer + loopback Host header. Nothing is exposed on
the network. `/stream.h264` accepts one viewer at a time and always starts a
fresh encoder so the decoder receives SPS/PPS and a keyframe.

## Verified

- [x] Live host plugin in the running app; routes answer through the DSH
      webserver (`/status`, `/games`, `/frame.png`).
- [x] Client half registered live: `main#game-lab` page and
      `sidebar.panellist#game-lab` icon (order 25) are active occupants.
- [x] Boot and shutdown through the page API, including progress reporting:
      start -> `booting` with progress -> `online` (36-50 s), stop -> `off`.
- [x] Game found by the library scan (2026-11-05: 281 APKs, 5 Gradle
      projects), APK installed and launched (`Shadowmire 0.7.0`,
      `LittleLanterns 3.02`) - foreground activity confirmed with
      `dumpsys window`.
- [x] Live frame stream and `/frame.png` return the real screen; a frame of
      Shadowmire's title screen and of its guided duel were captured, and a tap
      sent through `POST /input` advanced the game to "Turn 1 - your move".
- [x] Landscape: Little Lanterns forced 1280x720; the stream and status
      resolution followed it. Rotate is a device setting and a
      landscape-locked game keeps its orientation (expected).
- [x] **Smooth H.264 stream**: `GET /stream.h264` produced a valid Annex-B
      stream (SPS/PPS/IDR + P frames) while the screen was scrolling -
      **114 frames in 6 s (~19 fps)**, ~0.7 MB, decoded cleanly by ffmpeg
      after trimming the final partial NAL of the aborted capture. A static
      game screen correctly sends only a few frames until something changes.
- [x] **Capacitor build & play**: `gravebound/android` was detected as a
      Capacitor app and ran `npm run android:apk` (web build + `cap sync` +
      Gradle), with the page polling `phase`/`step`; `BUILD SUCCESSFUL in 37 s`
      and the app was installed and launched - 71.4 s total from an emulator
      that was off.
- [x] **Display stays awake**: after boot `screen_off_timeout=2147483647`,
      `mStayOn=true`, `mWakefulness=Awake`; games cannot freeze behind a lock
      screen.
- [x] **AVD data persists**: Shadowmire and Little Lanterns were still
      installed after stopping and rebooting the emulator.
- [x] **Idle auto-stop**: after the 5-minute window with no heartbeat/input the
      plugin stopped the emulator itself (`idle timeout` -> `stopped (idle)`),
      the device disappeared and host free RAM returned from ~1.7 GB to 6 GB.
- [x] logcat tail through `GET /logs`.
- [x] **25 host unit/integration tests pass** (`node --test` in the plugin
      dir), including H.264 stats, the Capacitor build-plan detection, the
      route fence and the APK/library scanner.

## Not verified (be honest)

- [ ] **Visual rendering of the page** itself (no browser control in this
      session): slot registration and an offline/online/booting/error render
      smoke test are confirmed, but light/dark appearance and the exact layout
      have not been seen by the author. The page is plain-JS React with theme
      tokens only. Please report anything that looks off.
- [ ] **Client-side WebCodecs decode**: the host H.264 stream was verified with
      ffmpeg and the page has an automatic PNG fallback, but the actual
      in-browser decode/canvas path (and the Smooth/Compat + Keyboard controls)
      was not visually exercised in this session. If the Smooth view fails, it
      switches itself to Compat and shows a banner.
- [ ] ADBKeyboard / CJK text input, audio, camera, Play Store, multiple
      simultaneously running emulators, or a real phone as the target.
- [ ] The auto-create path for a brand-new `gamelab` AVD (the tested AVD was
      created by the lab script; the code path writes the same config keys).

## Troubleshooting

- **"Android SDK not found"** - set `ANDROID_HOME` or the plugin config
  `sdkDir`. `aapt2`/`avdmanager` warnings are advisory: Play still works
  without `aapt2` (the package name is then derived from `pm list packages`).
- **Slow first boot / low frame rate** - normal on this host. Smooth mode is
  limited by how often `screenrecord` produces frames (only when the picture
  changes), and Compat mode by the ~1 s `screencap` cost. If Smooth shows
  errors or a black canvas, use the **Compat** toggle or reload the page; the
  page normally falls back by itself.
- **Another emulator is already running** - `start` adopts an already-online
  emulator instead of booting a second one; `stop` uses `adb emu kill`. The
  desktop's `emulator-watchdog` also closes idle headless emulators, which is
  a second safety net.
- **Host RAM is tight** - lower `idleMinutes`, stop with the button, or use a
  lighter system image/AVD. The plugin never keeps a hidden emulator alive
  after the page closes its heartbeat.
- **AVD missing after a DSH update** - profile-level installs survive app
  updates, but a fresh profile needs `install_bundle` again. If the app
  restarted and the plugin is missing from the sidebar, the bundle selection may
  have been reset by a profile repair: `plugin_manager set_bundle target:
  @local/game-lab enabled: true` re-selects it (the package stays installed).
