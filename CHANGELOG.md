# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
semantic versioning.

## [1.1.0] - 2026-11-05

### Added

- Smooth H.264 live view: host `host/video.js` streams screenrecord Annex-B
  output through `GET /_dsh/game-lab/stream.h264`; the page decodes it with
  WebCodecs and paints a canvas. Automatic fallback to the PNG stream and a
  Smooth/Compat toolbar toggle.
- `host/build.js`: build-plan detection for plain Gradle and Capacitor
  projects. Capacitor apps run their own `android:apk` script or
  `npm run build` + `npx cap sync android` + Gradle, then install the APK.
- Keyboard panel (ASCII text + Enter/Space/Backspace/Esc) and extra key codes.
- Display stay-awake after boot/adopt (`svc power stayon`,
  `screen_off_timeout`, keyguard dismissed, WAKEUP).
- `phase`, `stepIndex`, `kind` and `apkPath` in the `/status` build object.
- H.264 statistics in `/status` (`fps`, `kbps`, `frames`, `sps`, `pps`).
- Portable test fixtures: the test suite now creates its own APK/project
  fixtures and skips optional real-APK tests instead of depending on a
  developer machine layout.
- Documentation set (`docs/`), MIT license, contributing guide and issue
  templates.

### Fixed

- Build & Play installed stale web assets for Capacitor games.
- Starting a video stream closed its own HTTP response when the first
  SPS+IDR chunk crossed the socket high-water mark.
- The idle timer could stop the emulator in the middle of a long build.
- AAPT2 launchable activity names (bare class names) are normalized to
  `package/class` before `am start`.

## [1.0.0] - 2026-11-05

### Added

- Initial Game Lab plugin: headless AVD lifecycle (boot on demand, idle stop),
  live PNG screen stream, tap/swipe/key/rotate input, game library scan,
  install-and-launch, Gradle Build & Play, logcat tail, runtime readouts,
  loopback/same-origin route fence, unit and integration tests.
