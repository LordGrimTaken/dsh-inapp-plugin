// Developer probe: measure the PNG/raw screencap throughput of a running
// emulator. Usage: node test/frame-rate-probe.mjs <serial> [png|raw]
// ADB resolution: GAME_LAB_ADB, then %ANDROID_HOME%/platform-tools/adb, then PATH.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { PngFrameSplitter } from '../host/frame.js'

function resolveAdb() {
  if (process.env.GAME_LAB_ADB) return process.env.GAME_LAB_ADB
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  if (sdk) {
    const candidate = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
    if (existsSync(candidate)) return candidate
  }
  return 'adb'
}

const ADB = resolveAdb()
const serial = process.argv[2]
const mode = process.argv[3] || 'png'
if (!serial) {
  console.error('usage: node test/frame-rate-probe.mjs <serial> [png|raw]')
  process.exit(2)
}

function measure(args, ms, onChunk) {
  return new Promise((resolve) => {
    const child = spawn(ADB, ['-s', serial, 'exec-out', ...args], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    const started = Date.now()
    let bytes = 0
    let chunks = 0
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length
      chunks += 1
      if (onChunk) onChunk(chunk)
    })
    child.once('error', (error) => {
      console.error('spawn failed: ' + error.message)
      resolve({ bytes: 0, chunks: 0, ms: Date.now() - started })
    })
    setTimeout(() => {
      try { child.kill() } catch {}
      resolve({ bytes, chunks, ms: Date.now() - started })
    }, ms)
  })
}

if (mode === 'png') {
  const splitter = new PngFrameSplitter()
  let frames = 0
  let pngBytes = 0
  const result = await measure(['while :; do screencap -p; sleep 0.05; done'], 6000, (chunk) => {
    for (const png of splitter.push(chunk)) {
      frames += 1
      pngBytes += png.length
    }
  })
  console.log(JSON.stringify({ mode, frames, fps: +(frames / (result.ms / 1000)).toFixed(2), avgPng: frames ? Math.round(pngBytes / frames) : 0, bytes: result.bytes }))
} else {
  const header = 12
  let frames = 0
  let carry = Buffer.alloc(0)
  const result = await measure(['while :; do screencap; done'], 6000, (chunk) => {
    carry = carry.length ? Buffer.concat([carry, chunk]) : chunk
    while (carry.length >= header) {
      const width = carry.readUInt32LE(0)
      const height = carry.readUInt32LE(4)
      if (width < 100 || width > 4000 || height < 100 || height > 4000) { carry = Buffer.alloc(0); break }
      const total = header + width * height * 4
      if (carry.length < total) break
      frames += 1
      carry = carry.subarray(total)
    }
  })
  console.log(JSON.stringify({ mode: 'raw', frames, fps: +(frames / (result.ms / 1000)).toFixed(2), bytes: result.bytes, mbPerSec: +(result.bytes / (result.ms / 1000) / 1e6).toFixed(1) }))
}
