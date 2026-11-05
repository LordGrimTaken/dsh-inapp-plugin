/**
 * HTTP routes for Game Lab, mounted on the DSH webserver.
 *
 * The page and the emulator controller only talk through `/_dsh/game-lab/*`
 * on the existing webserver origin, so there is no second port and no adb
 * exposure to the browser. Every POST is fenced to a trusted, loopback,
 * same-origin request; the read routes accept plain GETs from the same page.
 *
 * Routes:
 *   GET  /status      - snapshot the page polls
 *   GET  /games       - scan the configured roots for APKs and Gradle projects
 *   POST /emulator    - { action: 'start' | 'stop', avd? }
 *   POST /install     - { path } install an APK and launch it
 *   POST /launch      - { packageName } launch an installed package
 *   POST /build       - { projectPath } Gradle assembleDebug -> install -> launch
 *   POST /input       - tap / swipe / key / text / rotate
 *   POST /heartbeat   - keep the emulator alive while the page is visible
 *   GET  /frame.png   - newest frame as one PNG
 *   GET  /stream      - live multipart/x-mixed-replace PNG stream
 *   GET  /logs        - logcat tail
 */

import { URL } from 'node:url'

export const ROUTE_PREFIX = '/_dsh/game-lab'

const MAX_BODY_BYTES = 64 * 1024

class RouteError extends Error {
  constructor(status, message, code = 'bad_request') {
    super(message)
    this.name = 'RouteError'
    this.status = status
    this.code = code
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}

async function readJsonBody(req) {
  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new RouteError(415, 'this endpoint requires application/json', 'bad_content_type')
  }
  const declared = req.headers['content-length']
  if (typeof declared === 'string') {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0) throw new RouteError(400, 'invalid content-length')
    if (length > MAX_BODY_BYTES) throw new RouteError(413, 'request body is too large')
  }
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new RouteError(413, 'request body is too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new RouteError(400, 'the request is not valid JSON')
  }
  if (!isRecord(value)) throw new RouteError(400, 'the request must be a JSON object')
  return value
}

/* ------------------------------------------------------------------ */
/* loopback / same-origin fence                                        */
/* ------------------------------------------------------------------ */

function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const normalized = address.toLowerCase().split('%')[0]
  if (normalized === '::1') return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)) return true
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length)
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(mapped)) return true
    const hexadecimal = /^([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(mapped)
    return hexadecimal !== null && (Number.parseInt(hexadecimal[1], 16) >>> 8) === 127
  }
  return false
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
}

function parseHostHeader(req) {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return null
  try {
    const parsed = new URL(`http://${host}`)
    if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== ''
      || parsed.username !== '' || parsed.password !== '') return null
    return parsed
  } catch {
    return null
  }
}

/** The transport fence for every Game Lab route. */
function isTrustedRequest(req, requireOrigin) {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) return false
  const authority = parseHostHeader(req)
  if (authority === null || !isLoopbackHostname(authority.hostname)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return !requireOrigin
  if (typeof origin !== 'string') return false
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (parsed.hostname === '' || parsed.username !== '' || parsed.password !== ''
      || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') return false
    return parsed.host === authority.host
  } catch {
    return false
  }
}

function requireTrusted(req, requireOrigin) {
  if (!isTrustedRequest(req, requireOrigin)) {
    throw new RouteError(403, 'the Game Lab route requires a loopback same-origin browser request', 'forbidden')
  }
}

function requireMethod(req, method) {
  if (req.method !== method) {
    throw new RouteError(405, `this route only accepts ${method}`, 'bad_method')
  }
}

/* ------------------------------------------------------------------ */
/* dispatch                                                            */
/* ------------------------------------------------------------------ */

/**
 * Mount the routes. Returns the disposer that removes them again.
 * `webServer` is the DSH host service with a `register(route)` method.
 */
export function mountRoutes(webServer, lab) {
  const disposer = webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => {
      handleRequest(req, res, lab).catch((error) => {
        answerError(res, error)
      })
    },
  })
  return () => {
    try {
      disposer()
    } catch {
      // The server may already be gone during shutdown.
    }
  }
}

async function handleRequest(req, res, lab) {
  let pathname
  try {
    pathname = new URL(req.url ?? '/', 'http://dsh.local').pathname
  } catch {
    throw new RouteError(400, 'invalid request path')
  }
  const sub = pathname.slice(ROUTE_PREFIX.length) || '/'
  const query = new URL(req.url ?? '/', 'http://dsh.local').searchParams

  switch (sub) {
    case '/status': {
      requireMethod(req, 'GET')
      requireTrusted(req, false)
      sendJson(res, 200, lab.status())
      return
    }
    case '/games': {
      requireMethod(req, 'GET')
      requireTrusted(req, false)
      const value = await lab.listGames(query.get('refresh') === '1')
      sendJson(res, 200, value)
      return
    }
    case '/emulator': {
      requireMethod(req, 'POST')
      requireTrusted(req, true)
      const body = await readJsonBody(req)
      const action = body.action
      if (action === 'start') {
        const avd = typeof body.avd === 'string' ? body.avd : undefined
        // The route answers immediately; the page polls /status while it boots.
        Promise.resolve()
          .then(() => lab.startEmulator({ avd }))
          .catch(() => {})
        sendJson(res, 202, { ok: true, state: 'booting' })
        return
      }
      if (action === 'stop') {
        Promise.resolve()
          .then(() => lab.stopEmulator({ reason: 'user' }))
          .catch(() => {})
        sendJson(res, 202, { ok: true, state: 'stopping' })
        return
      }
      throw new RouteError(400, 'action must be "start" or "stop"')
    }
    case '/install': {
      requireMethod(req, 'POST')
      requireTrusted(req, true)
      const body = await readJsonBody(req)
      if (typeof body.path !== 'string' || body.path.trim() === '') throw new RouteError(400, 'path is required')
      const result = await lab.installAndLaunch(body.path)
      sendJson(res, 200, result)
      return
    }
    case '/launch': {
      requireMethod(req, 'POST')
      requireTrusted(req, true)
      const body = await readJsonBody(req)
      if (typeof body.packageName !== 'string' || body.packageName.trim() === '') {
        throw new RouteError(400, 'packageName is required')
      }
      sendJson(res, 200, await lab.launchPackage(body.packageName))
      return
    }
    case '/build': {
      requireMethod(req, 'POST')
      requireTrusted(req, true)
      const body = await readJsonBody(req)
      if (typeof body.projectPath !== 'string' || body.projectPath.trim() === '') {
        throw new RouteError(400, 'projectPath is required')
      }
      sendJson(res, 200, await lab.buildProject(body.projectPath))
      return
    }
    case '/input': {
      requireMethod(req, 'POST')
      requireTrusted(req, true)
      const body = await readJsonBody(req)
      sendJson(res, 200, await lab.input(body))
      return
    }
    case '/heartbeat': {
      requireMethod(req, 'POST')
      requireTrusted(req, true)
      await readJsonBody(req)
      lab.touch('heartbeat')
      lab.demandFrames(60000)
      const status = lab.status()
      sendJson(res, 200, { ok: true, idleStopAt: status.emulator.idleStopAt, fps: status.emulator.fps })
      return
    }
    case '/frame.png': {
      requireMethod(req, 'GET')
      requireTrusted(req, false)
      const png = await lab.framePng()
      if (png === undefined) {
        sendJson(res, 404, { ok: false, error: 'no frame is available (the emulator is not running)' })
        return
      }
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(png.length),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin',
        'referrer-policy': 'no-referrer',
      })
      res.end(png)
      return
    }
    case '/stream': {
      requireMethod(req, 'GET')
      requireTrusted(req, false)
      lab.openStream(res)
      return
    }
    case '/logs': {
      requireMethod(req, 'GET')
      requireTrusted(req, false)
      const lines = Number(query.get('lines') ?? '200')
      const result = await lab.readLogs({ packageName: query.get('packageName') ?? '', lines })
      sendJson(res, 200, result)
      return
    }
    default:
      sendJson(res, 404, { ok: false, error: `unknown Game Lab route ${pathname}` })
  }
}

function answerError(res, error) {
  const status = error instanceof RouteError ? error.status : 503
  const code = error instanceof RouteError ? error.code : 'unavailable'
  const message = errorMessage(error)
  if (res.headersSent) {
    try {
      res.destroy()
    } catch {
      // Already gone.
    }
    return
  }
  sendJson(res, status, {
    ok: false,
    code,
    error: message,
    // A short hint for the page to localize without parsing host strings.
    hint: status === 403 ? 'trusted_origin' : status === 503 ? 'emulator' : 'request',
  })
}

/** Exported for unit tests without a real HTTP server. */
export const internals = { isTrustedRequest, isLoopbackAddress, ROUTE_PREFIX }
