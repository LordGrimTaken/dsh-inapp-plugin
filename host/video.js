/**
 * H.264 live-video source for Game Lab.
 *
 * `adb exec-out screenrecord --output-format=h264 ... -` encodes the emulator
 * display with the device's MediaCodec and streams the raw Annex-B bitstream
 * to stdout. That is dramatically cheaper than the default PNG `screencap`
 * loop (which is ~1 fps at 720p on this host), so the page can decode it with
 * WebCodecs and get a usable frame rate.
 *
 * This module only owns the child process, fan-out and a small statistics
 * counter (fps from VCL NALs, kbps, parameter-set presence). The controller in
 * emulator.js owns demand/restart policy; routes.js writes the bytes to the
 * browser.
 */

import { spawn } from 'node:child_process'

const STDERR_LINE_MAX = 240

/** Rolling NAL statistics over one H.264 byte stream. */
export class H264Stats {
  #bytes = 0
  #frames = 0
  #times = []
  #carry = Buffer.alloc(0)
  #startedAt = 0
  #sps = false
  #pps = false

  reset() {
    this.#bytes = 0
    this.#frames = 0
    this.#times = []
    this.#carry = Buffer.alloc(0)
    this.#startedAt = 0
    this.#sps = false
    this.#pps = false
  }

  push(chunk) {
    if (chunk.length === 0) return
    if (this.#startedAt === 0) this.#startedAt = Date.now()
    this.#bytes += chunk.length
    const merged = this.#carry.length === 0 ? chunk : Buffer.concat([this.#carry, chunk])
    // Walk Annex-B start codes; only count complete NAL headers. Keep the last
    // three bytes because a start code can split across chunks.
    for (let index = 0; index + 3 < merged.length; index += 1) {
      if (merged[index] === 0 && merged[index + 1] === 0 && merged[index + 2] === 1) {
        const type = merged[index + 3] & 0x1f
        if (type === 7) this.#sps = true
        if (type === 8) this.#pps = true
        if (type === 1 || type === 5) {
          this.#frames += 1
          this.#times.push(Date.now())
        }
        index += 2
      }
    }
    this.#carry = merged.subarray(Math.max(0, merged.length - 3))
    const cutoff = Date.now() - 3000
    while (this.#times.length > 0 && this.#times[0] < cutoff) this.#times.shift()
  }

  snapshot() {
    const elapsed = this.#startedAt === 0 ? 0 : Math.max(1, Date.now() - this.#startedAt)
    let fps = 0
    if (this.#times.length > 1) {
      const span = Math.max(1, this.#times[this.#times.length - 1] - this.#times[0])
      fps = Math.round(((this.#times.length - 1) / span) * 10000) / 10
    }
    return {
      bytes: this.#bytes,
      frames: this.#frames,
      fps,
      kbps: this.#bytes === 0 ? 0 : Math.round((this.#bytes * 8) / elapsed),
      sps: this.#sps,
      pps: this.#pps,
    }
  }
}

/** One persistent screenrecord process plus its listeners. */
export class VideoLoop {
  #child
  #listeners = new Set()
  #stderr = []
  #stderrPartial = ''
  #stopped = false
  #generation = 0
  #stats = new H264Stats()
  onExit = null

  /**
   * @param {{ adb: string, serial: string, bitRate?: number, timeLimit?: number }} options
   */
  constructor(options) {
    this.adb = options.adb
    this.serial = options.serial
    this.bitRate = options.bitRate ?? 6000000
    this.timeLimit = options.timeLimit ?? 180
  }

  get running() {
    const child = this.#child
    return child !== undefined && child.exitCode === null && child.signalCode === null
  }

  get stats() {
    return this.#stats.snapshot()
  }

  get stderrLines() {
    return [...this.#stderr]
  }

  addListener(listener) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  start() {
    if (this.running || this.#stopped) return
    const generation = this.#generation
    this.#stats.reset()
    this.#child = spawn(this.adb, [
      '-s', this.serial,
      'exec-out',
      'screenrecord',
      '--output-format=h264',
      '--bit-rate', String(this.bitRate),
      '--time-limit', String(this.timeLimit),
      '-',
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const child = this.#child
    child.stdout?.on('data', (chunk) => {
      if (generation !== this.#generation) return
      this.#stats.push(chunk)
      for (const listener of [...this.#listeners]) {
        try {
          listener(chunk)
        } catch {
          // A slow/broken consumer must not kill the video loop.
        }
      }
    })
    child.stderr?.on('data', (chunk) => this.#recordStderr(chunk))
    child.once('error', (error) => this.#recordStderr(`spawn error: ${error instanceof Error ? error.message : String(error)}`))
    child.once('close', (code, signal) => {
      if (this.#child !== child) return
      this.#child = undefined
      if (!this.#stopped && typeof this.onExit === 'function') {
        this.onExit(signal !== null ? `signal ${signal}` : `exit ${String(code)}`)
      }
    })
  }

  stop() {
    this.#stopped = true
    this.#generation += 1
    const child = this.#child
    this.#child = undefined
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      const hardKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 2000)
      hardKill.unref?.()
    }
  }

  reset() {
    this.#stopped = false
    this.#stats.reset()
    this.#stderr = []
    this.#stderrPartial = ''
  }

  #recordStderr(chunk) {
    const text = this.#stderrPartial + chunk.toString('utf8')
    const lines = text.split('\n')
    this.#stderrPartial = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trimEnd()
      if (trimmed === '') continue
      this.#stderr.push(trimmed.length > STDERR_LINE_MAX ? `${trimmed.slice(0, STDERR_LINE_MAX)}...` : trimmed)
      if (this.#stderr.length > 20) this.#stderr.shift()
    }
  }
}
