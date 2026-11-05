# Configuration

Game Lab reads one config object from its loader row. The bundle ships
`cordis.patch.yml` with defaults; the **profile** (`~/.dsh/profiles/<profile>/cordis.patch.yml`)
can override the row by id. A row override replaces the complete config object,
so include every key you want to keep (missing keys fall back to the plugin's
internal defaults).

## Override example

```yaml
# profile cordis.patch.yml (after the bundle layers)
- id: game-lab
  name: '@local/game-lab'
  config:
    avdName: gamelab
    gameRoots:
      - D:\GameProjects
      - C:\Users\you\Downloads
    idleMinutes: 3
    ramMb: 2048
    cores: 2
    gpuMode: host
    maxFps: 8
```

Re-select/reload the row after editing: `plugin_manager set_plugin target:
include:game-lab enabled: false` then `true` (or restart the app). Toggling the
row stops a running emulator.

## Keys

| key | default | meaning |
|---|---|---|
| `avdName` | `gamelab` | AVD this page owns. Created from an installed x86_64 image when missing. |
| `ramMb` | `2048` | Guest RAM request (1024-6144). The API 34 image may raise its own floor (~2.5 GB); host qemu footprint is larger than this number. |
| `cores` | `2` | vCPU count (1-8). 2 is the tested balance. |
| `gpuMode` | `host` | `host`, `swiftshader_indirect`, or `auto`. `host` uses the real GPU and lower CPU; `swiftshader_indirect` is the compatibility fallback. |
| `maxFps` | `8` | Pacing cap for the PNG loop (2-20). The device's screencap cost is usually far slower; this does not make PNG smooth. |
| `idleMinutes` | `5` | Stop the emulator after this many minutes without heartbeat/input (1-120). A running build suspends the timer. |
| `gameRoots` | `[C:\Games]` | Absolute folders scanned for APKs and Gradle/Capacitor projects (max 8). Missing folders are reported and skipped. |
| `bootTimeoutMs` | `240000` | Hard bound for a cold boot (60-600 s). |
| `sdkDir` | auto | Optional explicit Android SDK path. Defaults to `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `%LOCALAPPDATA%\Android\Sdk`, or PATH. |

The H.264 bitrate is fixed at 6 Mbps and its 180 s limit is auto-restarted;
changing it requires editing `host/video.js` (deliberately not part of the
config yet).

## Game folders

`gameRoots` can contain:

- folders of `.apk` files (release builds, downloaded APKs);
- Gradle projects (folder with `settings.gradle` + `gradlew`);
- Capacitor app roots (folder with `package.json` + `capacitor.config.*`, and
  an `android/` child), or their `android/` folder directly.

Scanning skips `node_modules`, `.git`, `.gradle`, virtualenvs, `.godot`,
`.agents` and build intermediates; `build/outputs` is intentionally kept so
Gradle debug/release APKs are discovered. APK metadata (package/label) is read
when you press Play, not for every file up front.

## Choosing an AVD

The plugin's AVD is deliberately small: 720x1280 @ 320 dpi, host GPU, cold
boot, no snapshots, 2 GB data partition. If you already have an AVD you prefer,
set `avdName` to it; the plugin will use it as-is (it only patches a
**newly-created** AVD). Existing emulators are adopted instead of duplicated
when one is online.

A fresh AVD is created with `avdmanager` from the newest x86_64 system image,
then configured with:

```
hw.lcd.width=720 hw.lcd.height=1280 hw.lcd.density=320
hw.ramSize=<ramMb> hw.cpu.ncore=<cores>
hw.gpu.enabled=yes hw.gpu.mode=<gpuMode>
disk.dataPartition.size=2G
fastboot.forceColdBoot=yes fastboot.forceFastBoot=no
```

## Performance and memory

- The emulator itself is the cost: ~3.1-3.7 GB host RAM and ~2.1-2.4 cores
  while online. Game Lab reduces *when* that is paid (on demand, idle stop,
  demand-driven streams) rather than the cost.
- `idleMinutes` is the main RAM lever. The page's 10 s heartbeat keeps the
  emulator alive only while the page is visible.
- The Smooth view costs the guest encoder + an adb pipe; the Compat view costs a
  ~1 s `screencap` per frame. If Smooth is unavailable, the page falls back.
- A lighter system image (AOSP/ATD) or a lower-resolution AVD reduces both RAM
  and capture cost; `google_apis` is convenient but heavier.
