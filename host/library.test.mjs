import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import { apkInfo, resolveAapt2, scanLibrary } from './library.js';

// Real fixtures on this machine. Each test skips gracefully when its fixture
// is missing, and no test writes to disk.
const SDK_DIR = 'C:\\Users\\Austin\\dev\\tools\\android-sdk';
const SHADOWMIRE_APK = 'C:\\dev\\dsh-workspace\\Shadowmire-online-debug.apk';
const RELEASES_DIR = 'C:\\dev\\dsh-workspace\\hundred-hearths\\app\\releases';
const WORKSPACE_DIR = 'C:\\dev\\dsh-workspace';
const LIUYING_DIR = 'C:\\dev\\dsh-workspace\\liuying';
const DELIVERABLES_DIR = 'C:\\dev\\dsh-workspace\\deliverables';
const MISSING_ROOT = 'C:\\does\\not\\exist';
const AAPT2_BASENAME = process.platform === 'win32' ? 'aapt2.exe' : 'aapt2';

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
  for (const [groupName, group] of groupGames(games)) {
    assert.equal(
      group.filter((game) => game.isLatest).length,
      1,
      'group ' + groupName + ' should have exactly one isLatest entry',
    );
    for (const game of group) {
      assert.equal(game.versions, group.length, 'versions count for ' + groupName);
    }
  }
}

function assertSortedNewestFirst(games) {
  for (let index = 1; index < games.length; index += 1) {
    assert.ok(
      games[index - 1].mtimeMs >= games[index].mtimeMs,
      'games should be sorted by mtime descending',
    );
  }
}

test('resolveAapt2 finds the newest build-tools aapt2', () => {
  const resolved = resolveAapt2(SDK_DIR);
  assert.ok(resolved, 'expected an aapt2 under ' + SDK_DIR);
  assert.ok(
    resolved.endsWith(AAPT2_BASENAME),
    'expected a path ending in ' + AAPT2_BASENAME + ', got ' + resolved,
  );
  assert.equal(existsSync(resolved), true);
  assert.equal(resolveAapt2('C:\\dev\\tools\\definitely-missing-sdk'), null);
  assert.equal(resolveAapt2(''), null);
});

test('apkInfo reads real badging from an APK', { timeout: 30_000 }, async (t) => {
  if (!existsSync(SHADOWMIRE_APK)) {
    t.skip('fixture APK is missing');
    return;
  }
  const aapt2 = resolveAapt2(SDK_DIR);
  if (!aapt2) {
    t.skip('aapt2 is not available in the Android SDK');
    return;
  }
  const info = await apkInfo(aapt2, SHADOWMIRE_APK);
  assert.ok(info, 'apkInfo should return metadata for a readable APK');
  assert.equal(info.packageName, 'com.shadowmire.game');
  assert.equal(typeof info.label, 'string');
  assert.ok(info.label.length > 0, 'label should be non-empty');
  if (info.versionCode !== null) assert.match(info.versionCode, /^\d+$/);
  if (info.versionName !== null) assert.ok(info.versionName.length > 0);
  assert.equal(await apkInfo(aapt2, 'C:\\does\\not\\exist\\missing.apk'), null);
});

test('scanLibrary finds release APKs and version groups', { timeout: 30_000 }, async (t) => {
  if (!existsSync(RELEASES_DIR)) {
    t.skip('release directory is missing');
    return;
  }
  const result = await scanLibrary({ roots: [RELEASES_DIR], maxGames: 500 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.scan.roots, [RELEASES_DIR]);
  assert.equal(typeof result.scan.startedAt, 'number');
  assert.equal(typeof result.scan.tookMs, 'number');
  assert.ok(Array.isArray(result.games));
  assert.ok(
    result.games.length >= 30,
    'expected at least 30 APKs, found ' + result.games.length,
  );
  assert.deepEqual(result.scan.skippedDirs, []);
  assert.equal(result.scan.aapt2, null);
  assert.equal(result.scan.gamesCapped, false);
  assert.deepEqual(result.projects, []);

  for (const game of result.games) {
    assert.equal(game.kind, 'apk');
    assert.equal(game.id, 'apk:' + game.path.toLowerCase());
    assert.equal(game.fromBuild, false);
    assert.equal(game.projectPath, null);
    // No aapt2Path was passed, so metadata must stay lazy.
    assert.equal(game.packageName, null);
    assert.equal(game.label, null);
    assert.ok(game.path.toLowerCase().endsWith('.apk'));
    assert.ok(game.fileName.length > 0);
    assert.equal(game.group.length > 0, true);
  }
  assertSortedNewestFirst(result.games);
  assertGroupsConsistent(result.games);

  const groups = groupGames(result.games);
  const lanterns = groups.get('LittleLanterns');
  assert.ok(lanterns && lanterns.length > 1, 'expected a LittleLanterns group');
  assert.equal(lanterns.filter((game) => game.isLatest).length, 1);
  const lanternLatest = lanterns.filter((game) => game.isLatest)[0];
  assert.equal(lanternLatest.mtimeMs, Math.max(...lanterns.map((game) => game.mtimeMs)));
  assert.ok(lanterns.every((game) => game.group === 'LittleLanterns'));

  const hearths = groups.get('HundredHearths');
  assert.ok(hearths && hearths.length >= 10, 'expected a HundredHearths group');
});

test('scanLibrary survives a missing root', async () => {
  const result = await scanLibrary({ roots: [MISSING_ROOT] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.games, []);
  assert.deepEqual(result.projects, []);
  assert.deepEqual(result.scan.roots, [MISSING_ROOT]);
  assert.equal(result.scan.gamesCapped, false);
  assert.equal(result.scan.projectsCapped, false);
  assert.equal(result.scan.truncated, false);
  assert.equal(result.scan.aapt2, null);
  assert.deepEqual(result.scan.skippedDirs, []);
  assert.equal(typeof result.scan.tookMs, 'number');
});

test('scanLibrary links build-output APKs to their Gradle project', { timeout: 30_000 }, async (t) => {
  if (!existsSync(LIUYING_DIR)) {
    t.skip('liuying fixture project is missing');
    return;
  }
  const result = await scanLibrary({ roots: [LIUYING_DIR], maxGames: 500, maxProjects: 500 });
  assert.equal(result.ok, true);
  assert.ok(result.games.length >= 2, 'expected build APKs under liuying');
  assert.equal(result.scan.truncated, false);

  const buildGames = result.games.filter((game) => game.fromBuild);
  assert.ok(buildGames.length >= 1, 'expected at least one build/outputs APK');
  for (const game of buildGames) {
    assert.equal(game.path.toLowerCase().includes('\\build\\outputs\\'), true);
    assert.equal(game.projectPath, LIUYING_DIR);
  }

  const project = result.projects.find((entry) => entry.path === LIUYING_DIR);
  assert.ok(project, 'expected the liuying Gradle project');
  assert.equal(project.id, 'gradle:' + LIUYING_DIR.toLowerCase());
  assert.equal(project.kind, 'gradle');
  assert.equal(project.name, 'liuying');
  assert.match(project.gradlew, /gradlew(\.bat)?$/);
  assert.equal(project.hasApk, true);
  assert.equal(typeof project.mtimeMs, 'number');
});

test('scanLibrary scans the workspace fast and keeps version names apart', { timeout: 60_000 }, async (t) => {
  if (!existsSync(WORKSPACE_DIR)) {
    t.skip('workspace is missing');
    return;
  }
  const result = await scanLibrary({ roots: [WORKSPACE_DIR], maxGames: 500 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.scan.roots, [WORKSPACE_DIR]);
  assert.ok(
    result.games.length >= 100,
    'expected at least 100 APKs in the workspace, found ' + result.games.length,
  );
  assert.ok(result.scan.tookMs < 5_000, 'scan took ' + result.scan.tookMs + ' ms');
  assert.equal(result.scan.skippedDirs.includes('node_modules'), true);
  assert.ok(result.projects.length >= 1);
  assert.ok(result.projects.length <= 40, 'default maxProjects should cap project count');
  assertSortedNewestFirst(result.games);
  assertGroupsConsistent(result.games);

  // A name without a version token stays as is.
  const shadowOnline = result.games.find((game) => game.fileName === 'Shadowmire-online-debug.apk');
  assert.ok(shadowOnline, 'expected Shadowmire-online-debug.apk in the workspace');
  assert.equal(shadowOnline.group, 'Shadowmire-online-debug');

  // A trailing version token plus a known variant word is stripped.
  const shadowVersioned = result.games.find((game) => game.fileName === 'Shadowmire-v0.6.0-debug.apk');
  assert.ok(shadowVersioned, 'expected Shadowmire-v0.6.0-debug.apk in the workspace');
  assert.equal(shadowVersioned.group, 'Shadowmire');

  const lanterns = groupGames(result.games).get('LittleLanterns');
  assert.ok(lanterns && lanterns.length >= 20, 'expected LittleLanterns builds in the workspace');
});

test('scanLibrary only enriches small scans when aapt2 is provided', { timeout: 60_000 }, async (t) => {
  if (!existsSync(RELEASES_DIR) || !existsSync(DELIVERABLES_DIR)) {
    t.skip('fixtures are missing');
    return;
  }
  const aapt2 = resolveAapt2(SDK_DIR);
  if (!aapt2) {
    t.skip('aapt2 is not available in the Android SDK');
    return;
  }

  const large = await scanLibrary({ roots: [RELEASES_DIR], maxGames: 500, aapt2Path: aapt2 });
  assert.equal(large.scan.aapt2, aapt2);
  assert.ok(large.games.length > 12);
  for (const game of large.games) {
    assert.equal(game.packageName, null);
    assert.equal(game.label, null);
  }

  const small = await scanLibrary({ roots: [DELIVERABLES_DIR], maxGames: 500, aapt2Path: aapt2 });
  assert.equal(small.scan.aapt2, aapt2);
  assert.ok(small.games.length > 0, 'expected APKs under deliverables');
  if (small.games.length <= 12) {
    const enriched = small.games.filter((game) => typeof game.packageName === 'string');
    assert.ok(enriched.length > 0, 'expected at least one enriched APK');
    for (const game of enriched) {
      assert.ok(game.packageName.length > 0);
      assert.equal(game.label === null || typeof game.label === 'string', true);
      assert.equal(game.versionName === null || typeof game.versionName === 'string', true);
      assert.equal(game.versionCode === null || typeof game.versionCode === 'string', true);
      assert.equal(
        game.launchableActivity === null || typeof game.launchableActivity === 'string',
        true,
      );
    }
  }
});
