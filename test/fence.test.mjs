// Tests for the Game Lab route fence. Run: node --test test/fence.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { internals } from '../host/routes.js'

function fakeRequest(overrides = {}) {
  const { headers, ...rest } = overrides
  return {
    method: 'POST',
    url: '/_dsh/game-lab/input',
    headers: { host: '127.0.0.1:61387', ...(headers ?? {}) },
    socket: { remoteAddress: '127.0.0.1' },
    ...rest,
  }
}

test('loopback addresses are recognised, LAN addresses are not', () => {
  const { isLoopbackAddress } = internals
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('127.4.3.2'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(isLoopbackAddress('192.168.4.20'), false)
  assert.equal(isLoopbackAddress('10.0.0.5'), false)
  assert.equal(isLoopbackAddress(undefined), false)
})

test('same-origin POST from the local page is trusted', () => {
  const request = fakeRequest({ headers: { origin: 'http://127.0.0.1:61387' } })
  assert.equal(internals.isTrustedRequest(request, true), true)
  assert.equal(internals.isTrustedRequest(request, false), true)
})

test('trusted for GETs without an Origin header, refused for state-changing POSTs', () => {
  assert.equal(internals.isTrustedRequest(fakeRequest({ method: 'GET' }), false), true)
  assert.equal(internals.isTrustedRequest(fakeRequest({ method: 'POST', headers: {} }), true), false)
})

test('cross-origin, cross-site and LAN requests are refused', () => {
  assert.equal(internals.isTrustedRequest(
    fakeRequest({ headers: { origin: 'http://127.0.0.1:9999' } }), true), false)
  assert.equal(internals.isTrustedRequest(
    fakeRequest({ headers: { origin: 'https://evil.example' } }), true), false)
  assert.equal(internals.isTrustedRequest(
    fakeRequest({ headers: { origin: 'http://127.0.0.1:61387', 'sec-fetch-site': 'cross-site' } }), true), false)
  assert.equal(internals.isTrustedRequest(
    fakeRequest({ socket: { remoteAddress: '192.168.0.10' }, headers: { origin: 'http://127.0.0.1:61387' } }), true), false)
})

test('non-loopback Host header is refused even from a loopback peer', () => {
  assert.equal(internals.isTrustedRequest(
    fakeRequest({ headers: { host: 'example.com:61387', origin: 'http://example.com:61387' } }), true), false)
})
