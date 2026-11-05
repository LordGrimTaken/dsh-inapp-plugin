// Tests for the PNG frame pipeline. Run: node --test test/frame.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { PngFrameSplitter, pngDimensions, PNG_SIGNATURE, MultipartWriter } from '../host/frame.js'

/** Build one minimal but structurally valid PNG (enough for the splitter). */
function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4) // the splitter does not verify CRCs
  return Buffer.concat([length, body, crc])
}

function fakePng(width, height, idat = 64) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.alloc(idat, 0x42)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

test('pngDimensions reads IHDR without decoding', () => {
  const png = fakePng(720, 1280)
  assert.deepEqual(pngDimensions(png), { width: 720, height: 1280 })
  assert.equal(pngDimensions(PNG_SIGNATURE), undefined)
  assert.equal(pngDimensions(Buffer.from('not a png')), undefined)
})

test('splitter cuts concatenated frames exactly', () => {
  const a = fakePng(720, 1280)
  const b = fakePng(1280, 720, 100)
  const splitter = new PngFrameSplitter()
  const frames = splitter.push(Buffer.concat([a, b]))
  assert.equal(frames.length, 2)
  assert.equal(frames[0].length, a.length)
  assert.equal(frames[1].length, b.length)
  assert.deepEqual(pngDimensions(frames[1]), { width: 1280, height: 720 })
})

test('splitter is incremental across arbitrary chunk boundaries', () => {
  const a = fakePng(720, 1280)
  const b = fakePng(720, 1280, 128)
  const all = Buffer.concat([a, b])
  const splitter = new PngFrameSplitter()
  const frames = []
  for (let index = 0; index < all.length; index += 7) {
    frames.push(...splitter.push(all.subarray(index, Math.min(all.length, index + 7))))
  }
  assert.equal(frames.length, 2)
  assert.equal(frames[0].length, a.length)
  assert.equal(frames[1].length, b.length)
})

test('splitter resyncs after garbage instead of stalling', () => {
  const a = fakePng(720, 1280)
  const splitter = new PngFrameSplitter()
  const frames = splitter.push(Buffer.concat([Buffer.from('noise-noise'), a]))
  assert.equal(frames.length, 1)
  assert.equal(frames[0].length, a.length)
})

test('multipart writer emits rfc-style parts and skips frames while congested', () => {
  const writes = []
  let ended = false
  let drain = null
  let congestNextPng = false
  const png = fakePng(720, 1280)
  const res = {
    writeHead(status, headers) {
      writes.push({ status, headers })
    },
    write(data) {
      writes.push({ data })
      if (Buffer.isBuffer(data) && congestNextPng) {
        congestNextPng = false
        return false
      }
      return true
    },
    end() {
      ended = true
    },
    on(event, handler) {
      if (event === 'drain') drain = handler
    },
  }
  const writer = new MultipartWriter(res)
  writer.writeFrame({ png, width: 720, height: 1280 })
  assert.equal(writes[0].status, 200)
  assert.match(writes[0].headers['content-type'], /^multipart\/x-mixed-replace; boundary=/)
  const header = writes.find((entry) => typeof entry.data === 'string')
  assert.match(header.data, /Content-Type: image\/png/)
  assert.match(header.data, new RegExp(`Content-Length: ${png.length}`))

  // A saturated socket drops the frame instead of queueing it.
  congestNextPng = true
  writer.writeFrame({ png, width: 720, height: 1280 })
  const before = writes.length
  writer.writeFrame({ png, width: 720, height: 1280 })
  assert.equal(writes.length, before)

  // After drain the next frame flows again.
  drain()
  writer.writeFrame({ png, width: 720, height: 1280 })
  assert.ok(writes.length > before)
  writer.close()
  assert.equal(ended, true)
})
