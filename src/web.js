import { randomBytes } from 'node:crypto'
import { safeError } from './errors.js'
import { PROVIDERS } from './config.js'
import { VERSION } from './version.js'

export const API = '/plugins/dsh-credit-checkin'
const loopback = hostname => ['127.0.0.1', 'localhost', '[::1]'].includes(hostname)
function trusted(req) {
  try {
    const host = new URL(`http://${req.headers.host}`)
    if (!loopback(host.hostname)) return false
    if (req.headers.origin) {
      const origin = new URL(req.headers.origin)
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== host.host) return false
    }
    return req.headers['sec-fetch-site'] !== 'cross-site'
  } catch { return false }
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(value))
}
async function body(req) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new Error('body')
  let size = 0, chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 8192) throw new Error('body')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString())
}
export function createWebHandler(runner, { token = randomBytes(32).toString('hex') } = {}) {
  return async (req, res) => {
    if (!trusted(req)) return json(res, 403, { error: '请求来源不受信任。' })
    const path = new URL(req.url, 'http://localhost').pathname
    if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: '不支持的请求方法。' })
    try {
      if (path === `${API}/status` && req.method === 'GET') {
        const state = await runner.status()
        const latest = Object.fromEntries(PROVIDERS.map(p => [p, state.history.findLast(row => row.provider === p) ?? null]))
        return json(res, 200, { version: VERSION, capabilities: ['minimax-login', 'qoder-browser-login', 'qoder-desktop-login', 'qoder-global-login'], schedule: state.schedule, running: state.running, latest, minimax: state.minimax, qoder: state.qoder, 'qoder-global': state['qoder-global'], history: state.history.slice(-20).reverse(), token })
      }
      if (req.method === 'POST' && [`${API}/settings`, `${API}/run`, `${API}/minimax/login`, `${API}/minimax/cancel`, `${API}/qoder/login`, `${API}/qoder/cancel`, `${API}/qoder-global/login`, `${API}/qoder-global/cancel`].includes(path)) {
        if (req.headers['x-checkin-token'] !== token) return json(res, 403, { error: '页面已过期，请刷新后重试。' })
        let input
        try { input = await body(req) } catch { return json(res, 400, { error: '请求必须为有效 JSON，且不超过 8 KiB。' }) }
        if (path.endsWith('/settings')) return json(res, 200, { schedule: await runner.updateSettings(input) })
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) return json(res, 400, { error: '此操作不接受额外参数。' })
        if (path.endsWith('/qoder-global/login')) return json(res, 200, await runner.qoderGlobal.start())
        if (path.endsWith('/qoder-global/cancel')) return json(res, 200, await runner.qoderGlobal.cancel())
        if (path.endsWith('/qoder/login')) return json(res, 200, await runner.qoder.start())
        if (path.endsWith('/qoder/cancel')) return json(res, 200, await runner.qoder.cancel())
        if (path.endsWith('/minimax/login')) return json(res, 200, await runner.minimax.start())
        if (path.endsWith('/minimax/cancel')) return json(res, 200, await runner.minimax.cancel())
        return json(res, 200, await runner.run({ manual: true }))
      }
      return json(res, 404, { error: '接口不存在。' })
    } catch (e) {
      const error = safeError(e)
      return json(res, e.code === 'settings-input' ? 400 : 500, { error: error.message, code: error.code })
    }
  }
}

export function registerWeb(ctx, runner) {
  ctx.effect(() => ctx.get('webServer').register({ kind: 'prefix', path: API, handler: createWebHandler(runner) }))
}
