import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { createWebHandler, API } from '../src/web.js'
import { CheckinError } from '../src/errors.js'
import { VERSION } from '../src/version.js'

function fixture() {
  const calls = []
  const runner = {
    status: async () => ({ schedule: { enabled: true, time: '09:05', timezone: 'Asia/Shanghai', providers: ['trae', 'workbuddy'] }, accounts: { 'secret-account-key': {} }, history: [{ provider: 'trae', status: 'claimed', credits: 100 }] }),
    updateSettings: async patch => { calls.push(patch); if (patch.time === 'bad') throw new CheckinError('settings-input', '时间无效'); return patch },
    qoder: { start: async () => { calls.push('qoder-login'); return { status: 'pending' } }, cancel: async () => { calls.push('qoder-cancel'); return { status: 'idle' } } },
    qoderGlobal: { start: async () => { calls.push('global-login'); return { status: 'pending' } }, cancel: async () => { calls.push('global-cancel'); return { status: 'idle' } } },
    minimax: { start: async () => { calls.push('login'); return { status: 'pending', userCode: 'DEMO' } }, cancel: async () => { calls.push('cancel'); return { status: 'idle' } } },
    run: async () => { calls.push('run'); return { results: {} } },
  }
  const handler = createWebHandler(runner, { token: 'test-control-token' })
  async function request(path, method = 'GET', value, headers = {}) {
    const req = Readable.from(value === undefined ? [] : [Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))])
    Object.assign(req, { method, url: `${API}${path}`, headers: { host: '127.0.0.1:1234', ...headers } })
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers }, end(body) { this.body = JSON.parse(body) } }
    await handler(req, res)
    return res
  }
  return { request, calls }
}
const writeHeaders = { 'x-checkin-token': 'test-control-token', 'content-type': 'application/json', origin: 'http://127.0.0.1:1234' }
test('UI status exposes safe settings/history and a control token, no account map', async () => {
  const { request } = fixture(), res = await request('/status')
  assert.equal(res.body.version, VERSION); assert.ok(res.body.capabilities.includes('minimax-login')); assert.ok(res.body.capabilities.includes('qoder-desktop-login'))
  assert.equal(res.status, 200); assert.equal(res.body.token, 'test-control-token')
  assert.equal(res.body.accounts, undefined); assert.equal(res.body.latest.trae.credits, 100)
  assert.equal(res.headers['Cache-Control'], 'no-store')
})
test('UI rejects untrusted hosts, cross-origin requests and missing write token', async () => {
  const f = fixture()
  for (const headers of [{ host: 'evil.example:1234' }, { origin: 'https://evil.example' }, { origin: 'http://127.0.0.1:5555' }, { 'sec-fetch-site': 'cross-site' }]) assert.equal((await f.request('/status', 'GET', undefined, headers)).status, 403)
  assert.equal((await f.request('/settings', 'POST', { enabled: false }, { 'content-type': 'application/json' })).status, 403)
  assert.deepEqual(f.calls, [])
})
test('UI settings and manual check-in use explicit POST actions', async () => {
  const f = fixture()
  assert.equal((await f.request('/settings', 'POST', { enabled: false, providers: [] }, writeHeaders)).status, 200)
  assert.equal((await f.request('/run', 'POST', {}, writeHeaders)).status, 200)
  assert.deepEqual(f.calls, [{ enabled: false, providers: [] }, 'run'])
  assert.equal((await f.request('/run')).status, 404)
  assert.equal((await f.request('/settings', 'POST', { time: 'bad' }, writeHeaders)).status, 400)
})
test('UI rejects malformed, oversized and unexpected request bodies', async () => {
  const f = fixture()
  for (const value of ['{', ' '.repeat(8193)]) assert.equal((await f.request('/settings', 'POST', value, writeHeaders)).status, 400)
  assert.equal((await f.request('/run', 'POST', { unexpected: true }, writeHeaders)).status, 400)
  assert.equal((await f.request('/run', 'POST', {}, { 'x-checkin-token': 'test-control-token' })).status, 400)
  assert.deepEqual(f.calls, [])
})

test('MiniMax login routes require same-origin JSON POST and control token', async () => {
  const f = fixture()
  assert.equal((await f.request('/minimax/login')).status, 404)
  assert.equal((await f.request('/minimax/login', 'POST', {}, { 'content-type': 'application/json' })).status, 403)
  assert.equal((await f.request('/minimax/login', 'POST', { url: 'https://evil.example' }, writeHeaders)).status, 400)
  assert.equal((await f.request('/minimax/login', 'POST', {}, writeHeaders)).body.status, 'pending')
  assert.equal((await f.request('/minimax/cancel', 'POST', {}, writeHeaders)).body.status, 'idle')
  assert.deepEqual(f.calls, ['login', 'cancel'])
})

test('Qoder browser login and cancellation require trusted POST, JSON and control token', async () => {
  const f = fixture()
  assert.equal((await f.request('/qoder/login')).status, 404)
  assert.equal((await f.request('/qoder/login', 'POST', {}, { 'content-type': 'application/json' })).status, 403)
  assert.equal((await f.request('/qoder/login', 'POST', { token: 'do-not-accept' }, writeHeaders)).status, 400)
  assert.equal((await f.request('/qoder/login', 'POST', {}, writeHeaders)).body.status, 'pending')
  assert.equal((await f.request('/qoder/cancel', 'POST', {}, writeHeaders)).body.status, 'idle')
  assert.deepEqual(f.calls, ['qoder-login', 'qoder-cancel'])
})

 test('Global login routes remain isolated from CN and reject untrusted writes', async () => {
  const f = fixture()
  assert.equal((await f.request('/qoder-global/login')).status, 404)
  assert.equal((await f.request('/qoder-global/login', 'POST', {}, { 'content-type': 'application/json' })).status, 403)
  assert.equal((await f.request('/qoder-global/login', 'POST', { token: 'do-not-accept' }, writeHeaders)).status, 400)
  assert.equal((await f.request('/qoder-global/login', 'POST', {}, { ...writeHeaders, origin: 'https://evil.example' })).status, 403)
  assert.equal((await f.request('/qoder-global/login', 'POST', {}, writeHeaders)).body.status, 'pending')
  assert.equal((await f.request('/qoder-global/cancel', 'POST', {}, writeHeaders)).body.status, 'idle')
  assert.deepEqual(f.calls, ['global-login', 'global-cancel'])
  assert.ok((await f.request('/status')).body.capabilities.includes('qoder-global-login'))
})
