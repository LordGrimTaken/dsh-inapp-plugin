# Game Lab - an in-app Android emulator for testing the games you build

Game Lab puts a game-testing Android emulator **inside the DeepSeek Harness app**.
Open the page, press **Start emulator**, pick one of your game APKs (or a Gradle
game project) and play it on the live screen - no MEmu, BlueStacks, LDPlayer or
Android Studio needed to try a build, and no second application to keep open.

It is a normal DSH plugin: a sidebar icon plus a full page in the Web UI, a
host-side controller, and webserver routes under `/_dsh/game-lab/*`. The plugin
uses the Android SDK already on the machine; it does not bundle or install a new
emulator engine.

```
left sidebar:  [gamepad icon] Game Lab
```

## What it does

- **Boots a lean, headless AVD on demand.** The AVD (`gamelab` by default) is
  launched with `-no-window -no-audio -no-boot-anim -no-snapshot`, 720x1280,
  2 vCPU at most, host GPU. No visible emulator window ever appears. It is
  auto-created from an installed x86_64 system image the first time the AVD
  named in the config is missing.
- **Streams the real screen** into the page (in-process PNG multipart stream
  served from the DSH webserver - no extra port, no adb in the browser) and
  forwards **taps, swipes, Back/Home/Recents, rotation and keyboard keys**
  straight to the device.
- **Finds your games**: scans the configured folders for `*.apk` files, groups
  builds by name (newest expanded, older builds under "N builds"), and lists
  Gradle game projects. **Play** installs the APK and launches it; **Build &
  play** runs `gradlew assembleDebug`, then installs and launches the newest
  APK it produced.
- **Keeps the machine free**: the frame loop only runs while the page is
  watching, and the emulator stops itself after 5 minutes without a heartbeat
  or input (configurable). Close the page, walk away - RAM comes back.
- **Readouts**: state, AVD, resolution, measured fps, emulator RAM/CPU, idle
  countdown and uptime; logcat tail per game; one-click PNG screenshot.

## Measured on this machine (2026-11-05)

| fact | value |
|---|---|
| cold boot to usable Android (start -> `sys.boot_completed=1`) | **36-50 s** |
| ADB online (start -> `adb devices` shows the device) | 24-32 s |
| emulator host memory (qemu working set, 720x1280, API 34 google_apis) | **~3.1-3.7 GB** |
| emulator host CPU while online and streaming | **~2.1-2.4 cores** (~13-15 % of a 16-thread CPU) |
| live-view frame rate (720x1280 PNG screencap transport) | **~0.7-1.6 fps** (~1.0-1.2 s/frame) |
| tap round trip (POST -> `input tap` -> 200) | ~0.7 s |
| install + launch an APK (9.6 MB Shadowmire) | 3.7 s |
| install + launch (6.0 MB Little Lanterns) | 14.0 s |
| AVD disk after first boot | ~3.8 GB logical (sparse; includes userdata/cache) |
| build & play (Gradle project, emulator off at start) | **66.6 s total**: emulator boot ~45 s, `assembleDebug` 2 s (up to date), install + launch |
| idle auto-stop | fired after the 5-minute window; state returned to `off`, host RAM went from ~3.5 GB used to ~6 GB free |

## Try it now

1. In the left sidebar, click the **Game Lab** icon (a gamepad; it sits after
   the browser icon). If it is not there yet, reload the page once - the client
   half is served on page load.
2. Press **Start emulator**. First boot takes ~40-50 s (progress bar + status).
3. Pick a game in the left list and press **Play** (or **Build & play** for a
   Gradle project). The screen appears on the right; click/drag it to interact;
   the toolbar has Back/Home/Recents, rotate and screenshot.
4. When you are done, press **Stop emulator** - or just close the page; it
   stops itself after 5 minutes of no activity.

The live view is a **preview**, not 60 fps gameplay: `adb screencap -p` on this
headless emulator takes about a second per 720p frame, so the stream is a
~1 fps live view. Touch input is fast and reliable, and a screenshot is exact;
play a card/turn-based game comfortably, and expect a laggy picture in an
action game. A 30-60 fps transport needs `scrcpy-server` + WebCodecs H.264 and
is listed under future work - it is an additive change to the frame source, not
to the rest of the plugin.

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
`GET /stream` (multipart PNG), `GET /logs?packageName=&lines=`,
`POST /emulator` `{action:'start'|'stop', avd?}`, `POST /install` `{path}`,
`POST /launch` `{packageName}`, `POST /build` `{projectPath}`,
`POST /input` (tap/swipe/key/text/rotate, normalized 0..1 coordinates),
`POST /heartbeat`. Every POST requires the same-origin `Origin` header, and all
routes require a loopback peer + loopback Host header. Nothing is exposed on
the network.

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
- [x] **Build & play** end-to-end on a real Gradle game project
      (`gravebound/android`): one request booted the emulator, ran
      `assembleDebug`, found the produced/up-to-date APK, installed it and
      launched `com.shadowmire.game` in the foreground - 66.6 s from an
      emulator that was off.
- [x] **Idle auto-stop**: after the 5-minute window with no heartbeat/input the
      plugin stopped the emulator itself (`idle timeout` -> `stopped (idle)`),
      the device disappeared and host free RAM returned from ~1.7 GB to 6 GB.
- [x] logcat tail through `GET /logs`.
- [x] 22 host unit/integration tests pass (`node --test` in the plugin dir).

## Not verified (be honest)

- [ ] **Visual rendering of the page** itself (no browser control in this
      session): slot registration and an offline/online/booting/error render
      smoke test are confirmed, but light/dark appearance and the exact layout
      have not been seen by the author. The page is plain-JS React with theme
      tokens only. Please report anything that looks off.
- [ ] ADBKeyboard / CJK text input, audio, camera, Play Store, multiple
      simultaneously running emulators, or a real phone as the target.
- [ ] The auto-create path for a brand-new `gamelab` AVD (the tested AVD was
      created by the lab script; the code path writes the same config keys).
- [ ] 30-60 fps live view (not achievable with `screencap` PNG transport; see
      the frame-rate note above).

## Troubleshooting

- **"Android SDK not found"** - set `ANDROID_HOME` or the plugin config
  `sdkDir`. `aapt2`/`avdmanager` warnings are advisory: Play still works
  without `aapt2` (the package name is then derived from `pm list packages`).
- **Slow first boot / 1 fps view** - normal on this host. The frame rate is the
  emulator's `screencap` cost, not the plugin's encoding.
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
