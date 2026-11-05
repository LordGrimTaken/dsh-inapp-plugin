import { spawn } from 'node:child_process'
import { PngFrameSplitter } from 'file:///C:/Users/Austin/dsh-plugins/game-lab/host/frame.js'

const ADB = 'C:/Users/Austin/dev/tools/android-sdk/platform-tools/adb.exe'
const serial = process.argv[2] || 'emulator-5554'
const mode = process.argv[3] || 'png'

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
  const pixelBytes = 720 * 1280 * 4
  let frames = 0
  let carry = Buffer.alloc(0)
  const result = await measure(['while :; do screencap; done'], 6000, (chunk) => {
    carry = carry.length ? Buffer.concat([carry, chunk]) : chunk
    while (carry.length >= header) {
      const w = carry.readUInt32LE(0)
      const h = carry.readUInt32LE(4)
      const total = header + w * h * 4
      if (w !== 720 && w !== 1280) { carry = Buffer.alloc(0); break }
      if (carry.length < total) break
      frames += 1
      carry = carry.subarray(total)
    }
  })
  console.log(JSON.stringify({ mode: 'raw', frames, fps: +(frames / (result.ms / 1000)).toFixed(2), bytes: result.bytes, mbPerSec: +(result.bytes / (result.ms / 1000) / 1e6).toFixed(1), pixelBytes }))
}
