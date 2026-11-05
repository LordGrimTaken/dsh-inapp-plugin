# Contributing

Thanks for taking a look at Game Lab. The project is a DSH plugin with no build
step and no runtime npm dependencies, so the contribution loop is small.

## Before you start

- Read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the architecture of the
  plugin and the reload semantics.
- Open an issue for larger changes so the approach can be discussed first.
- Do not include credentials, personal paths, APK dumps or logs in a pull
  request.

## Ground rules

- Plain ESM/JavaScript only; no bundler, no npm runtime dependencies. Client
  code uses `require('react')` from the DSH client module table and theme
  tokens for styling.
- Keep the host controller (`host/emulator.js`), frame source (`host/frame.js`,
  `host/video.js`), build plan (`host/build.js`) and library scanner
  (`host/library.js`) separable; new behaviour should not leak adb calls into
  the client.
- Every resource (timer, child process, stream, route, decoder) must be
  registered inside `apply`/`ctx.effect` or returned by a React cleanup.
- Match the existing security posture: routes are loopback-only, POSTs require
  a same-origin `Origin`, and no adb port is exposed to the browser.

## Checks

Run from the repository root:

```text
node --check index.js
node --check client.js
for file in host/*.js; do node --check "$file"; done
node --test test/frame.test.mjs test/fence.test.mjs test/video.test.mjs test/integration.test.mjs host/library.test.mjs
node test/locale-keys.mjs
```

Optional real-device tests:

```text
# Windows example
$env:GAME_LAB_TEST_APK = 'C:\path\to\app-debug.apk'
$env:GAME_LAB_TEST_RELEASES = 'C:\path\to\folder\with\many\apks'
```

## Pull requests

1. Fork, branch from `main`, and keep the change focused.
2. Describe what you verified and how (commands, device, measured numbers).
   Name anything you could not verify.
3. Update `README.md`/`docs/` when behaviour or configuration changes, and add
   an entry to `CHANGELOG.md` under "Unreleased".
4. CI is intentionally not enabled in this repository; please run the checks
   above locally and paste the summary in the PR.

## Reporting a bug

Use the issue template and include:

- DSH version and profile name, OS version, Android SDK/system image versions;
- the exact `gameRoots` configuration and the game/project layout (sanitize
  personal paths);
- `/status` JSON (redact anything private), relevant logcat or build tail;
- whether Smooth or Compat mode was active.
