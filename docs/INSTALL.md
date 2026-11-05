# Install

## Prerequisites

| requirement | notes |
|---|---|
| DeepSeek Harness (Desktop) | Web UI bundle; tested with 0.2.2-rc.1 |
| Android SDK | `ANDROID_HOME` or `ANDROID_SDK_ROOT` pointing at a directory with `platform-tools/adb` and `emulator/emulator` |
| x86_64 system image | e.g. `system-images;android-34;google_apis;x86_64`; the plugin auto-creates its AVD from the newest one it can find |
| Hardware acceleration | AEHD (Windows) or equivalent; `emulator -accel-check` must succeed |
| JDK + Node/npm | only needed for **Build & play** (Gradle and Capacitor steps) |
| Disk space | ~4 GB for the AVD after first boot (sparse), plus the system image already installed |
| RAM | ~3.5 GB free while the emulator runs |

The plugin does **not** ship or install an emulator engine; it drives the SDK
emulator that is already on the machine.

## Install the bundle

From an agent session in DSH, install the repository directory as a bundle.
`plugin_manager` is a DSH **agent tool**, not a shell command; ask your agent
to run it (or use the equivalent action in your DSH build if one is exposed):

```text
plugin_manager install_bundle target: C:\path\to\game-lab
```

`install_bundle` links the directory into the profile, adds it to the profile's
bundle selection and activates it live. It also performs package-manager
resolution; there are no runtime npm dependencies.

Equivalent manual check (if you know the profile):

```text
# inspect the row; the entry id is include:game-lab
cordis_inspect Config.listConfigs { "name": "@local/game-lab" }
```

## First run

1. Reload the Harness page once (the client half is served on page load; a
   brand-new client plugin needs that refresh).
2. Click the **Game Lab** icon in the left sidebar.
3. Set `gameRoots` if you have not already (see
   [Configuration](CONFIGURATION.md)); the default is `C:\Games`.
4. Press **Start emulator** and wait for `online` (36-62 s on the test machine).
5. The left column lists APKs and projects; press **Play** or **Build & play**.

The first `Start` may create the AVD (`gamelab`) automatically. That needs
`avdmanager` from the SDK's `cmdline-tools`; when it is missing the UI reports
the reason instead of hanging. Creating the AVD from Android Studio's Device
Manager with the same name also works.

## Verify the installation

```text
# route check (replace port with the DSH Web UI port)
Invoke-WebRequest http://127.0.0.1:<port>/_dsh/game-lab/status
```

Expected: `{"ok":true,...}` with `hostBuild`, `emulator.state:"off"`,
`video` statistics and `toolchain.ok:true`. In the page, the status pill and
the Start button should be visible even before an emulator exists.

If the route returns 404, the bundle is not selected in the profile; re-select
it with `plugin_manager set_bundle target: @local/game-lab enabled: true` and
reload. If a DSH update/profile repair resets the bundle list, the package stays
installed but the row disappears from the composition.

## Update

The bundle is linked, so editing files in this directory is enough for the host
half after a plugin restart:

1. Edit host files, then run `node --check` and the tests.
2. Toggle the row to reload the host module:
   `plugin_manager set_plugin target: include:game-lab enabled: false`, then
   `true`. (The generated row id is `game-lab`; the loader entry is
   `include:game-lab`.)
3. Reload the page for `client.js` changes.

A host-module edit does **not** require restarting the app; a full app restart
is only needed if the loader cannot re-evaluate the module (rare).

## Uninstall

```text
plugin_manager remove_bundle target: @local/game-lab
```

The emulator/AVD and any installed games remain on disk. Remove them
separately if desired:

- AVD: `C:\Users\<you>\.android\avd\gamelab.avd` + `gamelab.ini`
- Android SDK emulator and system images: managed by the Android SDK, keep
  them if you use other Android tools.

## Security notes

- Routes are loopback-only and same-origin fenced; nothing is exposed on the
  LAN.
- `POST` endpoints require an `Origin` header from the DSH page. A non-browser
  client must send it explicitly (see [API](API.md)); a bare `curl` POST gets
  403 by design.
- No screenshot or stream file is written to disk by the plugin; `/frame.png`
  is generated from memory, the page's screenshot button downloads it.
