# Roadmap

Ideas are ordered by value to the core loop (build a game, see it, interact).
Nothing here is a promise; open an issue to discuss one.

## Near term

- **AVD manager in the page** - list existing AVDs, switch the active one,
  create a lean profile, wipe data, and show the real disk footprint.
- **Smooth-view tuning** - expose bitrate, max size and (optionally) frame-rate
  caps in the config instead of the fixed 6 Mbps/720p screenrecord call.
- **Multi-touch** - pinch/zoom and two-finger gestures for city builders and
  strategy games. This needs a device-side multi-touch injection path; adb
  `input` only provides single-pointer gestures.
- **Physical phone target** - list every `adb devices` entry in the page and
  adopt a USB phone (the controller already speaks serials; the UI only exposes
  the configured AVD).
- **Library quality of life** - favourites, hide old builds, "last played",
  search persistence and automatic refresh when an APK file changes.
- **Screenshot gallery** - keep the last N captures in memory with timestamps
  instead of a single download.

## Medium term

- **Audio (optional)** - `screenrecord` is video-only; audio would need a
  second capture path and a WebCodecs AudioDecoder or MediaSource pipeline.
- **Multiple viewers** - today one `/stream.h264` viewer is allowed; a
  multi-viewer design needs one encoder per viewer or a shared packet fan-out
  with a keyframe cache.
- **Saved-state snapshots** - quick boot for the AVD, with an explicit tradeoff
  between disk (snapshot files) and boot time.
- **Lighter images** - validate an AOSP/ATD system image as the default: lower
  RAM and faster capture at the cost of Google APIs.
- **Portable hosts** - validate the POSIX code paths on macOS/Linux (adb and
  the emulator launcher; the UI is host-agnostic).

## Longer term

- **Game-aware launch profiles** - remember per-game orientation, resolution
  and AVD, and optionally auto-install the newest build of a chosen game.
- **Build pipeline plugins** - user-defined commands per project (Godot export,
  custom signing, etc.) with the same log/phase contract.
- **CI recipe** - an opt-in workflow (not enabled by default) that only runs the
  portable test suite; emulator/browser tests stay local.
