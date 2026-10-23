// Local UI test fixture: actual client and API; simulated check-in responses.
// Supply React UMD files from a local runtime with --vendor /path/to/vendor.
import { createServer } from 'node:http'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Runner } from '../src/runner.js'
import { QoderAuth } from '../src/qoder.js'
import { MiniMaxAuth } from '../src/minimax.js'
import { createWebHandler, API } from '../src/web.js'
const args = process.argv.slice(2)
const vendor = args[args.indexOf('--vendor') + 1]
if (!vendor) throw new Error('Pass --vendor with React and ReactDOM UMD files')
const dataArg = args.indexOf('--data-dir')
const dir = dataArg >= 0 ? args[dataArg + 1] : await mkdtemp(join(tmpdir(), 'dsh-checkin-ui-'))
const minimax = new MiniMaxAuth({ dataDir: dir }, {
  form: async url => url.endsWith('/device/code') ? { device_code: 'mock-device-code', user_code: 'DEMO-CODE', verification_uri: 'https://account.minimax.cn', expires_in: 600, interval: 5 } : { access_token: 'mock-access', refresh_token: 'mock-refresh', token_type: 'Bearer', expires_in: 3600, scope: 'agent.default' },
  get: async () => ({ statusInfo: { code: 0 }, data: { userInfo: { realUserID: 'mock-user' } } }),
})
const qoder = new QoderAuth({ dataDir: dir }, {
  get: async url => url.includes('/deviceToken/poll') ? { token: 'mock-qoder-device', user_id: 'mock-qoder-user', refresh_token: 'mock-qoder-refresh', expires_in: 3600 } : { id: 'mock-qoder-user' },
})
const qoderGlobal = new QoderAuth({ dataDir: dir }, {
  get: async url => url.includes('/deviceToken/poll') ? { token: 'mock-global-device', user_id: 'mock-global-user', refresh_token: 'mock-global-refresh', expires_in: 3600 } : { id: 'mock-global-user' },
}, { region: 'global' })
const runner = new Runner({ dataDir: dir }, {
  qoder, qoderGlobal, minimax, transport: {}, readers: { trae: async () => ({ key: 'demo-trae' }), workbuddy: async () => ({ key: 'demo-wb' }), qoder: () => qoder.credential(), 'qoder-global': () => qoderGlobal.credential(), minimax: () => minimax.credential() },
  checkers: { 'qoder-global': async () => ({ status: 'claimed', credits: 100, message: 'Qoder 国际版积分领取成功，服务端已确认。' }), trae: async () => ({ status: 'claimed', credits: 100, message: '签到成功，服务端已确认。' }), workbuddy: async () => ({ status: 'already-claimed', message: '今日已签到。' }), qoder: async () => ({ status: 'claimed', credits: 100, message: 'Qoder CN 积分领取成功，服务端已确认。' }), minimax: async () => ({ status: 'claimed', credits: 400, message: 'MiniMax Code 签到成功，服务端已确认。' }) },
})
const api = createWebHandler(runner)
const server = createServer(async (req, res) => {
  if (args.includes('--legacy') && req.url === `${API}/status`) {
    const { minimax, qoder, ...state } = await runner.status()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ...state, latest: {}, token: 'legacy-fixture' }))
    return
  }
  if (req.url.startsWith(API)) return api(req, res)
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return }
  const file = req.url === '/client.js' ? new URL('../src/client.js', import.meta.url) : req.url === '/react.js' ? join(vendor, 'react.development.js') : req.url === '/react-dom.js' ? join(vendor, 'react-dom.development.js') : undefined
  if (file) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(await readFile(file)); return }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>积分签到 · UI 验证</title></head><body style="margin:0;padding:32px;background:#f7f8fa"><p style="max-width:850px;margin:0 auto 12px;color:#8b642d;font:13px sans-serif">界面验证 · 登录与签到记录均为模拟数据，不代表真实领取</p><main id="root" style="max-width:850px;margin:auto;padding:28px;background:white;border-radius:16px"></main><script src="/react.js"></script><script src="/react-dom.js"></script><script>window.__ModuleLoader__={load({factory}){const plugin=factory(name=>{if(name==='react')return React;throw Error(name)});plugin.apply({slots:{inject(name,callback){callback()},register(spec,Component){if(spec.name==='settings.section')ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Component));return()=>{}}}})}}</script><script src="/client.js"></script></body></html>`)
})
server.listen(0, '127.0.0.1', () => console.log(`PREVIEW http://127.0.0.1:${server.address().port} DATA ${dir}`))
process.on('SIGTERM', async () => { server.close(); await runner.dispose(); process.exit(0) })
