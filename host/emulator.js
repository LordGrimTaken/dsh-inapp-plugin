/**
 * Game Lab host controller.
 *
 * Owns one lean, headless Android emulator for testing the games this user
 * builds. Design goals, in order:
 *   1. Nothing runs until the user presses Start: no emulator, no CPU.
 *   2. A low-spec AVD (720x1280, 2 vCPU, 2 GB RAM, no snapshots) so the
 *      machine keeps its memory; frames are only produced while the page is
 *      watching, and the emulator shuts down after an idle period.
 *   3. The browser talks to this module only through the DSH webserver routes
 *      in routes.js; the page never sees adb and there is no extra port.
 *
 * Everything here is plain ESM with Node builtins, because the plugin runs in
 * the DSH host process and is loaded as a local bundle.
 */

import { spawn, execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { FrameLoop, MultipartWriter } from './frame.js'
import { scanLibrary, apkInfo, resolveAapt2 } from './library.js'

const IS_WINDOWS = process.platform === 'win32'
const PLUGIN = 'game-lab'
/** Bumped when the host module changes so a live reload can be verified. */
export const HOST_BUILD = '2026-11-05.5'

const DEFAULT_CONFIG = {
  /** AVD this panel owns. Created on first start when it is missing. */
  avdName: 'gamelab',
  /** Guest RAM and vCPU count for that AVD. */
  ramMb: 2048,
  cores: 2,
  /** Emulator GPU mode: host (uses the real GPU, lower CPU) or swiftshader_indirect. */
  gpuMode: 'host',
  /** Frames per second cap for the live view. Lower = less CPU. */
  maxFps: 8,
  /** Stop the emulator after this many minutes with no page/input activity. */
  idleMinutes: 5,
  /** Where the game library is discovered. */
  gameRoots: [],
  /** Hard bound on a cold boot. */
  bootTimeoutMs: 240000,
  /** Optional explicit SDK directory; auto-detected when empty. */
  sdkDir: null,
}

/** Command name for the current platform. */
function exe(name) {
  return IS_WINDOWS ? `${name}.exe` : name
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Locate one executable name on PATH. */
function findOnPath(name) {
  const extensions = IS_WINDOWS ? ['.exe', '.cmd', '.bat', ''] : ['']
  const entries = String(process.env.PATH ?? '').split(path.delimiter)
  for (const entry of entries) {
    if (entry === '') continue
    for (const extension of extensions) {
      const candidate = path.join(entry, name + extension)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** Find the highest-versioned avdmanager under an SDK root. */
function findAvdManager(sdkDir) {
  if (typeof sdkDir !== 'string' || sdkDir === '') return null
  const binName = IS_WINDOWS ? 'avdmanager.bat' : 'avdmanager'
  const roots = [path.join(sdkDir, 'cmdline-tools', 'latest', 'bin')]
  const cmdlineTools = path.join(sdkDir, 'cmdline-tools')
  try {
    for (const entry of readdirSync(cmdlineTools)) roots.push(path.join(cmdlineTools, entry, 'bin'))
  } catch {
    // cmdline-tools is optional.
  }
  for (const root of roots) {
    const candidate = path.join(root, binName)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Resolve adb / emulator / aapt2 from an explicit setting, ANDROID_HOME,
 * ANDROID_SDK_ROOT, the platform default SDK path, or PATH.
 */
export function resolveToolchain(settings = {}) {
  const candidates = []
  const push = (dir) => {
    if (typeof dir !== 'string' || dir.trim() === '') return
    const resolved = path.resolve(dir.trim())
    if (!candidates.includes(resolved)) candidates.push(resolved)
  }
  push(settings.sdkDir)
  push(process.env.ANDROID_HOME)
  push(process.env.ANDROID_SDK_ROOT)
  if (IS_WINDOWS) push(path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'))

  const adbOnPath = findOnPath('adb')
  if (adbOnPath !== null) push(path.dirname(path.dirname(adbOnPath)))
  const emulatorOnPath = findOnPath('emulator')

  for (const sdkDir of candidates) {
    const adb = path.join(sdkDir, 'platform-tools', exe('adb'))
    const emulator = path.join(sdkDir, 'emulator', exe('emulator'))
    if (existsSync(adb) && existsSync(emulator)) {
      return {
        ok: true,
        sdkDir,
        adb,
        emulator,
        aapt2: resolveAapt2(sdkDir),
        avdmanager: findAvdManager(sdkDir),
      }
    }
  }

  // Last resort: tools on PATH (emulator launches AVDs from its own SDK root).
  if (adbOnPath !== null || emulatorOnPath !== null) {
    const sdkDir = adbOnPath !== null ? path.dirname(path.dirname(adbOnPath)) : null
    return {
      ok: adbOnPath !== null && emulatorOnPath !== null,
      sdkDir,
      adb: adbOnPath,
      emulator: emulatorOnPath,
      aapt2: sdkDir === null ? null : resolveAapt2(sdkDir),
      avdmanager: findAvdManager(sdkDir),
      reason: adbOnPath === null || emulatorOnPath === null
        ? 'adb and the emulator launcher must both be installed (Android SDK platform-tools + emulator)'
        : undefined,
    }
  }

  return {
    ok: false,
    sdkDir: null,
    adb: null,
    emulator: null,
    aapt2: null,
    avdmanager: null,
    reason: 'Android SDK not found: set ANDROID_HOME or the plugin config sdkDir',
  }
}

/** Fill defaults, clamp dangerous values and drop unusable roots. */
export function normalizeConfig(raw) {
  const config = { ...DEFAULT_CONFIG }
  if (isRecord(raw)) {
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (raw[key] !== undefined && raw[key] !== null) config[key] = raw[key]
    }
  }
  const home = os.homedir()
  if (!Array.isArray(config.gameRoots) || config.gameRoots.length === 0) {
    config.gameRoots = IS_WINDOWS
      ? [path.join('C:', path.sep, 'dev', 'dsh-workspace'), path.join(home, 'Deliverables')]
      : [path.join(home, 'Games')]
  }
  config.gameRoots = config.gameRoots
    .filter((root) => typeof root === 'string' && path.isAbsolute(root))
    .map((root) => path.normalize(root))
    .slice(0, 8)
  config.avdName = typeof config.avdName === 'string' && config.avdName.trim() !== '' ? config.avdName.trim() : 'gamelab'
  config.ramMb = clamp(Math.round(Number(config.ramMb) || 2048), 1024, 6144)
  config.cores = clamp(Math.round(Number(config.cores) || 2), 1, 8)
  config.maxFps = clamp(Math.round(Number(config.maxFps) || 8), 2, 20)
  config.idleMinutes = clamp(Math.round(Number(config.idleMinutes) || 5), 1, 120)
  config.bootTimeoutMs = clamp(Math.round(Number(config.bootTimeoutMs) || 240000), 60000, 600000)
  config.gpuMode = ['host', 'swiftshader_indirect', 'auto'].includes(config.gpuMode) ? config.gpuMode : 'host'
  config.sdkDir = typeof config.sdkDir === 'string' && config.sdkDir.trim() !== '' ? config.sdkDir.trim() : null
  return config
}

/** Promisified execFile with a hard timeout and merged diagnostics. */
function execFileP(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        timeout: options.timeoutMs ?? 30000,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        encoding: 'utf8',
        cwd: options.cwd,
        env: options.env,
      },
      (error, stdout, stderr) => {
        const out = typeof stdout === 'string' ? stdout : ''
        const err = typeof stderr === 'string' ? stderr : ''
        if (error) {
          const detail = (err !== '' ? err : out !== '' ? out : errorMessage(error)).trim().slice(0, 800)
          const failure = new Error(`${path.basename(binary)} ${args.join(' ')} failed: ${detail}`)
          failure.stdout = out
          failure.stderr = err
          failure.code = typeof error.code === 'number' ? error.code : null
          reject(failure)
          return
        }
        resolve({ stdout: out, stderr: err, code: 0 })
      },
    )
  })
}

/** The interactive half of Game Lab: one emulator plus its library and build jobs. */
export class GameLab {
  constructor(ctx, rawConfig) {
    this.ctx = ctx
    this.config = normalizeConfig(rawConfig)
    this.toolchain = resolveToolchain(this.config)
    this.frameIntervalMs = clamp(Math.round(1000 / this.config.maxFps), 60, 500)
    this.createdAt = Date.now()
    this.disposed = false

    this.emulator = {
      status: 'off',
      avd: null,
      serial: null,
      owned: false,
      bootStartedAt: null,
      bootedAt: null,
      bootElapsedMs: null,
      progress: 0,
      error: null,
      resolution: null,
    }
    this.build = {
      state: 'idle',
      project: null,
      log: [],
      startedAt: null,
      finishedAt: null,
      ok: null,
      apkPath: null,
    }

    this.frameLoop = null
    this.latestFrame = null
    this.streamWriters = new Set()
    this.consumers = 0
    this.frameDemandUntil = 0
    this.lastActivityAt = 0
    this.bootGeneration = 0
    this.emulatorPid = null
    this.buildChild = null
    this.timers = []
    this.avdCache = { at: 0, list: [] }
    this.resources = { at: 0, ramMb: null, cpuPercent: null, sampledAt: null }
    this.gamesCache = { at: 0, value: null }
    this.installedInfo = new Map()
    this.notes = []
    this.pollingLeftover = false
  }

  /** Start the periodic timers. Called once from the plugin's apply(). */
  begin() {
    this.timers.push(setInterval(() => this.#tickIdle(), 10000))
    this.timers.push(setInterval(() => { this.#tickResources().catch(() => {}) }, 12000))
    this.timers.push(setInterval(() => { this.#tickFrames() }, 10000))
    this.timers.push(setInterval(() => { this.#tickLeftoverEmulator().catch(() => {}) }, 20000))
    for (const timer of this.timers) timer.unref?.()
    this.#tickResources().catch(() => {})
    this.#note(this.toolchain.ok
      ? `ready: sdk=${this.toolchain.sdkDir ?? 'PATH'} aapt2=${this.toolchain.aapt2 ?? 'missing'} avd=${this.config.avdName}`
      : `not ready: ${this.toolchain.reason ?? 'unknown toolchain error'}`)
  }

  /** Snapshot the client page polls. */
  status() {
    const emulator = this.emulator
    return {
      ok: true,
      plugin: PLUGIN,
      hostBuild: HOST_BUILD,
      serverTime: Date.now(),
      emulator: {
        state: emulator.status,
        avd: emulator.avd,
        serial: emulator.serial,
        owned: emulator.owned,
        bootedAt: emulator.bootedAt,
        bootElapsedMs: emulator.bootElapsedMs,
        progress: Math.round(emulator.progress * 100) / 100,
        error: emulator.error,
        resolution: this.#resolution(),
        fps: this.frameLoop !== null && this.frameLoop.running ? this.frameLoop.fps : null,
        ramMb: this.resources.ramMb,
        cpuPercent: this.resources.cpuPercent,
        idleStopAt: this.#idleStopAt(),
        lastActivityAt: this.lastActivityAt > 0 ? this.lastActivityAt : null,
      },
      build: {
        state: this.build.state,
        project: this.build.project,
        logTail: this.build.log.length > 0 ? this.build.log.slice(-25).join('\n') : null,
        startedAt: this.build.startedAt,
        finishedAt: this.build.finishedAt,
        ok: this.build.ok,
      },
      config: {
        avdName: this.config.avdName,
        idleMinutes: this.config.idleMinutes,
        maxFps: this.config.maxFps,
        ramMb: this.config.ramMb,
        cores: this.config.cores,
        gpuMode: this.config.gpuMode,
        gameRoots: this.config.gameRoots,
      },
      toolchain: {
        ok: this.toolchain.ok,
        reason: this.toolchain.reason ?? null,
        avdmanager: this.toolchain.avdmanager !== null,
        aapt2: this.toolchain.aapt2 !== null,
      },
      notes: this.notes.slice(-8),
    }
  }

  /** Scan the configured roots for APKs and Gradle game projects. */
  async listGames(force = false) {
    const now = Date.now()
    if (!force && this.gamesCache.value !== null && now - this.gamesCache.at < 15000) return this.gamesCache.value
    const value = await scanLibrary({
      roots: this.config.gameRoots,
      aapt2Path: this.toolchain.aapt2,
      maxGames: 300,
      maxProjects: 40,
      now,
    })
    for (const game of value.games) {
      const known = this.installedInfo.get(game.path)
      if (known !== undefined) {
        game.packageName = game.packageName ?? known.packageName
        game.label = game.label ?? known.label
        game.versionName = game.versionName ?? known.versionName
      }
    }
    value.toolchain = { aapt2: this.toolchain.aapt2, ok: this.toolchain.ok }
    this.gamesCache = { at: now, value }
    return value
  }

  /** True when the emulator can accept input right now. */
  get online() {
    return this.emulator.status === 'online' && typeof this.emulator.serial === 'string'
  }

  /** Mark user/UI activity so the idle timer does not fire. */
  touch(reason = 'activity') {
    this.lastActivityAt = Date.now()
    this.#note(reason)
  }

  /** Keep the frame loop alive for a while (streaming readers). */
  demandFrames(ms = 30000) {
    this.frameDemandUntil = Math.max(this.frameDemandUntil, Date.now() + ms)
  }

  /** Boot the configured AVD headless, or adopt an already-running emulator. */
  async startEmulator(options = {}) {
    if (this.disposed) throw new Error('Game Lab is shutting down')
    if (this.emulator.status === 'online' || this.emulator.status === 'booting') return this.status()
    if (!this.toolchain.ok) {
      this.emulator.status = 'error'
      this.emulator.error = this.toolchain.reason ?? 'Android SDK not found'
      return this.status()
    }
    const generation = ++this.bootGeneration
    const requestedAvd = typeof options.avd === 'string' && options.avd.trim() !== '' ? options.avd.trim() : this.config.avdName

    this.touch('start requested')
    this.emulatorPid = null
    this.emulator = {
      status: 'booting',
      avd: requestedAvd,
      serial: null,
      owned: true,
      bootStartedAt: Date.now(),
      bootedAt: null,
      bootElapsedMs: null,
      progress: 0.02,
      error: null,
      resolution: null,
    }

    try {
      const before = new Set((await this.#devices()).map((device) => device.serial))
      const alreadyOnline = (await this.#devices()).find(
        (device) => device.state === 'device' && device.serial.startsWith('emulator-'),
      )
      if (alreadyOnline !== undefined) {
        await this.#adopt(alreadyOnline.serial, requestedAvd, generation)
        return this.status()
      }

      await this.#ensureAvd(requestedAvd)
      if (generation !== this.bootGeneration) return this.status()

      const args = [
        '-avd', requestedAvd,
        '-no-window',
        '-no-audio',
        '-no-boot-anim',
        '-no-snapshot',
        '-gpu', this.config.gpuMode,
        '-memory', String(this.config.ramMb),
        '-cores', String(this.config.cores),
        '-no-metrics',
      ]
      const child = spawn(this.toolchain.emulator, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        cwd: this.toolchain.sdkDir ?? undefined,
      })
      let spawnFailure = null
      child.once('error', (error) => {
        spawnFailure = error
      })
      child.unref()
      this.emulatorPid = typeof child.pid === 'number' ? child.pid : null
      this.#note(`emulator launch pid=${String(this.emulatorPid)} avd=${requestedAvd}`)

      const deadline = Date.now() + this.config.bootTimeoutMs
      let serial = null
      while (Date.now() < deadline) {
        if (generation !== this.bootGeneration) return this.status()
        if (spawnFailure !== null) throw new Error(`emulator launcher failed: ${errorMessage(spawnFailure)}`)
        const devices = await this.#devices().catch(() => [])
        serial = devices.find(
          (device) => device.state === 'device' && device.serial.startsWith('emulator-') && !before.has(device.serial),
        )?.serial ?? null
        if (serial !== null) break
        this.emulator.progress = Math.min(0.6, this.emulator.progress + 0.02)
        await sleep(1000)
      }
      if (serial === null) throw new Error(`the emulator did not appear within ${Math.round(this.config.bootTimeoutMs / 1000)} s`)
      this.emulator.serial = serial

      while (Date.now() < deadline) {
        if (generation !== this.bootGeneration) return this.status()
        const completed = await this.#shell(serial, ['getprop', 'sys.boot_completed'], 6000).catch(() => null)
        if (completed !== null && completed.stdout.trim() === '1') break
        this.emulator.progress = Math.min(0.95, this.emulator.progress + 0.015)
        await sleep(1500)
      }
      const bootCompleted = await this.#shell(serial, ['getprop', 'sys.boot_completed'], 6000).catch(() => null)
      if (bootCompleted === null || bootCompleted.stdout.trim() !== '1') {
        throw new Error('the emulator appeared but Android did not finish booting in time')
      }

      if (generation !== this.bootGeneration) return this.status()
      await this.#markOnline(serial, requestedAvd, true, this.emulator.bootStartedAt)
      return this.status()
    } catch (error) {
      if (typeof this.emulatorPid === 'number') {
        await this.#killSpawnedEmulator().catch(() => {})
        this.emulatorPid = null
      }
      if (generation === this.bootGeneration && this.emulator.status !== 'off') {
        this.emulator.status = 'error'
        this.emulator.error = errorMessage(error)
        this.emulator.progress = 0
        this.#note(`boot failed: ${errorMessage(error)}`)
      }
      return this.status()
    }
  }

  /** Stop the emulator, freeing its RAM and CPU. */
  async stopEmulator(options = {}) {
    if (this.emulator.status === 'off' || this.emulator.status === 'stopping') return this.status()
    const reason = typeof options.reason === 'string' ? options.reason : 'user'
    this.bootGeneration += 1
    const serial = this.emulator.serial
    this.emulator.status = 'stopping'
    this.emulator.progress = 0
    this.#stopFrameLoop()
    for (const writer of this.streamWriters) writer.close()
    this.streamWriters.clear()
    this.consumers = 0

    if (serial !== null) {
      await this.#exec(['-s', serial, 'emu', 'kill'], 8000).catch(() => null)
      const deadline = Date.now() + 10000
      let stillThere = true
      while (Date.now() < deadline) {
        const devices = await this.#devices().catch(() => [])
        stillThere = devices.some((device) => device.serial === serial)
        if (!stillThere) break
        await sleep(500)
      }
      if (stillThere) await this.#killSpawnedEmulator()
    } else if (typeof this.emulatorPid === 'number') {
      await this.#killSpawnedEmulator()
    }
    this.emulator = {
      status: 'off',
      avd: null,
      serial: null,
      owned: false,
      bootStartedAt: null,
      bootedAt: null,
      bootElapsedMs: null,
      progress: 0,
      error: null,
      resolution: null,
    }
    this.emulatorPid = null
    this.resources = { at: 0, ramMb: null, cpuPercent: null, sampledAt: null }
    this.#note(`stopped (${reason})`)
    return this.status()
  }

  /** Install one APK and launch it. */
  async installAndLaunch(apkPath) {
    if (!this.online) throw new Error('the emulator is not running - start Game Lab first')
    if (typeof apkPath !== 'string' || apkPath.trim() === '') throw new Error('an APK path is required')
    const absolute = path.resolve(apkPath)
    let info = null
    try {
      info = await stat(absolute)
    } catch {
      throw new Error(`APK not found: ${absolute}`)
    }
    if (!info.isFile() || !/\.apk$/i.test(absolute)) throw new Error('that path is not an APK file')

    const serial = this.emulator.serial
    const before = await this.#installedPackages(serial)
    const result = await this.#exec(['-s', serial, 'install', '-r', '-g', absolute], 180000, true)
    const output = `${result.stdout}\n${result.stderr}`
    if (!/Success/i.test(output)) {
      throw new Error(`adb install failed: ${output.trim().split('\n').slice(-3).join(' ').slice(0, 500)}`)
    }

    let details = null
    if (typeof this.toolchain.aapt2 === 'string') {
      details = await apkInfo(this.toolchain.aapt2, absolute).catch(() => null)
    }
    let packageName = details?.packageName ?? null
    if (packageName === null) {
      const after = await this.#installedPackages(serial)
      const added = [...after].filter((entry) => !before.has(entry))
      packageName = added.length === 1 ? added[0] : null
    }
    if (packageName === null) throw new Error('the APK installed but its package name could not be determined')

    const launchableActivity = details?.launchableActivity ?? null
    await this.#launchPackage(packageName, launchableActivity).catch((error) => {
      throw new Error(`installed ${packageName} but launching it failed: ${errorMessage(error)}`)
    })
    this.installedInfo.set(absolute, {
      packageName,
      label: details?.label ?? null,
      versionName: details?.versionName ?? null,
    })
    this.touch(`installed ${packageName}`)
    return {
      ok: true,
      packageName,
      label: details?.label ?? null,
      versionName: details?.versionName ?? null,
      launched: true,
    }
  }

  /** Launch an already installed package. */
  async launchPackage(packageName) {
    if (!this.online) throw new Error('the emulator is not running - start Game Lab first')
    if (typeof packageName !== 'string' || packageName.trim() === '') throw new Error('a package name is required')
    await this.#launchPackage(packageName.trim(), null)
    this.touch(`launched ${packageName}`)
    return { ok: true, packageName }
  }

  /** Build a Gradle game project, then install and launch its newest debug APK. */
  async buildProject(projectPath) {
    if (this.build.state === 'running') throw new Error('a build is already running')
    if (typeof projectPath !== 'string' || projectPath.trim() === '') throw new Error('a project path is required')
    const project = path.resolve(projectPath)
    const gradlew = IS_WINDOWS ? path.join(project, 'gradlew.bat') : path.join(project, 'gradlew')
    if (!existsSync(gradlew)) throw new Error(`no Gradle wrapper found in ${project}`)
    if (!existsSync(path.join(project, 'settings.gradle')) && !existsSync(path.join(project, 'settings.gradle.kts'))) {
      throw new Error(`${project} does not look like a Gradle project (no settings.gradle)`)
    }

    const startedAt = Date.now()
    this.build = {
      state: 'running',
      project,
      log: [`$ ${IS_WINDOWS ? 'gradlew.bat' : './gradlew'} assembleDebug`, `cwd: ${project}`],
      startedAt,
      finishedAt: null,
      ok: null,
      apkPath: null,
    }
    this.touch(`build started ${project}`)
    if (!this.online) {
      // One click "build & play": bring the emulator up while Gradle runs.
      this.#note('build: booting the emulator for the install step')
      Promise.resolve().then(() => this.startEmulator({})).catch(() => {})
    }
    const env = { ...process.env }
    if (typeof this.toolchain.sdkDir === 'string') env.ANDROID_HOME = this.toolchain.sdkDir
    const command = IS_WINDOWS ? 'gradlew.bat' : './gradlew'
    const child = IS_WINDOWS
      ? spawn('cmd.exe', ['/d', '/s', '/c', `${command} assembleDebug --console=plain`], {
        cwd: project, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      })
      : spawn('sh', ['-c', `${command} assembleDebug --console=plain`], {
        cwd: project, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      })
    this.buildChild = child
    const append = (chunk) => {
      const text = chunk.toString('utf8')
      for (const line of text.split(/\r?\n/)) {
        if (line.trim() === '') continue
        this.build.log.push(line.length > 500 ? `${line.slice(0, 500)}...` : line)
      }
      if (this.build.log.length > 400) this.build.log.splice(0, this.build.log.length - 400)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timeout = setTimeout(() => {
      append(Buffer.from('\n[game-lab] build timed out after 10 minutes; stopping it'))
      this.#killBuildTree()
    }, 10 * 60 * 1000)
    timeout.unref?.()

    child.once('close', (code) => {
      clearTimeout(timeout)
      this.buildChild = null
      this.build.finishedAt = Date.now()
      if (code === 0) {
        this.#finishBuild(project, startedAt).catch((error) => {
          this.build.state = 'error'
          this.build.ok = false
          this.build.log.push(`[game-lab] ${errorMessage(error)}`)
          this.#note(`build install failed: ${errorMessage(error)}`)
        })
      } else {
        this.build.state = 'error'
        this.build.ok = false
        this.build.log.push(`[game-lab] gradle exited with code ${String(code)}`)
        this.#note(`build failed (exit ${String(code)})`)
      }
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      this.buildChild = null
      this.build.state = 'error'
      this.build.ok = false
      this.build.finishedAt = Date.now()
      this.build.log.push(`[game-lab] ${errorMessage(error)}`)
    })
    return { ok: true, state: 'running' }
  }

  /** Send one touch/key/rotation event. Coordinates are normalized 0..1. */
  async input(action) {
    if (!this.online) throw new Error('the emulator is not running - start Game Lab first')
    if (!isRecord(action) || typeof action.kind !== 'string') throw new Error('input requires a kind')
    const serial = this.emulator.serial
    const kind = action.kind
    const dimensions = this.#resolution() ?? { width: 720, height: 1280 }

    switch (kind) {
      case 'tap': {
        const point = this.#point(action.x, action.y, dimensions)
        await this.#shell(serial, ['input', 'tap', String(point.x), String(point.y)], 15000)
        break
      }
      case 'swipe': {
        const from = this.#point(action.fromX, action.fromY, dimensions)
        const to = this.#point(action.toX, action.toY, dimensions)
        const duration = clamp(Math.round(Number(action.durationMs) || 260), 50, 5000)
        await this.#shell(serial, ['input', 'swipe', String(from.x), String(from.y), String(to.x), String(to.y), String(duration)], 20000)
        break
      }
      case 'key': {
        const keyCode = KEY_CODES[String(action.name)]
        if (keyCode === undefined) throw new Error(`unknown key ${JSON.stringify(action.name)}`)
        await this.#shell(serial, ['input', 'keyevent', keyCode], 15000)
        break
      }
      case 'text': {
        const text = typeof action.text === 'string' ? action.text : ''
        if (text === '') throw new Error('text input requires text')
        if (!/^[A-Za-z0-9 .,!?@_+=:/%-]+$/.test(text)) {
          throw new Error('only ASCII text is supported without ADBKeyboard installed on the device')
        }
        await this.#shell(serial, ['input', 'text', text.replace(/ /g, '%s')], 15000)
        break
      }
      case 'rotate': {
        const orientation = action.orientation === 'landscape' ? 1 : 0
        await this.#shell(serial, ['settings', 'put', 'system', 'accelerometer_rotation', '0'], 10000)
        await this.#shell(serial, ['settings', 'put', 'system', 'user_rotation', String(orientation)], 10000)
        this.demandFrames(30000)
        break
      }
      default:
        throw new Error(`unknown input kind ${JSON.stringify(kind)}`)
    }
    this.touch(`input ${kind}`)
    return { ok: true, kind }
  }

  /** Tail the device log, optionally restricted to one app's process. */
  async readLogs(query = {}) {
    if (!this.online) throw new Error('the emulator is not running - start Game Lab first')
    const serial = this.emulator.serial
    const lineCount = clamp(Math.round(Number(query.lines) || 200), 10, 500)
    const packageName = typeof query.packageName === 'string' ? query.packageName.trim() : ''
    let pid = null
    if (packageName !== '') {
      const resolved = await this.#shell(serial, ['pidof', packageName], 8000).catch(() => null)
      const text = resolved === null ? '' : resolved.stdout.trim()
      pid = /^\d+/.test(text) ? text.split(/\s+/)[0] : null
    }
    const args = ['-s', serial, 'logcat', '-d', '-v', 'time', '-t', String(lineCount)]
    if (pid !== null) args.push(`--pid=${pid}`)
    const result = await this.#exec(args, 20000, true)
    let lines = result.stdout.split('\n').filter((line) => line.trim() !== '')
    if (pid === null && packageName !== '') lines = lines.filter((line) => line.includes(packageName))
    return { ok: true, lines: lines.slice(-lineCount), packageName: packageName === '' ? null : packageName }
  }

  /** Serve the live multipart frame stream on one HTTP response. */
  openStream(res) {
    const writer = new MultipartWriter(res)
    this.streamWriters.add(writer)
    this.consumers += 1
    this.demandFrames(120000)
    this.#ensureFrameLoop()
    if (this.latestFrame !== null) writer.writeFrame(this.latestFrame)
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.streamWriters.delete(writer)
      writer.close()
      this.consumers = Math.max(0, this.consumers - 1)
      this.demandFrames(60000)
      res.off('close', release)
    }
    res.on('close', release)
    return release
  }

  /** One PNG of the newest frame, waiting briefly for the loop to warm up. */
  async framePng() {
    if (!this.online) return undefined
    this.demandFrames(60000)
    const loop = this.#ensureFrameLoop()
    if (this.latestFrame !== null) return this.latestFrame.png
    if (loop === null) return undefined
    const frame = await loop.waitForFrame(3000)
    return frame === undefined ? undefined : frame.png
  }

  /** Tear everything down (plugin unload / app quit). */
  async dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
    this.#killBuildTree()
    for (const writer of this.streamWriters) writer.close()
    this.streamWriters.clear()
    if (this.emulator.status !== 'off') await this.stopEmulator({ reason: 'shutdown' }).catch(() => {})
    this.#stopFrameLoop()
    this.#note('disposed')
  }

  /* ------------------------------------------------------------------ */
  /* internals                                                           */
  /* ------------------------------------------------------------------ */

  #note(message) {
    const line = `${new Date().toISOString().slice(11, 19)} ${message}`
    this.notes.push(line)
    if (this.notes.length > 40) this.notes.shift()
  }

  #resolution() {
    if (this.latestFrame !== null) return { width: this.latestFrame.width, height: this.latestFrame.height }
    return this.emulator.resolution
  }

  #idleStopAt() {
    if (this.emulator.status !== 'online' || this.lastActivityAt === 0) return null
    return this.lastActivityAt + this.config.idleMinutes * 60000
  }

  #point(x, y, dimensions) {
    const nx = Number(x)
    const ny = Number(y)
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new Error('input coordinates must be numbers')
    const width = dimensions.width
    const height = dimensions.height
    return {
      x: Math.round(clamp(nx, 0, 1) * Math.max(1, width - 1)),
      y: Math.round(clamp(ny, 0, 1) * Math.max(1, height - 1)),
    }
  }

  async #exec(args, timeoutMs = 30000, allowFailure = false) {
    if (typeof this.toolchain.adb !== 'string') throw new Error(this.toolchain.reason ?? 'adb not found')
    try {
      return await execFileP(this.toolchain.adb, args, { timeoutMs })
    } catch (error) {
      if (allowFailure) return { stdout: error.stdout ?? '', stderr: error.stderr ?? errorMessage(error), code: error.code ?? 1 }
      throw error
    }
  }

  async #shell(serial, args, timeoutMs = 20000) {
    if (typeof this.toolchain.adb !== 'string') throw new Error(this.toolchain.reason ?? 'adb not found')
    return execFileP(this.toolchain.adb, ['-s', serial, 'shell', ...args], { timeoutMs })
  }

  async #execBinary(binary, args, timeoutMs = 30000) {
    if (typeof binary !== 'string') throw new Error('binary not found')
    return execFileP(binary, args, { timeoutMs })
  }

  async #devices() {
    if (typeof this.toolchain.adb !== 'string') return []
    const { stdout } = await this.#exec(['devices', '-l'], 15000)
    const devices = []
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('List of devices') || trimmed.startsWith('*')) continue
      const parts = trimmed.split(/\s+/)
      if (parts.length < 2) continue
      const serial = parts[0]
      const state = parts[1]
      const details = {}
      for (const part of parts.slice(2)) {
        const index = part.indexOf(':')
        if (index > 0) details[part.slice(0, index)] = part.slice(index + 1)
      }
      devices.push({ serial, state, model: details.model ?? null, product: details.product ?? null, avd: details.avd ?? null })
    }
    return devices
  }

  async #listAvds() {
    if (Date.now() - this.avdCache.at < 60000 && this.avdCache.list.length > 0) return this.avdCache.list
    if (typeof this.toolchain.emulator !== 'string') return []
    try {
      const { stdout } = await this.#execBinary(this.toolchain.emulator, ['-list-avds'], 20000)
      const list = stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '').slice(0, 40)
      this.avdCache = { at: Date.now(), list }
      return list
    } catch {
      return this.avdCache.list
    }
  }

  async #ensureAvd(avdName) {
    const existing = await this.#listAvds()
    if (existing.includes(avdName)) return
    const avdmanager = this.toolchain.avdmanager
    if (typeof avdmanager !== 'string') {
      throw new Error(`AVD "${avdName}" does not exist and avdmanager was not found; create it in Android Studio or with the SDK cmdline-tools`)
    }
    const imageId = await this.#pickSystemImage()
    if (imageId === null) throw new Error(`AVD "${avdName}" does not exist and no x86_64 Android system image is installed to create it from`)
    this.#note(`creating AVD ${avdName} from ${imageId}`)
    await this.#runAvdManager(avdmanager, ['create', 'avd', '-n', avdName, '-k', imageId, '-d', 'pixel_5', '--force'])
    const configPath = path.join(os.homedir(), '.android', 'avd', `${avdName}.avd`, 'config.ini')
    if (!existsSync(configPath)) throw new Error(`avdmanager finished but ${configPath} is missing`)
    const current = await readFile(configPath, 'utf8').catch(() => '')
    const values = {
      'hw.lcd.width': '720',
      'hw.lcd.height': '1280',
      'hw.lcd.density': '320',
      'hw.ramSize': String(this.config.ramMb),
      'hw.cpu.ncore': String(this.config.cores),
      'hw.gpu.enabled': 'yes',
      'hw.gpu.mode': this.config.gpuMode === 'auto' ? 'auto' : this.config.gpuMode,
      'hw.keyboard': 'yes',
      'showDeviceFrame': 'no',
      'disk.dataPartition.size': '2G',
      'fastboot.forceColdBoot': 'yes',
      'fastboot.forceFastBoot': 'no',
    }
    let next = current
    for (const [key, value] of Object.entries(values)) {
      // AVD config.ini is written as "key = value" by avdmanager; tolerate both.
      const pattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*.*$`, 'm')
      if (pattern.test(next)) next = next.replace(pattern, `${key} = ${value}`)
      else next = `${next.trimEnd()}\n${key} = ${value}\n`
    }
    await writeFile(configPath, next, 'utf8')
    this.avdCache = { at: 0, list: [] }
  }

  async #pickSystemImage() {
    const sdkDir = this.toolchain.sdkDir
    if (typeof sdkDir !== 'string') return null
    const root = path.join(sdkDir, 'system-images')
    const preferred = []
    try {
      for (const api of await readdir(root)) {
        for (const vendor of await readdir(path.join(root, api))) {
          for (const abi of await readdir(path.join(root, api, vendor))) {
            const candidate = path.join(root, api, vendor, abi)
            if (!existsSync(candidate)) continue
            const imageId = `system-images;${api};${vendor};${abi}`
            preferred.push({ imageId, score: /x86_64/i.test(abi) ? 2 : /arm64/i.test(abi) ? 1 : 0, api })
          }
        }
      }
    } catch {
      return null
    }
    const apiNumber = (api) => {
      const match = /android-(\d+)/.exec(api)
      return match === null ? 0 : Number(match[1])
    }
    preferred.sort((a, b) => b.score - a.score || apiNumber(b.api) - apiNumber(a.api))
    return preferred.length > 0 ? preferred[0].imageId : null
  }

  #runAvdManager(avdmanager, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(avdmanager, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      let output = ''
      child.stdout?.on('data', (chunk) => { output += chunk.toString('utf8') })
      child.stderr?.on('data', (chunk) => { output += chunk.toString('utf8') })
      child.once('error', (error) => reject(new Error(`avdmanager failed to start: ${errorMessage(error)}`)))
      child.once('close', (code) => {
        if (code === 0) resolve(output)
        else reject(new Error(`avdmanager exited with code ${String(code)}: ${output.trim().slice(0, 600)}`))
      })
      // avdmanager may ask whether to create a custom hardware profile.
      try {
        child.stdin?.write('no\n')
        child.stdin?.end()
      } catch {
        // stdin may already be gone.
      }
    })
  }

  async #adopt(serial, avdName, generation) {
    this.emulator.serial = serial
    this.emulator.progress = 0.98
    const avd = await this.#shell(serial, ['getprop', 'ro.boot.qemu.avd_name'], 8000).catch(() => null)
    const resolvedAvd = avd !== null && avd.stdout.trim() !== '' ? avd.stdout.trim() : avdName
    if (generation !== this.bootGeneration) return
    this.emulator.owned = false
    await this.#markOnline(serial, resolvedAvd, false, Date.now())
  }

  async #markOnline(serial, avdName, owned, bootStartedAt) {
    this.emulator.status = 'online'
    this.emulator.serial = serial
    this.emulator.avd = avdName
    this.emulator.owned = owned
    this.emulator.bootedAt = Date.now()
    this.emulator.bootElapsedMs = bootStartedAt === null ? null : Date.now() - bootStartedAt
    this.emulator.progress = 1
    this.emulator.error = null
    const size = await this.#shell(serial, ['wm', 'size'], 8000).catch(() => null)
    if (size !== null) {
      const match = /(\d+)x(\d+)/.exec(size.stdout)
      if (match !== null) this.emulator.resolution = { width: Number(match[1]), height: Number(match[2]) }
    }
    this.touch('online')
    this.#ensureFrameLoop()
    this.#tickResources().catch(() => {})
    this.#note(`online ${serial} (${avdName}) boot=${this.emulator.bootElapsedMs === null ? '?' : Math.round(this.emulator.bootElapsedMs / 1000) + 's'}`)
  }

  async #launchPackage(packageName, launchableActivity) {
    const serial = this.emulator.serial
    let component = normalizeComponent(packageName, launchableActivity)
    if (component === null) {
      const resolved = await this.#shell(serial, [
        'cmd', 'package', 'resolve-activity', '--brief', '-c', 'android.intent.category.LAUNCHER', packageName,
      ], 20000).catch(() => null)
      if (resolved !== null) {
        const lines = resolved.stdout.split('\n').map((line) => line.trim()).filter((line) => line.includes('/'))
        component = lines.length > 0 ? lines[lines.length - 1] : null
      }
    }
    let launched = false
    if (component !== null) {
      const result = await this.#shell(serial, ['am', 'start', '-W', '-n', component], 30000).catch(() => null)
      const output = result === null ? '' : `${result.stdout}\n${result.stderr}`
      launched = result !== null && !/^Error/im.test(output) && !/does not exist|not found/i.test(output)
      if (!launched) this.#note(`am start failed for ${component}: ${output.trim().slice(0, 200)}`)
    }
    if (!launched) {
      // Fall back to the category launch used by launchers; some manifests only
      // declare the MAIN/LAUNCHER intent and no directly startable component.
      const fallback = await this.#shell(serial, [
        'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1',
      ], 30000).catch(() => null)
      const output = fallback === null ? '' : `${fallback.stdout}\n${fallback.stderr}`
      launched = fallback !== null && !/No activities found|aborted|Error/im.test(output)
      if (!launched) throw new Error(`could not launch ${packageName}: ${output.trim().slice(0, 300)}`)
    }
    this.demandFrames(60000)
  }

  async #installedPackages(serial) {
    const result = await this.#shell(serial, ['pm', 'list', 'packages', '-3'], 20000).catch(() => null)
    const packages = new Set()
    if (result === null) return packages
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('package:')) packages.add(trimmed.slice('package:'.length))
    }
    return packages
  }

  #ensureFrameLoop() {
    if (this.disposed || !this.online) return null
    const serial = this.emulator.serial
    if (this.frameLoop !== null && this.frameLoop.running && this.frameLoop.serial === serial) {
      this.demandFrames(30000)
      return this.frameLoop
    }
    this.#stopFrameLoop()
    const loop = new FrameLoop({
      adb: this.toolchain.adb,
      serial,
      intervalMs: this.frameIntervalMs,
    })
    loop.addListener((frame) => this.#onFrame(frame))
    loop.start()
    this.frameLoop = loop
    this.demandFrames(30000)
    return loop
  }

  #onFrame(frame) {
    if (this.disposed) return
    this.latestFrame = frame
    this.emulator.resolution = { width: frame.width, height: frame.height }
    for (const writer of this.streamWriters) writer.writeFrame(frame)
  }

  #stopFrameLoop() {
    if (this.frameLoop !== null) {
      this.frameLoop.stop()
      this.frameLoop = null
      // Killing the host-side adb child can leave the device-side screencap
      // shell running; clean it up so a stopped view costs nothing.
      const serial = this.emulator.serial
      if (typeof serial === 'string' && serial !== '') {
        this.#shell(serial, ['pkill', '-f', 'screencap'], 8000).catch(() => {})
      }
    }
    this.latestFrame = null
  }

  #tickIdle() {
    if (this.disposed || this.emulator.status !== 'online') return
    // A Gradle build can outlast the idle window; never kill the emulator out
    // from under an install that is about to happen.
    if (this.build.state === 'running') return
    if (this.lastActivityAt === 0) return
    if (Date.now() - this.lastActivityAt < this.config.idleMinutes * 60000) return
    this.#note('idle timeout')
    this.stopEmulator({ reason: 'idle' }).catch(() => {})
  }

  #tickFrames() {
    if (this.disposed || !this.online) {
      if (this.frameLoop !== null) this.#stopFrameLoop()
      return
    }
    if (this.frameLoop !== null && !this.frameLoop.running) {
      this.frameLoop.reset()
      this.frameLoop.start()
    }
    if (this.frameLoop === null) return
    if (this.consumers > 0) return
    if (Date.now() < this.frameDemandUntil) return
    this.frameLoop.stop()
    this.frameLoop = null
    this.latestFrame = null
  }

  async #tickLeftoverEmulator() {
    if (this.disposed || this.pollingLeftover) return
    if (!this.toolchain.ok || this.emulator.status !== 'off') return
    this.pollingLeftover = true
    try {
      const devices = await this.#devices().catch(() => [])
      const runaway = devices.find((device) => device.state === 'device' && device.serial.startsWith('emulator-'))
      if (runaway === undefined) return
      const avd = await this.#shell(runaway.serial, ['getprop', 'ro.boot.qemu.avd_name'], 6000).catch(() => null)
      const avdName = avd === null ? '' : avd.stdout.trim()
      if (avdName !== this.config.avdName) return
      this.emulator = {
        status: 'booting',
        avd: avdName,
        serial: runaway.serial,
        owned: false,
        bootStartedAt: null,
        bootedAt: null,
        bootElapsedMs: null,
        progress: 0.98,
        error: null,
        resolution: null,
      }
      await this.#markOnline(runaway.serial, avdName, false, null)
    } finally {
      this.pollingLeftover = false
    }
  }

  async #tickResources() {
    if (this.disposed || this.emulator.status !== 'online') return
    if (Date.now() - this.resources.at < 8000) return
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "$rows = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -match '^(qemu-system|emulator)' } | Select-Object Name, IDProcess, PercentProcessorTime, WorkingSet",
      "@($rows) | ConvertTo-Json -Compress",
    ].join('; ')
    const result = await this.#execBinary(
      IS_WINDOWS ? 'powershell.exe' : 'sh',
      IS_WINDOWS ? ['-NoProfile', '-NonInteractive', '-Command', script] : ['-c', 'ps -eo rss,pcpu,comm | grep -E "qemu|emulator"'],
      12000,
    ).catch(() => null)
    if (result === null) return
    let rows = []
    try {
      const parsed = JSON.parse(result.stdout.trim() === '' ? '[]' : result.stdout)
      rows = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return
    }
    let ramKb = 0
    let cpu = 0
    for (const row of rows) {
      if (!isRecord(row)) continue
      const workingSet = Number(row.WorkingSet)
      const processor = Number(row.PercentProcessorTime)
      if (Number.isFinite(workingSet)) ramKb += workingSet / 1024
      if (Number.isFinite(processor)) cpu += processor
    }
    this.resources = {
      at: Date.now(),
      ramMb: rows.length === 0 ? null : Math.round(ramKb / 1024),
      cpuPercent: rows.length === 0 ? null : Math.round(cpu),
      sampledAt: Date.now(),
    }
  }

  async #finishBuild(project, startedAt) {
    let apkPath = await findNewestApk(project, startedAt - 5000)
    if (apkPath === null) {
      // A fully up-to-date Gradle run writes no APK at all; reuse the newest
      // existing build output instead of reporting a failed build.
      apkPath = await findNewestApk(project, 0)
      if (apkPath !== null) this.build.log.push(`[game-lab] no new APK (build was up to date); using ${apkPath}`)
    }
    if (apkPath === null) throw new Error('the build succeeded but no APK was found under build/outputs')
    this.build.apkPath = apkPath
    const ready = await this.#awaitOnline(150000)
    if (!ready) throw new Error('the build succeeded but the emulator did not come online to install it')
    const installed = await this.installAndLaunch(apkPath)
    this.build.state = 'done'
    this.build.ok = true
    this.build.finishedAt = Date.now()
    this.build.log.push(`[game-lab] built and installed ${installed.packageName ?? ''}`.trim())
    this.touch(`build done ${project}`)
  }

  /** Wait for the emulator to become usable, used by the build-install step. */
  async #awaitOnline(timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.online) return true
      if (this.emulator.status === 'error') return false
      await sleep(1500)
    }
    return this.online
  }

  #killBuildTree() {
    const child = this.buildChild
    this.buildChild = null
    if (child === null || typeof child.pid !== 'number') return
    try {
      if (IS_WINDOWS) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref()
      } else {
        child.kill('SIGKILL')
      }
    } catch {
      // Best effort.
    }
  }

  async #killSpawnedEmulator() {
    if (typeof this.emulatorPid !== 'number') return
    try {
      if (IS_WINDOWS) {
        spawn('taskkill', ['/PID', String(this.emulatorPid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref()
      } else {
        process.kill(-this.emulatorPid, 'SIGKILL')
      }
    } catch {
      // Best effort.
    }
    await sleep(1000)
  }
}

const KEY_CODES = {
  back: 'KEYCODE_BACK',
  home: 'KEYCODE_HOME',
  recents: 'KEYCODE_APP_SWITCH',
  power: 'KEYCODE_POWER',
  volume_up: 'KEYCODE_VOLUME_UP',
  volume_down: 'KEYCODE_VOLUME_DOWN',
  enter: 'KEYCODE_ENTER',
  delete: 'KEYCODE_DEL',
  menu: 'KEYCODE_MENU',
}

/**
 * aapt2 badging reports the launchable activity as a bare class name
 * (`com.pkg.MainActivity`); `am start -n` needs `package/class`. Accept either
 * form and produce a component string, or null when there is none.
 */
function normalizeComponent(packageName, activity) {
  if (typeof activity !== 'string' || activity.trim() === '') return null
  const name = activity.trim()
  if (name.includes('/')) return name
  if (name.startsWith('.')) return `${packageName}/${name}`
  if (name.startsWith(`${packageName}.`)) return `${packageName}/${name}`
  return `${packageName}/${name}`
}

/** Walk a project's build outputs and return the newest APK. */
async function findNewestApk(root, notBefore) {
  const found = []
  const visit = async (dir, depth) => {
    if (depth < 0) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.gradle' || entry.name === 'intermediates') continue
        await visit(full, depth - 1)
      } else if (entry.isFile() && /\.apk$/i.test(entry.name)) {
        try {
          const info = await stat(full)
          if (info.mtimeMs >= notBefore) found.push({ path: full, mtimeMs: info.mtimeMs })
        } catch {
          // Skip unreadable files.
        }
      }
    }
  }
  await visit(root, 8)
  found.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return found.length > 0 ? found[0].path : null
}
