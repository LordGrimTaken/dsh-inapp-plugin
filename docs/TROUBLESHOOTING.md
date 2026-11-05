# Troubleshooting

## The Game Lab route returns 404 / the sidebar icon is missing

The bundle is not active in the current profile. Check the row exists and is
enabled, then reload the page.

```text
plugin_manager list_plugins target: game-lab       # find include:game-lab
plugin_manager set_bundle target: @local/game-lab enabled: true
```

A DSH update or profile repair can reset `dsh.profile.bundles` to the base
bundles while the linked package stays installed; re-selecting the bundle fixes
it without reinstalling. The page half needs a page reload after the bundle is
selected.

## "Android SDK not found"

Set `ANDROID_HOME` (or `ANDROID_SDK_ROOT`, or the `sdkDir` config) to a folder
containing `platform-tools/adb` and `emulator/emulator`. `aapt2` and
`avdmanager` are optional but enable metadata/AVD auto-create; the UI reports
their availability in `/status.toolchain`.

## The AVD cannot be created / "avdmanager was not found"

Install the SDK cmdline-tools, or create an AVD named `gamelab` from Android
Studio's Device Manager. The plugin only auto-creates when an x86_64 system
image is installed and `avdmanager` is discoverable.

## Emulator boot is slow or hangs

- First cold boot is 40-60 s; a heavily loaded machine can be slower.
- Check `adb devices` and `adb -s <serial> shell getprop sys.boot_completed`.
- A machine with < ~3.5 GB free RAM can swap and stall; stop other VMs/builds.
- Idle Gradle/Kotlin daemons often hold several GB after a build; they stop
  cheaply when not in use.
- The AVD was configured with `-no-snapshot`; there is no quick-boot shortcut.

## The live view is low fps

- Static screens legitimately send few H.264 frames: the encoder emits frames
  when the picture changes. Test with motion.
- **Compat** mode is the ~1 fps PNG fallback; **Smooth** should be selected.
- WebCodecs requires a recent Chromium (the DSH desktop app qualifies). If the
  decoder fails, the page switches to Compat and shows a banner.
- A second viewer gets 409 `video_busy`; only one page/stream may watch at a
  time.

## Smooth view is black or shows errors

1. Switch to **Compat** in the toolbar.
2. Reload the page (the client bundle may be stale).
3. Check `/status.video`: `sps/pps` false and bytes 0 means screenrecord is not
   producing a stream; usually the emulator display is asleep or the device is
   not online. Keep the page visible; the plugin keeps the display awake.
4. Report the `/status` JSON and the browser console error if it persists.

## Build & Play fails

- The card at the bottom of the Projects card and `/status.build.logTail` show
  the failing step. `phase` names the step (`npm run build`, `npx cap sync
  android`, `Gradle assembleDebug`, or `npm run android:apk`).
- For Capacitor projects, make sure `node_modules` is installed in the app root;
  `npx --no-install` deliberately refuses to download packages.
- Set `JAVA_HOME` for Gradle; `ANDROID_HOME` is passed through to Gradle.
- A timeout means a step took > 12 minutes; run it manually in a terminal to
  see the real error.
- If a build succeeds but no APK is found, the search roots are the Android dir
  and the app root; check that `build/outputs/.../*.apk` exists.

## Install fails with `INSTALL_FAILED_VERSION_DOWNGRADE`

The AVD already has a newer version of the game. Uninstall it first:

```text
adb -s <serial> uninstall <package>
```

`adb install -r` replaces same-or-higher versions only.

## `adb install` fails but the package was already installed long ago

The AVD data partition may have been created with a temporary path by another
tool. Check that `C:\Users\<you>\.android\avd\gamelab.avd\config.ini` does not
contain `disk.dataPartition.path = <temp>`; remove that line so userdata
persists. Game Lab's own auto-created AVDs do not set it.

## 403 on a POST from a script

POSTs require a same-origin `Origin` header:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:<port>/_dsh/game-lab/heartbeat' `
  -Method Post -ContentType 'application/json' -Body '{}' `
  -Headers @{ Origin = 'http://127.0.0.1:<port>' }
```

GETs do not. This is CSRF protection, not authentication.

## The emulator window appears

Game Lab always launches with `-no-window`. If you see an emulator window, a
different AVD/tool was started by hand; the plugin adopts an already-online
emulator instead of spawning another. Nothing in this plugin starts a visible
emulator.

## Text input does nothing in the game

The plugin sends ASCII via `adb shell input text`; CJK/emoji require the
ADBKeyboard IME installed and selected in the AVD. Tap the game's text field
first, then use the Keyboard panel and Send.

## Where are logs?

- `/status.notes` (last events, short ring).
- `GET /_dsh/game-lab/logs?lines=200` (logcat).
- `/status.build.logTail` (build output, last 40 lines).
- Emulator/adb errors surface in the `error` field of the emulator state and in
  the build/install responses.
