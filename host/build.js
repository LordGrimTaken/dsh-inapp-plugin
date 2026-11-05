/**
 * Build-plan detection for Game Lab.
 *
 * The user's games are not plain Gradle projects: most are Capacitor apps
 * whose web bundle must be rebuilt and synced into android/ before Gradle
 * packages it. Running only `gradlew assembleDebug` therefore installs stale
 * web assets. This module looks at the project layout (package.json,
 * capacitor config, android/ dir, npm scripts) and returns an ordered plan of
 * shell steps plus where to look for the produced APK.
 *
 * Everything here is read-only detection; the emulator controller runs the
 * steps and owns logging/timeouts.
 */

import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const CAPACITOR_CONFIGS = ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json', 'capacitor.config.mjs', 'capacitor.config.cjs']

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

function hasGradle(androidDir) {
  return existsSync(path.join(androidDir, 'gradlew.bat'))
    || existsSync(path.join(androidDir, 'gradlew'))
}

async function hasCapacitorConfig(root) {
  for (const name of CAPACITOR_CONFIGS) {
    if (existsSync(path.join(root, name))) return true
  }
  return false
}

async function androidChild(root) {
  const candidate = path.join(root, 'android')
  if (existsSync(candidate) && hasGradle(candidate)) return candidate
  return null
}

/**
 * Detect how to build one game project.
 *
 * @param {string} projectPath absolute path to a Gradle project (often the
 *   android/ directory) or a Capacitor app root.
 * @returns {Promise<null | {
 *   kind: 'gradle' | 'capacitor',
 *   projectRoot: string,
 *   appRoot: string | null,
 *   androidDir: string,
 *   steps: { id: string, label: string, command: string, args: string[], cwd: string }[],
 *   searchRoots: string[],
 *   notes: string[]
 * }>}
 */
export async function detectBuildPlan(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim() === '') return null
  const selected = path.resolve(projectPath)
  if (!existsSync(selected)) return null

  const notes = []
  let androidDir = null
  if (hasGradle(selected)) androidDir = selected
  else androidDir = await androidChild(selected)

  // The selected row is usually <app>/android. Walk up a little to find the
  // JavaScript app root that owns the Capacitor config and npm scripts.
  const candidates = []
  let cursor = selected
  for (let depth = 0; depth < 3; depth += 1) {
    candidates.push(cursor)
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  if (androidDir !== null && path.basename(androidDir) === 'android') {
    candidates.unshift(path.dirname(androidDir))
  }

  let appRoot = null
  let pkg = null
  let capacitor = false
  for (const candidate of candidates) {
    const packageFile = path.join(candidate, 'package.json')
    if (!existsSync(packageFile)) continue
    const parsed = await readJson(packageFile)
    if (parsed === null) continue
    const hasCap = await hasCapacitorConfig(candidate)
    const deps = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) }
    const looksCap = hasCap || Object.keys(deps).some((name) => name.startsWith('@capacitor/'))
    if (appRoot === null && (looksCap || Object.keys(parsed.scripts ?? {}).length > 0)) {
      appRoot = candidate
      pkg = parsed
      capacitor = looksCap
    }
    if (looksCap) break
  }

  if (androidDir === null) {
    const fallback = appRoot !== null ? await androidChild(appRoot) : null
    if (fallback !== null) androidDir = fallback
  }
  if (androidDir === null) {
    notes.push('no Gradle wrapper found')
    return null
  }

  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
  const androidStep = {
    id: 'gradle',
    label: 'Gradle assembleDebug',
    command: gradlew,
    args: ['assembleDebug', '--console=plain'],
    cwd: androidDir,
  }

  const steps = []
  const scripts = pkg !== null && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
  if (capacitor && appRoot !== null && typeof scripts['android:apk'] === 'string') {
    // The project already owns its full canonical pipeline; run exactly that.
    steps.push({
      id: 'project',
      label: 'npm run android:apk',
      command: 'npm',
      args: ['run', 'android:apk'],
      cwd: appRoot,
    })
    notes.push('using the project\'s android:apk script (web build + cap sync + Gradle)')
  } else if (capacitor && appRoot !== null) {
    if (typeof scripts.build === 'string') {
      steps.push({ id: 'web', label: 'npm run build', command: 'npm', args: ['run', 'build'], cwd: appRoot })
    } else {
      notes.push('no npm build script; web assets are used as-is')
    }
    steps.push({
      id: 'sync',
      label: 'npx cap sync android',
      command: 'npx',
      args: ['--no-install', 'cap', 'sync', 'android'],
      cwd: appRoot,
    })
    steps.push(androidStep)
  } else {
    steps.push(androidStep)
  }

  return {
    kind: capacitor ? 'capacitor' : 'gradle',
    projectRoot: selected,
    appRoot,
    androidDir,
    steps,
    searchRoots: [androidDir, ...(appRoot !== null && appRoot !== androidDir ? [appRoot] : [])],
    notes,
  }
}

/** True when a directory contains a Capacitor-style package.json. */
export async function looksLikeCapacitor(root) {
  if (!(await hasCapacitorConfig(root))) {
    const pkg = await readJson(path.join(root, 'package.json'))
    const deps = pkg === null ? {} : { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    return Object.keys(deps).some((name) => name.startsWith('@capacitor/'))
  }
  return true
}

/** Find APKs under a directory tree (bounded), newest first. */
export async function listApks(root, maxFiles = 40) {
  const found = []
  const visit = async (dir, depth) => {
    if (depth < 0 || found.length >= maxFiles) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= maxFiles) return
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.gradle' || entry.name === 'intermediates') continue
        await visit(path.join(dir, entry.name), depth - 1)
      } else if (entry.isFile() && /\.apk$/i.test(entry.name)) {
        found.push(path.join(dir, entry.name))
      }
    }
  }
  await visit(root, 7)
  return found
}
