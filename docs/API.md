# HTTP API

All routes are mounted on the existing DSH webserver under
`/_dsh/game-lab`. The browser page is the intended client; the API is
documented because it is also the easiest way to script a build/test run.

**Trust fence:** every request must come from a loopback peer with a loopback
`Host`. POSTs additionally require an `Origin` header matching the request
authority (`http://127.0.0.1:<port>`). `/stream` and `/stream.h264` are GET-only
and long-lived. JSON error shape:

```json
{ "ok": false, "code": "unavailable", "error": "human readable detail" }
```

## Endpoints

| method | path | purpose |
|---|---|---|
| GET | `/status` | snapshot the page polls |
| GET | `/games` | scan `gameRoots` for APKs/projects |
| GET | `/frame.png` | newest PNG frame (404 when offline) |
| GET | `/stream` | `multipart/x-mixed-replace` PNG stream |
| GET | `/stream.h264` | raw Annex-B H.264 (one viewer) |
| GET | `/logs?packageName=&lines=` | logcat tail |
| POST | `/emulator` | `{action:'start'|'stop', avd?}` |
| POST | `/install` | `{path}` install + launch an APK |
| POST | `/launch` | `{packageName}` launch an installed package |
| POST | `/build` | `{projectPath}` detect plan, build, install, launch |
| POST | `/input` | tap/swipe/key/text/rotate |
| POST | `/heartbeat` | keep the idle timer from firing |

### GET /status

```json
{
  "ok": true,
  "plugin": "game-lab",
  "hostBuild": "2026-11-05.9",
  "serverTime": 1793900000000,
  "emulator": {
    "state": "online",
    "avd": "gamelab",
    "serial": "emulator-5554",
    "owned": true,
    "bootedAt": 1793899990000,
    "bootElapsedMs": 39401,
    "progress": 1,
    "error": null,
    "resolution": { "width": 720, "height": 1280 },
    "fps": 1.7,
    "ramMb": 3400,
    "cpuPercent": 220,
    "idleStopAt": 1793900290000,
    "lastActivityAt": 1793899990000
  },
  "video": {
    "active": false, "consumers": 0, "error": null,
    "fps": 0, "kbps": 0, "frames": 0, "sps": false, "pps": false, "bytes": 0
  },
  "build": {
    "state": "idle", "project": null, "kind": null, "phase": null,
    "phaseId": null, "stepIndex": 0, "stepCount": 0, "steps": [],
    "logTail": null, "startedAt": null, "finishedAt": null, "ok": null,
    "apkPath": null
  },
  "config": {
    "avdName": "gamelab", "idleMinutes": 5, "maxFps": 8,
    "ramMb": 2048, "cores": 2, "gpuMode": "host", "gameRoots": ["C:\\Games"]
  },
  "toolchain": { "ok": true, "reason": null, "avdmanager": true, "aapt2": true },
  "avds": ["gamelab"],
  "notes": ["..."]
}
```

`avds` lists installed AVD names (up to 40) so the offline screen can offer a
picker; `POST /emulator {action:"start", avd:"<name>"}` accepts the choice.

`build.state` is `idle|running|done|error`; while running, `phase` is the
current step label and `stepIndex/stepCount` describe progress.

### GET /games

```json
{
  "ok": true,
  "games": [{
    "id": "apk:c:\\games\\demo-debug.apk",
    "kind": "apk", "path": "C:\\Games\\demo-debug.apk",
    "fileName": "demo-debug.apk", "dir": "C:\\Games",
    "sizeBytes": 9587078, "mtimeMs": 1793800000000,
    "group": "demo", "isLatest": true, "versions": 3,
    "packageName": "com.example.demo", "label": "Demo",
    "versionName": "1.2.0", "versionCode": "12",
    "launchableActivity": "com.example.demo.MainActivity",
    "projectPath": null, "fromBuild": false
  }],
  "projects": [{
    "id": "gradle:c:\\games\\demo\\android", "kind": "gradle",
    "path": "C:\\Games\\demo\\android", "name": "android",
    "gradlew": "C:\\Games\\demo\\android\\gradlew.bat",
    "mtimeMs": 1793800000000, "hasApk": true
  }],
  "scan": { "roots": ["C:\\Games"], "tookMs": 95, "truncated": false, "aapt2": "..." }
}
```

### POST /emulator

Request: `{"action":"start"}` or `{"action":"stop"}`; `start` may include
`{"avd":"other-avd"}`. Response is `202 {"ok":true,"state":"booting"}` (the
page polls `/status` until `online`). One emulator slot; a second start while
already online returns the current status.

### POST /install

Request: `{"path":"C:\\Games\\demo-debug.apk"}`. Installs with
`adb install -r -g`, resolves package/launchable activity (aapt2 when
available, otherwise a `pm list packages -3` diff), launches it and returns:

```json
{ "ok": true, "packageName": "com.example.demo", "label": "Demo",
  "versionName": "1.2.0", "launched": true }
```

### POST /build

Request: `{"projectPath":"C:\\Games\\demo\\android"}`. Returns
`{"ok":true,"state":"running","kind":"capacitor","steps":["project"]}` and
runs asynchronously. Watch `/status.build`; the log tail is included. The
emulator is booted in parallel if needed and installed/launched when done.

### POST /input

One of:

```json
{"kind":"tap","x":0.5,"y":0.75}
{"kind":"swipe","fromX":0.2,"fromY":0.8,"toX":0.8,"toY":0.8,"durationMs":250}
{"kind":"key","name":"back"}
{"kind":"key","name":"space"}        // also escape, tab, enter, delete, dpad_*
{"kind":"text","text":"hello world"} // ASCII only
{"kind":"rotate","orientation":"landscape"}
```

Coordinates are normalized 0..1 of the current frame. Tap/swipe return
`{"ok":true,"kind":"tap"}`.

### POST /heartbeat

Empty JSON. Returns `{"ok":true,"idleStopAt":<epoch-ms>,"fps":<n>}` and counts
as activity. The page sends one every 10 s while it is visible.

### GET /stream.h264

`application/octet-stream`, raw Annex-B. One viewer at a time: a second request
returns `409 {"code":"video_busy"}`. A stream always starts with SPS/PPS + IDR;
the encoder restarts every 180 s inside the same response. When the emulator is
off: `409 {"code":"emulator_offline"}`.

### GET /logs

Query: `lines` (10-500, default 200), optional `packageName`. Returns
`{"ok":true,"lines":["..."],"packageName":"..."}`. If the package is running,
logcat is restricted to its pid; otherwise lines are filtered by package name.

## Scripted example (PowerShell)

```powershell
$base = 'http://127.0.0.1:<port>/_dsh/game-lab'
$origin = 'http://127.0.0.1:<port>'
$headers = @{ Origin = $origin }

Invoke-RestMethod -Uri "$base/emulator" -Method Post -Headers $headers `
  -ContentType 'application/json' -Body '{"action":"start"}'

# wait for online
do { Start-Sleep 3; $s = Invoke-RestMethod "$base/status" } until ($s.emulator.state -in 'online','error')

Invoke-RestMethod -Uri "$base/build" -Method Post -Headers $headers `
  -ContentType 'application/json' -Body '{"projectPath":"C:\\Games\\demo\\android"}'
```

A `GET` needs no Origin; the fence accepts loopback GETs. A POST without an
Origin header is refused with 403 on purpose (browser CSRF protection).
