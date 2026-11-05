// Game Lab host library: find Android APK builds and Gradle projects on disk,
// and read package metadata out of an APK with aapt2.
//
// Pure Node.js builtins only, ESM. No npm dependencies.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const AAPT2_TIMEOUT_MS = 20_000;
const AAPT2_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_APK_BYTES = 300 * 1024 * 1024;
const MAX_PROJECT_ANCESTORS = 7;
const MAX_ENRICHED_APKS = 12;
const STAT_CONCURRENCY = 32;
const DEFAULT_MAX_GAMES = 300;
const DEFAULT_MAX_PROJECTS = 40;
const DEFAULT_MAX_DEPTH = 5;
const IS_WINDOWS = process.platform === 'win32';
const AAPT2_BINARY_NAME = IS_WINDOWS ? 'aapt2.exe' : 'aapt2';

// Directories that are never interesting for games and are often enormous.
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.gradle',
  '.idea',
  '.vs',
  '.dart_tool',
  '__pycache__',
  '.venv',
  'venv',
  '.pnpm-store',
  'obj',
  '.godot',
  '.next',
  'dist',
  'coverage',
  // Agent worktrees duplicate the same game project many times; the main
  // checkout is enough for "build & play".
  '.agents',
]);

// A directory called "build" is kept on purpose: release APKs normally live in
// build/outputs. Only the bulky generated children below it are skipped.
const BUILD_SKIP_DIR_NAMES = new Set(['intermediates', 'tmp', '.transforms', 'kotlin']);

// Build "flavor" words that may trail a version token and should not become
// part of the group name. Any other word after the version token is kept.
const KNOWN_VARIANT_WORDS = new Set([
  'debug',
  'release',
  'preview',
  'online',
  'unsigned',
  'signed',
  'painted',
  'creator',
  '2d',
]);

const APK_SUFFIX_RE = /\.apk$/i;
const VERSION_TOKEN_RE = /^v?\d+(?:\.\d+)*$/i;
const GRADLE_SETTINGS_NAMES = ['settings.gradle', 'settings.gradle.kts'];
const GRADLE_WRAPPER_NAMES = IS_WINDOWS ? ['gradlew.bat', 'gradlew'] : ['gradlew', 'gradlew.bat'];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function nonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function isDirectoryEntrySkipped(name, parentIsBuild) {
  const lower = name.toLowerCase();
  if (SKIP_DIR_NAMES.has(lower)) return true;
  if (parentIsBuild && BUILD_SKIP_DIR_NAMES.has(lower)) return true;
  return false;
}

function detectWrapperName(entryNames) {
  for (const name of GRADLE_WRAPPER_NAMES) {
    if (entryNames.has(name)) return name;
  }
  return null;
}

function detectSettingsName(entryNames) {
  for (const name of GRADLE_SETTINGS_NAMES) {
    if (entryNames.has(name)) return name;
  }
  return null;
}

function isFromBuild(apkPath) {
  const segments = apkPath.toLowerCase().split(/[\\/]+/);
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === 'build' && segments[index + 1] === 'outputs') return true;
  }
  return false;
}

// Find the first separator in `stem` whose remainder is a pure version token,
// so "NineHeavensAscension_0.3.0" yields the "_0.3.0" suffix (not ".0").
function findVersionSuffixIndex(stem) {
  for (let index = 0; index < stem.length; index += 1) {
    const char = stem[index];
    if (char !== '-' && char !== '_' && char !== '.') continue;
    const token = stem.slice(index + 1);
    if (token.length > 0 && VERSION_TOKEN_RE.test(token)) return index;
  }
  return -1;
}

// Derive a group name from an APK file name by stripping a trailing version
// token plus (only) known variant words that follow it. A name without a
// version token is returned unchanged, e.g. "DemoGame-online-debug".
function deriveGroup(fileName) {
  const stem = fileName.replace(APK_SUFFIX_RE, '');
  if (stem.length === 0) return stem;
  const kept = [];
  let current = stem;
  for (let guard = 0; guard < 64; guard += 1) {
    const lastSegment = /^(.*)([-_.])([^-_.]+)$/.exec(current);
    if (lastSegment && KNOWN_VARIANT_WORDS.has(lastSegment[3].toLowerCase())) {
      current = lastSegment[1];
      continue;
    }
    const versionIndex = findVersionSuffixIndex(current);
    if (versionIndex >= 0) {
      let tail = '';
      for (let index = kept.length - 1; index >= 0; index -= 1) {
        tail += kept[index].separator + kept[index].token;
      }
      const group = current.slice(0, versionIndex) + tail;
      return group.length > 0 ? group : stem;
    }
    if (!lastSegment) break;
    kept.push({ separator: lastSegment[2], token: lastSegment[3] });
    current = lastSegment[1];
  }
  return stem;
}

// ---------------------------------------------------------------------------
// aapt2
// ---------------------------------------------------------------------------

function compareVersionNames(a, b) {
  const partsA = String(a).split('.');
  const partsB = String(b).split('.');
  const length = Math.max(partsA.length, partsB.length);
  for (let index = 0; index < length; index += 1) {
    const rawA = partsA[index] === undefined ? '0' : partsA[index];
    const rawB = partsB[index] === undefined ? '0' : partsB[index];
    const isNumberA = /^\d+$/.test(rawA);
    const isNumberB = /^\d+$/.test(rawB);
    if (isNumberA && isNumberB) {
      const numberA = Number(rawA);
      const numberB = Number(rawB);
      if (numberA !== numberB) return numberA < numberB ? -1 : 1;
      continue;
    }
    const textDiff = compareStrings(rawA, rawB);
    if (textDiff !== 0) return textDiff;
  }
  return 0;
}

/**
 * Locate the newest aapt2 executable inside an Android SDK directory.
 * Returns the absolute path, or null when the SDK has no usable build-tools.
 *
 * @param {string} sdkDir
 * @returns {string | null}
 */
export function resolveAapt2(sdkDir) {
  if (typeof sdkDir !== 'string' || sdkDir.length === 0) return null;
  const buildToolsDir = path.join(sdkDir, 'build-tools');
  let entries;
  try {
    entries = fs.readdirSync(buildToolsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const executable = path.join(buildToolsDir, entry.name, AAPT2_BINARY_NAME);
    try {
      if (fs.statSync(executable).isFile()) candidates.push({ version: entry.name, executable });
    } catch {
      // This build-tools version does not ship aapt2; try the next one.
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => compareVersionNames(b.version, a.version) || compareStrings(a.executable, b.executable));
  return path.resolve(candidates[0].executable);
}

function attrValue(line, key) {
  const match = new RegExp('(?:^|[\\s])' + key + "='([^']*)'").exec(line);
  return match ? match[1] : null;
}

function parseBadging(output) {
  if (typeof output !== 'string' || output.length === 0) return null;
  const packageLine = /^package:.*$/m.exec(output);
  if (!packageLine) return null;
  const packageName = attrValue(packageLine[0], 'name');
  if (!packageName) return null;
  const versionCode = attrValue(packageLine[0], 'versionCode');
  const versionName = attrValue(packageLine[0], 'versionName');

  let label = null;
  const exactLabel = /^application-label:'(.*)'\s*$/m.exec(output);
  if (exactLabel) {
    label = exactLabel[1];
  } else {
    const localeLabel = /^application-label-[^:]+:'(.*)'\s*$/m.exec(output);
    if (localeLabel) label = localeLabel[1];
  }

  const activityMatch = /^launchable-activity: name='([^']*)'/m.exec(output);

  return {
    packageName,
    label: label === null || label === '' ? null : label,
    versionName: versionName === null || versionName === '' ? null : versionName,
    versionCode: versionCode === null || versionCode === '' ? null : versionCode,
    launchableActivity: activityMatch ? activityMatch[1] : null,
  };
}

function runAapt2Badging(aapt2Path, apkPath) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(aapt2Path, ['dump', 'badging', apkPath], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      finish(true, new Error('aapt2 timed out after ' + AAPT2_TIMEOUT_MS + ' ms'));
    }, AAPT2_TIMEOUT_MS);

    function finish(failed, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // Already exited.
      }
      if (failed) reject(value);
      else resolve(value);
    }

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        if (settled) return;
        stdout += chunk;
        if (stdout.length > AAPT2_MAX_OUTPUT_BYTES) {
          finish(true, new Error('aapt2 output exceeded ' + AAPT2_MAX_OUTPUT_BYTES + ' bytes'));
        }
      });
    }
    if (child.stderr) child.stderr.resume();
    child.on('error', (error) => finish(true, error));
    child.on('close', (code, signal) => {
      if (settled) return;
      if (code === 0) finish(false, stdout);
      else finish(true, new Error('aapt2 exited with code ' + String(code) + (signal ? ' (' + String(signal) + ')' : '')));
    });
  });
}

/**
 * Read package metadata from an APK with `aapt2 dump badging`.
 * Returns null on any failure (missing file, spawn error, non-zero exit, timeout).
 * Never throws.
 *
 * @param {string} aapt2Path
 * @param {string} apkPath
 * @returns {Promise<null | { packageName: string, label: string | null, versionName: string | null, versionCode: string | null, launchableActivity: string | null }>}
 */
export async function apkInfo(aapt2Path, apkPath) {
  if (typeof aapt2Path !== 'string' || aapt2Path.length === 0) return null;
  if (typeof apkPath !== 'string' || apkPath.length === 0) return null;
  try {
    const stat = await fsp.stat(apkPath);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }
  let output;
  try {
    output = await runAapt2Badging(aapt2Path, apkPath);
  } catch {
    return null;
  }
  try {
    return parseBadging(output);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = [];
  for (let index = 0; index < workerCount; index += 1) {
    workers.push((async () => {
      for (;;) {
        const current = nextIndex;
        nextIndex += 1;
        if (current >= items.length) return;
        results[current] = await worker(items[current], current);
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

async function walkDirectory(dir, depth, maxDepth, state) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => compareStrings(a.name, b.name));
  try {
    const entryNames = new Set(entries.map((entry) => entry.name));
    const settingsName = detectSettingsName(entryNames);
    const wrapperName = detectWrapperName(entryNames);
    if (settingsName && wrapperName) {
      const key = dir.toLowerCase();
      if (!state.projectKeys.has(key)) {
        state.projectKeys.add(key);
        state.projectCandidates.push({ path: dir, settingsName, wrapperName });
      }
    }

    const parentIsBuild = path.basename(dir).toLowerCase() === 'build';
    const pending = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const name = entry.name;
      if (entry.isDirectory()) {
        if (isDirectoryEntrySkipped(name, parentIsBuild)) {
          state.skippedDirs.add(name);
          continue;
        }
        if (depth + 1 > maxDepth) continue;
        pending.push(walkDirectory(path.join(dir, name), depth + 1, maxDepth, state).catch(() => {}));
      } else if (APK_SUFFIX_RE.test(name)) {
        const fullPath = path.join(dir, name);
        const key = fullPath.toLowerCase();
        if (!state.apkPaths.has(key)) state.apkPaths.set(key, fullPath);
      }
    }
    if (pending.length > 0) await Promise.all(pending);
  } catch {
    // Tolerate unexpected entry shapes; the scan must never fail the page.
  }
}

async function collectWorkspace(roots, maxDepth) {
  const state = {
    apkPaths: new Map(),
    projectCandidates: [],
    projectKeys: new Set(),
    skippedDirs: new Set(),
  };
  for (const root of roots) {
    // Walk the resolved path so every reported APK/project path is absolute.
    await walkDirectory(path.resolve(root), 0, maxDepth, state);
  }
  return state;
}

function compareGamesByRecency(a, b) {
  if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
  return compareStrings(a.path, b.path);
}

async function statGames(apkPaths) {
  const stats = await mapWithConcurrency(apkPaths, STAT_CONCURRENCY, async (apkPath) => {
    try {
      const stat = await fsp.stat(apkPath);
      if (!stat.isFile() || stat.size > MAX_APK_BYTES) return null;
      return { path: apkPath, sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  });
  return stats.filter((entry) => entry !== null).sort(compareGamesByRecency);
}

function isGradleProjectDir(dir) {
  try {
    const settingsFound = GRADLE_SETTINGS_NAMES.some((name) => fs.existsSync(path.join(dir, name)));
    if (!settingsFound) return false;
    return GRADLE_WRAPPER_NAMES.some((name) => fs.existsSync(path.join(dir, name)));
  } catch {
    return false;
  }
}

function createProjectLookup() {
  const cache = new Map();
  return function lookupProject(startDir) {
    const visited = [];
    let dir = startDir;
    let result = null;
    for (let hop = 0; hop <= MAX_PROJECT_ANCESTORS; hop += 1) {
      const key = dir.toLowerCase();
      if (cache.has(key)) {
        result = cache.get(key);
        break;
      }
      visited.push(key);
      if (isGradleProjectDir(dir)) {
        result = dir;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    for (const key of visited) cache.set(key, result);
    return result;
  };
}

function buildGames(statList, lookupProject) {
  const games = statList.map((stat) => {
    const fileName = path.basename(stat.path);
    const dir = path.dirname(stat.path);
    return {
      id: 'apk:' + stat.path.toLowerCase(),
      kind: 'apk',
      path: stat.path,
      fileName,
      dir,
      sizeBytes: stat.sizeBytes,
      mtimeMs: stat.mtimeMs,
      group: deriveGroup(fileName),
      isLatest: false,
      versions: 0,
      packageName: null,
      label: null,
      versionName: null,
      versionCode: null,
      launchableActivity: null,
      projectPath: lookupProject(dir),
      fromBuild: isFromBuild(stat.path),
    };
  });

  const groups = new Map();
  for (const game of games) {
    const existing = groups.get(game.group);
    if (existing) existing.push(game);
    else groups.set(game.group, [game]);
  }
  for (const group of groups.values()) {
    let latest = group[0];
    for (const game of group) {
      if (game.mtimeMs > latest.mtimeMs) latest = game;
      else if (game.mtimeMs === latest.mtimeMs && game.fileName > latest.fileName) latest = game;
    }
    for (const game of group) game.versions = group.length;
    latest.isLatest = true;
  }
  return games;
}

async function statProjects(projectCandidates) {
  const projects = await mapWithConcurrency(projectCandidates, STAT_CONCURRENCY, async (candidate) => {
    let mtimeMs = 0;
    try {
      const settingsStat = await fsp.stat(path.join(candidate.path, candidate.settingsName));
      mtimeMs = settingsStat.mtimeMs;
    } catch {
      try {
        const dirStat = await fsp.stat(candidate.path);
        mtimeMs = dirStat.mtimeMs;
      } catch {
        mtimeMs = 0;
      }
    }
    return {
      path: candidate.path,
      name: path.basename(candidate.path),
      gradlew: path.join(candidate.path, candidate.wrapperName),
      mtimeMs,
    };
  });
  return projects.sort((a, b) => (b.mtimeMs - a.mtimeMs) || compareStrings(a.path, b.path));
}

function buildProjects(projectStats, games, maxProjects) {
  const apkProjectPaths = new Set();
  for (const game of games) {
    if (game.projectPath) apkProjectPaths.add(game.projectPath.toLowerCase());
  }
  const projectsCapped = projectStats.length > maxProjects;
  const projects = projectStats.slice(0, maxProjects).map((project) => ({
    id: 'gradle:' + project.path.toLowerCase(),
    kind: 'gradle',
    path: project.path,
    name: project.name,
    gradlew: project.gradlew,
    mtimeMs: project.mtimeMs,
    hasApk: apkProjectPaths.has(project.path.toLowerCase()),
  }));
  return { projects, projectsCapped };
}

async function enrichGameInfo(games, totalApkCount, aapt2Path) {
  if (!aapt2Path) return;
  if (totalApkCount === 0 || totalApkCount > MAX_ENRICHED_APKS) return;
  for (const game of games) {
    const info = await apkInfo(aapt2Path, game.path);
    if (!info) continue;
    game.packageName = info.packageName;
    game.label = info.label;
    game.versionName = info.versionName;
    game.versionCode = info.versionCode;
    game.launchableActivity = info.launchableActivity;
  }
}

/**
 * Scan one or more roots for Android APK builds and Gradle projects.
 * Never throws: unreadable roots and broken entries are simply skipped.
 *
 * @param {{
 *   roots: string[],
 *   maxGames?: number,
 *   maxProjects?: number,
 *   maxDepth?: number,
 *   aapt2Path?: string | null,
 *   now?: number,
 * }} options
 * @returns {Promise<{
 *   ok: true,
 *   scan: {
 *     roots: string[],
 *     startedAt: number,
 *     tookMs: number,
 *     truncated: boolean,
 *     gamesCapped: boolean,
 *     projectsCapped: boolean,
 *     aapt2: string | null,
 *     skippedDirs: string[],
 *   },
 *   games: object[],
 *   projects: object[],
 * }>}
 */
export async function scanLibrary(options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const roots = Array.isArray(settings.roots)
    ? settings.roots.filter((root) => typeof root === 'string' && root.length > 0)
    : [];
  const maxGames = nonNegativeInteger(settings.maxGames, DEFAULT_MAX_GAMES);
  const maxProjects = nonNegativeInteger(settings.maxProjects, DEFAULT_MAX_PROJECTS);
  const maxDepth = nonNegativeInteger(settings.maxDepth, DEFAULT_MAX_DEPTH);
  const aapt2Path = typeof settings.aapt2Path === 'string' && settings.aapt2Path.length > 0
    ? settings.aapt2Path
    : null;
  const startedAt = Number.isFinite(settings.now) ? settings.now : Date.now();
  const clockStart = Date.now();

  const scan = {
    roots: roots.slice(),
    startedAt,
    tookMs: 0,
    truncated: false,
    gamesCapped: false,
    projectsCapped: false,
    aapt2: aapt2Path,
    skippedDirs: [],
  };

  let games = [];
  let projects = [];

  try {
    const collected = await collectWorkspace(roots, maxDepth);
    const apkStats = await statGames([...collected.apkPaths.values()]);

    scan.gamesCapped = apkStats.length > maxGames;
    const selectedGameStats = apkStats.slice(0, maxGames);

    const lookupProject = createProjectLookup();
    games = buildGames(selectedGameStats, lookupProject);

    const projectStats = await statProjects(collected.projectCandidates);
    const builtProjects = buildProjects(projectStats, games, maxProjects);
    projects = builtProjects.projects;
    scan.projectsCapped = builtProjects.projectsCapped;

    scan.truncated = scan.gamesCapped || scan.projectsCapped;
    scan.skippedDirs = [...collected.skippedDirs].sort(compareStrings);

    await enrichGameInfo(games, apkStats.length, aapt2Path);
  } catch {
    // A scan must never fail the host page; keep whatever was assembled.
    scan.truncated = scan.gamesCapped || scan.projectsCapped;
  }

  scan.tookMs = Date.now() - clockStart;
  return { ok: true, scan, games, projects };
}
