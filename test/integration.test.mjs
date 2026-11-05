// Host integration test: config/toolchain/library + mounted routes on a plain
// HTTP server. Everything is created in a temp folder; the emulator itself is
// not booted. Run: node --test test/integration.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GameLab, normalizeConfig, resolveToolchain } from '../host/emulator.js';
import { mountRoutes, ROUTE_PREFIX } from '../host/routes.js';
import { detectBuildPlan } from '../host/build.js';

const SANDBOX = mkdtempSync(path.join(tmpdir(), 'game-lab-integration-'));
after(() => {
  rmSync(SANDBOX, { recursive: true, force: true });
});

function makeGameRoot() {
  const root = path.join(SANDBOX, 'games');
  for (const name of ['DemoGame-v1.00.apk', 'DemoGame-v2.00-debug.apk', 'OtherGame-online.apk']) {
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, name), Buffer.alloc(2048, 0x41));
  }
  return root;
}

test('toolchain resolves an Android SDK when one is configured', (t) => {
  const toolchain = resolveToolchain();
  if (!toolchain.ok) {
    t.skip(toolchain.reason || 'no Android SDK on this machine');
    return;
  }
  assert.match(toolchain.adb, /platform-tools[\\/]adb(\.exe)?$/i);
  assert.match(toolchain.emulator, /emulator[\\/]emulator(\.exe)?$/i);
  assert.ok(toolchain.aapt2 === null || /aapt2(\.exe)?$/i.test(toolchain.aapt2));
});

test('config clamps unsafe values and keeps absolute roots', () => {
  const config = normalizeConfig({
    ramMb: 99999,
    cores: 0,
    maxFps: 900,
    idleMinutes: 0,
    gameRoots: ['C:\\Games', 'relative/path', 'D:\\Builds'],
    gpuMode: 'nonsense',
  });
  assert.equal(config.ramMb, 6144);
  assert.equal(config.cores, 2);
  assert.equal(config.maxFps, 20);
  assert.equal(config.idleMinutes, 5);
  assert.equal(config.gpuMode, 'host');
  assert.deepEqual(config.gameRoots, ['C:\\Games', 'D:\\Builds']);
  assert.equal(normalizeConfig({}).avdName, 'gamelab');
});

test('status snapshot has the shape the page polls', () => {
  const lab = new GameLab({}, { gameRoots: [makeGameRoot()] });
  const status = lab.status();
  assert.equal(status.ok, true);
  assert.equal(status.emulator.state, 'off');
  assert.equal(typeof status.serverTime, 'number');
  assert.equal(status.config.avdName, 'gamelab');
  assert.equal(status.build.state, 'idle');
  assert.equal(typeof status.video, 'object');
  assert.ok(Array.isArray(status.avds));
  lab.dispose().catch(() => {});
});

test('games scan finds APKs in a configured root', async () => {
  const root = makeGameRoot();
  const lab = new GameLab({}, { gameRoots: [root] });
  const value = await lab.listGames(true);
  assert.equal(value.ok, true);
  assert.equal(value.games.length, 3);
  const demo = value.games.filter((game) => game.group === 'DemoGame');
  assert.equal(demo.length, 2);
  assert.equal(demo.filter((game) => game.isLatest).length, 1);
  lab.dispose().catch(() => {});
});

test('build-plan detection covers Gradle and Capacitor layouts', async () => {
  // Plain Gradle project.
  const gradle = path.join(SANDBOX, 'plain-android');
  mkdirSync(gradle, { recursive: true });
  writeFileSync(path.join(gradle, 'settings.gradle'), 'rootProject.name = "plain"\n');
  writeFileSync(path.join(gradle, 'gradlew.bat'), '@echo off\r\n');
  const gradlePlan = await detectBuildPlan(gradle);
  assert.ok(gradlePlan);
  assert.equal(gradlePlan.kind, 'gradle');
  assert.deepEqual(gradlePlan.steps.map((step) => step.id), ['gradle']);

  // Capacitor app with an android:apk script.
  const app = path.join(SANDBOX, 'cap-app');
  const android = path.join(app, 'android');
  mkdirSync(android, { recursive: true });
  writeFileSync(path.join(android, 'settings.gradle'), 'rootProject.name = "cap"\n');
  writeFileSync(path.join(android, 'gradlew.bat'), '@echo off\r\n');
  writeFileSync(path.join(app, 'capacitor.config.json'), '{ "appId": "com.example.demo" }\n');
  writeFileSync(path.join(app, 'package.json'), JSON.stringify({
    dependencies: { '@capacitor/core': '^8.0.0' },
    scripts: { build: 'vite build', 'android:apk': 'npm run build && cap sync android && cd android && gradlew assembleDebug' },
  }));
  const capPlan = await detectBuildPlan(android);
  assert.ok(capPlan);
  assert.equal(capPlan.kind, 'capacitor');
  assert.equal(capPlan.appRoot, app);
  assert.deepEqual(capPlan.steps.map((step) => step.id), ['project']);

  // Capacitor app without the script -> web + sync + gradle.
  const app2 = path.join(SANDBOX, 'cap-app-2');
  const android2 = path.join(app2, 'android');
  mkdirSync(android2, { recursive: true });
  writeFileSync(path.join(android2, 'settings.gradle'), 'rootProject.name = "cap2"\n');
  writeFileSync(path.join(android2, 'gradlew.bat'), '@echo off\r\n');
  writeFileSync(path.join(app2, 'capacitor.config.ts'), 'export default {}\n');
  writeFileSync(path.join(app2, 'package.json'), JSON.stringify({
    dependencies: { '@capacitor/core': '^8.0.0' },
    scripts: { build: 'vite build' },
  }));
  const cap2Plan = await detectBuildPlan(android2);
  assert.ok(cap2Plan);
  assert.deepEqual(cap2Plan.steps.map((step) => step.id), ['web', 'sync', 'gradle']);

  assert.equal(await detectBuildPlan(path.join(SANDBOX, 'missing')), null);
});

test('routes answer /status and /games over loopback HTTP', async () => {
  const root = makeGameRoot();
  const lab = new GameLab({}, { gameRoots: [root] });
  const route = { handler: null };
  const mockWebServer = {
    register(spec) {
      assert.equal(spec.kind, 'prefix');
      assert.equal(spec.path, ROUTE_PREFIX);
      route.handler = spec.handler;
      return () => { route.handler = null; };
    },
  };
  const disposeRoutes = mountRoutes(mockWebServer, lab);
  const server = http.createServer((req, res) => {
    if (req.url !== undefined && req.url.startsWith(ROUTE_PREFIX) && route.handler !== null) {
      route.handler(req, res);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const statusResponse = await fetch(`${origin}${ROUTE_PREFIX}/status`);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.ok, true);
    assert.equal(status.emulator.state, 'off');

    const gamesResponse = await fetch(`${origin}${ROUTE_PREFIX}/games`);
    assert.equal(gamesResponse.status, 200);
    const games = await gamesResponse.json();
    assert.equal(games.games.length, 3);

    const sameOriginHeaders = { 'content-type': 'application/json', origin };
    const heartbeat = await fetch(`${origin}${ROUTE_PREFIX}/heartbeat`, {
      method: 'POST',
      headers: sameOriginHeaders,
      body: '{}',
    });
    assert.equal(heartbeat.status, 200);
    assert.equal((await heartbeat.json()).ok, true);

    const fenced = await fetch(`${origin}${ROUTE_PREFIX}/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: '{}',
    });
    assert.equal(fenced.status, 403);

    const video = await fetch(`${origin}${ROUTE_PREFIX}/stream.h264`);
    assert.equal(video.status, 409);
    assert.equal((await video.json()).code, 'emulator_offline');
  } finally {
    disposeRoutes();
    await new Promise((resolve) => server.close(resolve));
    await lab.dispose();
  }
});
