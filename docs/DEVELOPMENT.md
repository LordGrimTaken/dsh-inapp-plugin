# Development

## Layout

```
index.js             host entry (apply + webServer injection)
client.js            the whole Web UI page and sidebar icon
cordis.patch.yml     bundle patch (inserts the game-lab row + default config)
host/emulator.js     GameLab controller (state, adb, input, install, build)
host/frame.js        PNG frame loop + multipart writer
host/video.js        H.264 screenrecord loop + NAL statistics
host/build.js        Gradle/Capacitor build-plan detection
host/library.js      APK/project scanner + aapt2 metadata
host/routes.js       HTTP routes and security fence
locale/              Plugin Manager metadata (en, zh)
test/                portable node:test suites
docs/                this documentation
```

No bundler and no runtime npm dependencies. Host code is ESM; client code is a
plain script using `window.__ModuleLoader__.load`.

## Local loop

The bundle is linked, so the repository directory is what the profile loads.

1. Edit host files.
2. `node --check <file>` and run the test suite (below).
3. Reload the host plugin row:
   `plugin_manager set_plugin target: include:game-lab enabled: false`, then
   `true`. This re-evaluates the module; a running emulator is stopped.
4. Edit `client.js` -> reload the Harness page (Ctrl+R). The client module is
   served on page load; HMR only replaces it while `pnpm run dev:web` is running
   from the DSH checkout.
5. Verify with `GET /_dsh/game-lab/status` (hostBuild marker tells you which
   module generation is live; bump `HOST_BUILD` in `host/emulator.js` when you
   need to prove a reload).

Installing a new bundle (`plugin_manager install_bundle`) is only needed when
the package manifest changes or the row is not selected; editing a linked
directory does not need a reinstall.

## Tests

```text
node --check index.js
node --check client.js
node --check host/emulator.js
node --check host/frame.js
node --check host/video.js
node --check host/build.js
node --check host/library.js
node --check host/routes.js

node --test test/frame.test.mjs test/fence.test.mjs test/video.test.mjs test/integration.test.mjs host/library.test.mjs
node test/locale-keys.mjs
```

The suite creates portable fixtures (fake APKs, synthetic Gradle/Capacitor
projects, a temporary HTTP server). Optional real-APK checks are skipped unless
you provide:

```text
GAME_LAB_TEST_APK       path to a real .apk (aapt2 metadata test)
GAME_LAB_TEST_RELEASES  folder with >12 real APKs (lazy-metadata test)
```

Both also require an Android SDK with `aapt2`; without one they skip instead of
failing. The emulator is never booted by the tests.

## Adding a route

1. Add a `case` in `host/routes.js` with `requireMethod`, `requireTrusted` and
   a JSON body read for POSTs.
2. Put the operation on `GameLab` (single code path) and return an explicit
   `{ok:false, code, error}` instead of throwing raw errors.
3. For long-lived responses, keep the handler open and close on `res` `close`;
   see `openStream`/`openVideoStream`.
4. Add an integration test using the fake webserver if the route is JSON.

## Adding a build pipeline

`host/build.js` is the only place that decides how to build. Return steps
(`command`, `args`, `cwd`) and the roots to search for APKs; the controller's
`#runBuildPlan` handles spawning, log capture, timeouts and install. Keep
commands fixed strings or arrays from detection; never interpolate user input
into a shell string.

## H.264 gotchas

- Frames only flow when the display changes. Test with a scrolling app or a
  game, not a static menu.
- Do not treat `res.write() === false` as a dead socket (see
  [ARCHITECTURE](ARCHITECTURE.md)).
- Validate a capture with ffmpeg only after trimming the final partial NAL of
  an aborted capture; tail errors are expected.
- Keep one viewer; a second connection is rejected so the encoder can restart
  with SPS/PPS + IDR.
- The screen must stay awake: `#prepareDevice` does this after boot/adopt.

## Style

- Plain JavaScript, no semicolon-free experimentation beyond the existing files,
  ASCII in source and docs unless a locale string needs otherwise.
- Keep user-visible text in the `EN` locale dictionary in `client.js`.
- Theme tokens only (`--dsw-alias-*`); no hardcoded UI colors.
- Every timer/child/stream/route gets an owner and a cleanup path.
- Follow the route fence: no unauthenticated LAN surface.

## Commits

Small, descriptive commits. Include what was verified and how in the message or
PR description. Update `CHANGELOG.md` for user-visible changes and `docs/` when
behaviour/configuration changes.
