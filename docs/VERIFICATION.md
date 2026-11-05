# Verification log

Date: **2026-11-05**. This page records what was actually observed while
building Game Lab, including the measurements and the things that were not
verified. It is deliberately specific so future changes have a baseline.

## Environment

| item | value |
|---|---|
| Host | Windows 11, Intel i7-11800H (8C/16T), 15.8 GB RAM, NVIDIA RTX 3050 Ti + Intel UHD |
| Acceleration | AEHD 2.2 (`emulator -accel-check`: installed and usable); Hyper-V absent |
| Android SDK | emulator 37.2.13, platform-tools adb, build-tools 36.0.0 |
| System image | `system-images;android-34;google_apis;x86_64` |
| AVD | `gamelab`, 720x1280 @ 320 dpi, 2 GB RAM request, 2 vCPU, data partition 2 GB |
| DSH | Desktop 0.2.2-rc.1, Web UI, desktop profile |
| JDK / Node | JDK 21.0.13, Node 24.21 |

## Automated tests

```text
node --test test/frame.test.mjs test/fence.test.mjs test/video.test.mjs \
          test/integration.test.mjs host/library.test.mjs
```

Result on this machine: **24 tests, 22 pass, 2 skipped, 0 fail** (~1.1 s).
The skipped tests are the optional real-APK/aapt2 checks; they require
`GAME_LAB_TEST_APK` / `GAME_LAB_TEST_RELEASES` and an Android SDK.

Coverage:

- PNG splitter (chunk walking, arbitrary chunk boundaries, garbage resync) and
  multipart congestion handling;
- route fence (loopback, Origin, cross-site, cross-origin, LAN peer);
- H.264 NAL statistics (SPS/PPS/VCL counting across split chunks, reset);
- config clamping, status shape, portable APK scan/grouping, build-output
  project linking, Gradle vs Capacitor build-plan detection;
- routes `/status`, `/games`, `/heartbeat`, `/stream.h264` (offline 409) on a
  real loopback HTTP server.

## Emulator lifecycle

| measurement | value |
|---|---|
| start -> `adb devices` shows the device | 24-32 s |
| start -> `getprop sys.boot_completed` = 1 | **36-62 s** (cold boots; 61 s after a heavy build) |
| stop via `adb emu kill` -> state `off` | < 10 s, no qemu process left |
| AVD persistence | installed APKs present after stop/start and reboot |
| display | `screen_off_timeout=2147483647`, `mStayOn=true`, `mWakefulness=Awake` |
| idle auto-stop | 5 minutes after the last heartbeat/input: log `idle timeout` -> `stopped (idle)`; host free RAM returned from ~1.7 GB to ~6 GB |

## Live view

### PNG compatibility path

- ~0.7-1.6 fps at 720x1280; `screencap -p` costs ~1.0-1.2 s per frame.
- A `frame.png` response of a game screen was 70-212 KB depending on content.
- Tap round trip (HTTP -> `input tap` -> 200) ~0.7 s.

### H.264 smooth path

- Direct `screenrecord --output-format=h264 --bit-rate 6000000 --time-limit 6 -`
  capture during continuous scrolling: **701,805 bytes, 114 frames / 6 s
  (~19 fps)**.
- Game Lab's `GET /stream.h264` during scrolling: 122,766 bytes captured
  (22 frames after trimming the final partial NAL), decoded cleanly by ffmpeg
  (`ffprobe` counted 22 frames; `ffmpeg -v error` reported no errors).
- Static screens: 1-2 frames over 6-8 s; `screenrecord`/MediaCodec only emits
  frames when the display content changes. A running card game's static board
  therefore updates only when something moves.
- `/status.video` reported `sps:true, pps:true`, `frames` growing, and
  `fps` up to ~19 during motion; bitrate ~0.1-1.0 Mbps.
- One viewer at a time; a second request returns 409 `video_busy`, and a new
  stream restarts the encoder so SPS/PPS + IDR are always first.
- `/status.avds` returned `["gamelab"]` on this machine after the v1.2 reload
  (host build `2026-11-05.10`), so the offline AVD picker has data to show.

## Install / launch / build

| measurement | value |
|---|---|
| install + launch a 9.6 MB card game APK | 3.7 s |
| install + launch a 6.0 MB landscape city-builder APK | 14.0 s |
| landscape game | status/frame resolution followed to 1280x720 |
| input | a tap sent through `/input` advanced the game's guided onboarding to "Turn 1 - your move" |
| Build & Play, plain Gradle project, emulator off | 66.6 s total (boot + `assembleDebug` 2 s up-to-date + install/launch) |
| Build & Play, Capacitor project (`npm run android:apk`) | **71.4 s** total: detected `kind:"capacitor"`, one `project` step, `BUILD SUCCESSFUL in 37 s`, APK installed and launched (`com.*` foreground) |

The Capacitor case is the important one: running only Gradle had installed an
APK with stale web assets; the plan now rebuilds and syncs the web bundle first.

## UI / client

- Client registration was confirmed live in the connected page:
  `main#game-lab` and `sidebar.panellist#game-lab` (order 25) active.
- A stub-loader test evaluates `client.js`, calls `factory`/`apply` and checks
  both slot registrations, with no runtime error at load time.
- The page renders offline/online/booting/error states in a render smoke test
  with mocked React (no DOM).

## Not verified

- **Visual appearance of the page** (layout, light/dark, new toolbar panels,
  Keyboard panel) - no browser control was available in the authoring session.
- **In-browser WebCodecs decode/canvas path** - the host H.264 stream was
  verified with ffmpeg and the client parses Annex-B/derives the codec string in
  code, but the actual canvas rendering was not observed. The page falls back
  to the PNG view if the stream/decoder fails.
- The v1.2 Pad panel, AVD select and search persistence were exercised through
  the client stub loader and syntax/locale checks, not in a live browser; their
  host counterparts (`/status.avds`, `POST /emulator {avd}`) are verified.
- ADBKeyboard/CJK text input, audio, camera, Play Store, a physical USB phone
  as target, and multiple simultaneous emulators.
- Auto-creating a brand-new AVD on a machine where `gamelab` does not exist
  (the tested AVD was created by a lab script; the auto-create code writes the
  same keys but was not exercised from a clean machine).
- macOS/Linux host behaviour.
- Any CI: this repository intentionally has no workflows.
