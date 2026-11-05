import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { apkInfo, resolveAapt2, scanLibrary } from './library.js';

// Portable fixtures: everything these tests need is created in a temp folder.
// The two optional tests use GAME_LAB_TEST_APK / GAME_LAB_TEST_RELEASES when a
// real APK is available (aapt2 metadata / lazy-enrichment behaviour).
const SANDBOX = mkdtempSync(path.join(tmpdir(), 'game-lab-library-'));
after(() => {
  rmSync(SANDBOX, { recursive: true, force: true });
});

const SDK_DIR = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
const AAPT2_BASENAME = process.platform === 'win32' ? 'aapt2.exe' : 'aapt2';
const OPTIONAL_APK = process.env.GAME_LAB_TEST_APK || '';
const OPTIONAL_RELEASES = process.env.GAME_LAB_TEST_RELEASES || '';

function writeFixture(file, bytes = 1024, secondsAgo = 0) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.alloc(bytes, 0x41));
  if (secondsAgo > 0) {
    const stamp = new Date(Date.now() - secondsAgo * 1000);
    utimesSync(file, stamp, stamp);
  }
  return file;
}

function groupGames(games) {
  const groups = new Map();
  for (const game of games) {
    const existing = groups.get(game.group);
    if (existing) existing.push(game);
    else groups.set(game.group, [game]);
  }
  return groups;
}

function assertGroupsConsistent(games) {
  for (const [name, group] of groupGames(games)) {
    assert.equal(group.filter((game) => game.isLatest).length, 1, `group ${name} needs one latest`);
    for (const game of group) assert.equal(game.versions, group.length);
  }
}

test('resolveAapt2 finds aapt2 when an SDK is available', (t) => {
  if (SDK_DIR === '' || !existsSync(SDK_DIR)) {
    t.skip('no ANDROID_HOME / ANDROID_SDK_ROOT on this machine');
    return;
  }
  const resolved = resolveAapt2(SDK_DIR);
  if (resolved === null) {
    t.skip('no build-tools aapt2 under ' + SDK_DIR);
    return;
  }
  assert.ok(resolved.endsWith(AAPT2_BASENAME));
  assert.equal(existsSync(resolved), true);
  assert.equal(resolveAapt2(path.join(SDK_DIR, 'missing-sdk')), null);
  assert.equal(resolveAapt2(''), null);
});

test('scanLibrary groups versioned builds and keeps plain names', async () => {
  const releases = path.join(SANDBOX, 'releases');
  writeFixture(path.join(releases, 'DemoGame-v1.00.apk'), 2048, 300);
  writeFixture(path.join(releases, 'DemoGame-v2.00-debug.apk'), 2048, 200);
  writeFixture(path.join(releases, 'DemoGame-v2.01.apk'), 2048, 100);
  writeFixture(path.join(releases, 'OtherGame-online-debug.apk'), 4096, 50);

  const result = await scanLibrary({ roots: [releases], maxGames: 50 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.scan.roots, [releases]);
  assert.equal(result.scan.aapt2, null);
  assert.equal(result.games.length, 4);
  assert.deepEqual(result.projects, []);
  for (const game of result.games) {
    assert.equal(game.kind, 'apk');
    assert.equal(game.id, 'apk:' + game.path.toLowerCase());
    assert.equal(game.fromBuild, false);
    assert.equal(game.projectPath, null);
    assert.equal(game.packageName, null);
    assert.equal(game.label, null);
    assert.ok(game.path.endsWith('.apk'));
  }

  const groups = groupGames(result.games);
  assert.deepEqual([...groups.keys()].sort(), ['DemoGame', 'OtherGame-online-debug']);
  const demo = groups.get('DemoGame');
  assert.equal(demo.length, 3);
  assert.equal(demo.filter((game) => game.isLatest).length, 1);
  assert.equal(demo.find((game) => game.isLatest).fileName, 'DemoGame-v2.01.apk');
  assert.equal(new Set(demo.map((game) => game.versions)).size, 1);
  assertGroupsConsistent(result.games);
  // Newest first, by mtime.
  for (let index = 1; index < result.games.length; index += 1) {
    assert.ok(result.games[index - 1].mtimeMs >= result.games[index].mtimeMs);
  }
});

test('scanLibrary links build-output APKs to their Gradle project', async () => {
  const project = path.join(SANDBOX, 'demo-project');
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, 'settings.gradle'), 'rootProject.name = "demo"\n');
  writeFileSync(path.join(project, 'gradlew.bat'), '@echo off\r\n');
  writeFixture(path.join(project, 'build', 'outputs', 'apk', 'debug', 'demo.apk'), 1024, 10);

  const result = await scanLibrary({ roots: [project], maxGames: 100, maxProjects: 10 });
  assert.equal(result.ok, true);
  const projectEntry = result.projects.find((entry) => entry.path === project);
  assert.ok(projectEntry, 'expected the demo Gradle project');
  assert.equal(projectEntry.kind, 'gradle');
  assert.equal(projectEntry.name, 'demo-project');
  assert.match(projectEntry.gradlew, /gradlew(\.bat)?$/);
  assert.equal(projectEntry.hasApk, true);

  const buildGame = result.games.find((game) => game.fileName === 'demo.apk');
  assert.ok(buildGame);
  assert.equal(buildGame.fromBuild, true);
  assert.equal(buildGame.projectPath, project);
});

test('scanLibrary survives a missing root', async () => {
  const missing = path.join(SANDBOX, 'does-not-exist');
  const result = await scanLibrary({ roots: [missing] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.games, []);
  assert.deepEqual(result.projects, []);
  assert.deepEqual(result.scan.roots, [missing]);
  assert.equal(result.scan.truncated, false);
  assert.equal(result.scan.aapt2, null);
});

test('apkInfo reads a real APK when a fixture is provided', { timeout: 30_000 }, async (t) => {
  if (OPTIONAL_APK === '' || !existsSync(OPTIONAL_APK)) {
    t.skip('set GAME_LAB_TEST_APK to run the aapt2 metadata test');
    return;
  }
  if (SDK_DIR === '' || resolveAapt2(SDK_DIR) === null) {
    t.skip('aapt2 is not available');
    return;
  }
  const info = await apkInfo(resolveAapt2(SDK_DIR), OPTIONAL_APK);
  assert.ok(info, 'apkInfo should return metadata for a readable APK');
  assert.equal(typeof info.packageName, 'string');
  assert.ok(info.packageName.length > 0);
  assert.equal(await apkInfo(resolveAapt2(SDK_DIR), path.join(SANDBOX, 'missing.apk')), null);
});

test('scanLibrary keeps metadata lazy for large real scans', { timeout: 60_000 }, async (t) => {
  if (OPTIONAL_RELEASES === '' || !existsSync(OPTIONAL_RELEASES)) {
    t.skip('set GAME_LAB_TEST_RELEASES to a folder with >12 real APKs');
    return;
  }
  if (SDK_DIR === '' || resolveAapt2(SDK_DIR) === null) {
    t.skip('aapt2 is not available');
    return;
  }
  const result = await scanLibrary({
    roots: [OPTIONAL_RELEASES],
    maxGames: 500,
    aapt2Path: resolveAapt2(SDK_DIR),
  });
  assert.equal(result.scan.aapt2, resolveAapt2(SDK_DIR));
  assert.ok(result.games.length > 12);
  for (const game of result.games) {
    assert.equal(game.packageName, null);
    assert.equal(game.label, null);
  }
});
