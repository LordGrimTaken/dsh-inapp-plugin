// Host integration test: GameLab config/toolchain/library + mounted routes on a
// plain HTTP server. Does NOT boot the emulator (that is exercised live).
// Run: node --test test/integration.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { GameLab, normalizeConfig, resolveToolchain } from '../host/emulator.js'
import { mountRoutes, ROUTE_PREFIX } from '../host/routes.js'

test('toolchain resolves the dev Android SDK on this machine', () => {
  const toolchain = resolveToolchain()
  assert.equal(toolchain.ok, true, toolchain.reason ?? 'no reason')
  assert.match(toolchain.adb, /platform-tools[\\/]adb(\.exe)?$/i)
  assert.match(toolchain.emulator, /emulator[\\/]emulator(\.exe)?$/i)
  assert.match(toolchain.aapt2, /aapt2(\.exe)?$/i)
  assert.ok(toolchain.avdmanager === null || /avdmanager(\.bat)?$/i.test(toolchain.avdmanager))
})

test('config clamps unsafe values and keeps configured roots', () => {
  const config = normalizeConfig({
    ramMb: 99999,
    cores: 0,
    maxFps: 900,
    idleMinutes: 0,
    gameRoots: ['C:\\dev\\dsh-workspace', 'relative/path', 'C:\\Users\\Austin\\Deliverables'],
    gpuMode: 'nonsense',
  })
  assert.equal(config.ramMb, 6144)
  assert.equal(config.cores, 2) // 0 is replaced by the default, then clamped
  assert.equal(config.maxFps, 20)
  assert.equal(config.idleMinutes, 5) // 0 is replaced by the default
  assert.equal(config.gpuMode, 'host')
  assert.deepEqual(config.gameRoots, ['C:\\dev\\dsh-workspace', 'C:\\Users\\Austin\\Deliverables'])
  assert.equal(normalizeConfig({}).avdName, 'gamelab')
})

test('status snapshot has the shape the page polls', () => {
  const lab = new GameLab({}, { avdName: 'gamelab', gameRoots: ['C:\\dev\\dsh-workspace'] })
  const status = lab.status()
  assert.equal(status.ok, true)
  assert.equal(status.emulator.state, 'off')
  assert.equal(typeof status.serverTime, 'number')
  assert.equal(status.config.avdName, 'gamelab')
  assert.equal(status.build.state, 'idle')
  assert.equal(status.toolchain.ok, true)
  lab.dispose().catch(() => {})
})

test('games scan finds real APKs in the workspace', async () => {
  const lab = new GameLab({}, { gameRoots: ['C:\\dev\\dsh-workspace', 'C:\\Users\\Austin\\Deliverables'] })
  const value = await lab.listGames(true)
  assert.equal(value.ok, true)
  assert.ok(value.games.length > 3, `expected demo APKs, got ${value.games.length}`)
  assert.ok(value.projects.length >= 1)
  const shadowmire = value.games.find((game) => /shadowmire/i.test(game.fileName))
  assert.ok(shadowmire !== undefined, 'Shadowmire APK not found')
  assert.equal(shadowmire.isLatest, true)
  assert.equal(shadowmire.path.toLowerCase().endsWith('.apk'), true)
  lab.dispose().catch(() => {})
})

// The route handlers only need webserver-shaped register() and a real HTTP
// socket; this proves the fence, JSON envelope and query dispatch end to end.
test('routes answer /status and /games over loopback HTTP', async () => {
  const lab = new GameLab({}, { gameRoots: ['C:\\dev\\dsh-workspace'] })
  const route = { handler: null }
  const mockWebServer = {
    register(spec) {
      assert.equal(spec.kind, 'prefix')
      assert.equal(spec.path, ROUTE_PREFIX)
      route.handler = spec.handler
      return () => { route.handler = null }
    },
  }
  const disposeRoutes = mountRoutes(mockWebServer, lab)
  const server = http.createServer((req, res) => {
    if (req.url !== undefined && req.url.startsWith(ROUTE_PREFIX) && route.handler !== null) {
      route.handler(req, res)
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`

  try {
    const statusResponse = await fetch(`${origin}${ROUTE_PREFIX}/status`)
    assert.equal(statusResponse.status, 200)
    const status = await statusResponse.json()
    assert.equal(status.ok, true)
    assert.equal(status.emulator.state, 'off')

    const gamesResponse = await fetch(`${origin}${ROUTE_PREFIX}/games`)
    assert.equal(gamesResponse.status, 200)
    const games = await gamesResponse.json()
    assert.ok(games.games.length > 0)

    // The page's own requests carry the same-origin Origin header.
    const sameOriginHeaders = { 'content-type': 'application/json', origin }
    const heartbeat = await fetch(`${origin}${ROUTE_PREFIX}/heartbeat`, {
      method: 'POST',
      headers: sameOriginHeaders,
      body: '{}',
    })
    assert.equal(heartbeat.status, 200)
    const beat = await heartbeat.json()
    assert.equal(beat.ok, true)

    // A cross-origin POST is fenced.
    const fenced = await fetch(`${origin}${ROUTE_PREFIX}/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: '{}',
    })
    assert.equal(fenced.status, 403)
    const fencedBody = await fenced.json()
    assert.equal(fencedBody.ok, false)

    // Input while the emulator is off is an explicit failure, not a crash.
    const badInput = await fetch(`${origin}${ROUTE_PREFIX}/input`, {
      method: 'POST',
      headers: sameOriginHeaders,
      body: '{"kind":"tap","x":"nope","y":1}',
    })
    assert.equal(badInput.status, 503)
    const badBody = await badInput.json()
    assert.equal(badBody.ok, false)
  } finally {
    disposeRoutes()
    await new Promise((resolve) => server.close(resolve))
    await lab.dispose()
  }
})
