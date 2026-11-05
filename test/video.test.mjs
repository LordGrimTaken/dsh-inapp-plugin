// Tests for the H.264 statistics counter. Run: node --test test/video.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { H264Stats } from '../host/video.js'

function nal(type, payloadLength = 8) {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x01, type & 0x1f]),
    Buffer.alloc(payloadLength, 0x42),
  ])
}

test('counts SPS/PPS and VCL frames, tolerates split start codes', () => {
  const stats = new H264Stats()
  const stream = Buffer.concat([
    nal(7, 12),
    nal(8, 4),
    nal(5, 40),
    nal(1, 20),
    nal(1, 20),
  ])
  // Feed byte by byte so every possible start-code split is exercised.
  for (let i = 0; i < stream.length; i += 1) stats.push(stream.subarray(i, i + 1))
  const snapshot = stats.snapshot()
  assert.equal(snapshot.sps, true)
  assert.equal(snapshot.pps, true)
  assert.equal(snapshot.frames, 3)
  assert.equal(snapshot.bytes, stream.length)
  assert.ok(snapshot.kbps >= 0)
})

test('reset clears the counter for a restarted screenrecord process', () => {
  const stats = new H264Stats()
  stats.push(Buffer.concat([nal(7, 4), nal(8, 4), nal(5, 20)]))
  assert.equal(stats.snapshot().frames, 1)
  stats.reset()
  const empty = stats.snapshot()
  assert.equal(empty.frames, 0)
  assert.equal(empty.bytes, 0)
  assert.equal(empty.sps, false)
  assert.equal(empty.pps, false)
})
