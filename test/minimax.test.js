import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { MockAgent } from 'undici'
import { checkinMinimax, MiniMaxAuth, readMinimaxLocal, minimaxPaths, minimaxRequest } from '../src/minimax.js'
import { createTransport } from '../src/providers.js'
import { Runner } from '../src/runner.js'

const auth = { accessToken: 'mock-access', realUserID: 'mock-user' }
const wrap = data => ({ base_resp: { status_code: 0 }, data })
const panel = (status = 2) => ({ scene: 2, days: Array.from({ length: 7 }, (_, i) => ({ day_no: i + 1, points: i === 3 ? 1000 : 400, bonus_points: i === 3 ? 600 : 0, status: i < 3 ? 3 : i === 3 ? status : 1, is_today: i === 3 })) })
const receipt = overrides => wrap({ claim_id: 'claim-1', claim_result: 1, day_no: 4, points: 1000, expire_at_ms: Date.now() + 86400000, panel: panel(3), ...overrides })
function transport(docs) {
  const calls = []
  const next = async (...args) => { calls.push(args); const doc = docs.shift(); if (doc instanceof Error) throw doc; return doc }
  return { calls, get: next, post: next }
}
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-minimax-'))
  const config = { dataDir: dir, minimaxHome: join(dir, 'native'), ...options.config }
  let now = Date.now(), grantCalls = 0
  const calls = []
  const io = {
    form: async (url, values) => {
      calls.push({ url, values })
      if (url.endsWith('/device/code')) return options.device ?? { device_code: 'mock-device-secret', user_code: 'ABCD-EFGH', verification_uri: 'https://account.minimax.cn/activate', expires_in: 600, interval: 5 }
      return options.grants?.[grantCalls++] ?? { access_token: 'mock-access', refresh_token: 'mock-refresh', token_type: 'Bearer', scope: 'agent.default', expires_in: 3600 }
    },
    get: async () => options.identity ?? { statusInfo: { code: 0 }, data: { userInfo: { realUserID: 'mock-user' } } },
  }
  const manager = new MiniMaxAuth(config, io, { now: () => now })
  t.after(async () => { await manager.dispose(); await rm(dir, { recursive: true, force: true }) })
  return { config, dir, manager, calls, io, advance: ms => { now += ms } }
}
test('MiniMax checks status and validates receipt; points already include bonus', async () => {
  const io = transport([wrap(panel()), receipt()])
  assert.deepEqual(await checkinMinimax(auth, io), { status: 'claimed', message: 'MiniMax Code 签到成功，服务端已确认。', credits: 1000 })
  assert.equal(io.calls.length, 2)
  const url = new URL(io.calls[1][0])
  assert.equal(url.origin, 'https://agent.minimaxi.com')
  assert.equal(url.pathname, '/minimax-cloud/api/v1/signin/claim')
  assert.equal(url.searchParams.get('user_id'), 'mock-user')
  assert.deepEqual(io.calls[1][2], {})
})
test('MiniMax skips already signed and unavailable rounds without POST', async () => {
  for (const [status, expected] of [[3, 'already-claimed'], [4, 'unavailable']]) {
    const io = transport([wrap(panel(status))])
    assert.equal((await checkinMinimax(auth, io)).status, expected); assert.equal(io.calls.length, 1)
  }
  assert.equal((await checkinMinimax(auth, transport([wrap(panel()), receipt({ claim_result: 2 })]))).status, 'already-claimed')
})
test('MiniMax rejects malformed, missing, ambiguous or unconfirmed receipts', async () => {
  const invalid = panel(); invalid.days[1].status = 2
  await assert.rejects(checkinMinimax(auth, transport([wrap(invalid)])), { code: 'protocol' })
  for (const doc of [{}, wrap({}), { base_resp: { status_code: 1000048 } }]) await assert.rejects(checkinMinimax(auth, transport([doc])))
  for (const overrides of [{ claim_id: '' }, { claim_result: 0 }, { points: -1 }, { day_no: 5 }, { panel: panel() }]) await assert.rejects(checkinMinimax(auth, transport([wrap(panel()), receipt(overrides)])), { code: 'protocol' })
})
test('MiniMax request attribution signs exact query/body and fixes origin', () => {
  const r = minimaxRequest('/minimax-cloud/api/v1/signin/claim', auth, { now: 1760000000000, body: '{}' })
  const md5 = v => createHash('md5').update(v).digest('hex')
  const u = new URL(r.url)
  assert.equal(r.headers.Authorization, 'Bearer mock-access')
  assert.equal(r.headers.yy, md5(`${encodeURIComponent(u.pathname + u.search)}_{}${md5('1760000000000')}ooui`))
  assert.equal(r.headers['x-signature'], md5('1760000000I*7Cf%WZ#S&%1RlZJ&C2{}'))
})
test('OAuth authorization uses PKCE, persists only after identity verification, status hides secrets', async t => {
  const f = await fixture(t)
  const pending = await f.manager.start()
  assert.equal(pending.status, 'pending'); assert.equal(pending.connection, 'signed-out')
  assert.equal(pending.userCode, 'ABCD-EFGH')
  assert.equal(f.calls[0].values.code_challenge_method, 'S256')
  assert.ok(!JSON.stringify(pending).includes('mock-device-secret'))
  assert.ok(!JSON.stringify(pending).includes('verifier'))
  await f.manager.poll()
  assert.equal((await f.manager.status()).connection, 'connected')
  const file = minimaxPaths(f.config).own
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).realUserID, 'mock-user')
  assert.ok(!JSON.stringify(await f.manager.status()).includes('mock-access'))
  const c = await f.manager.credential(); assert.equal(c.realUserID, 'mock-user'); assert.notEqual(c.key, c.realUserID)
})
test('OAuth supports account user_code polling and millisecond interval', async t => {
  const f = await fixture(t, { device: { user_code: 'ABCD', verification_url: 'https://account.minimax.cn/activate?code=ABCD', expired_in: 600, interval: 5000 } })
  await f.manager.start(); assert.equal(f.manager.pending.interval, 5000)
  await f.manager.poll()
  assert.equal(f.calls[1].values.user_code, 'ABCD'); assert.equal(f.calls[1].values.device_code, undefined)
  const challenge = createHash('sha256').update(f.calls[1].values.code_verifier).digest('base64url')
  assert.equal(challenge, f.calls[0].values.code_challenge)
})
test('OAuth pending/slow_down, denied, expiration and cancel do not save tokens', async t => {
  const f = await fixture(t, { grants: [{ error: 'authorization_pending' }, { status: 'slow_down' }, { status: 'access_denied' }] })
  await f.manager.start(); await f.manager.poll(); assert.equal((await f.manager.status()).status, 'pending')
  await f.manager.poll(); assert.equal(f.manager.pending.interval, 10000)
  await f.manager.poll(); assert.equal((await f.manager.status()).status, 'failed')
  await assert.rejects(readFile(minimaxPaths(f.config).own))
  await f.manager.start(); f.advance(601000); await f.manager.poll()
  assert.match((await f.manager.status()).message, /过期/)
  await f.manager.start(); await f.manager.cancel(); await f.manager.poll()
  assert.equal((await f.manager.status()).status, 'idle')
})
test('OAuth rejects foreign authorization links and missing required scope', async t => {
  const f = await fixture(t, { device: { device_code: 'x', user_code: 'y', verification_uri: 'https://evil.example/login', expires_in: 600 } })
  await assert.rejects(f.manager.start(), { code: 'protocol' })
  const g = await fixture(t, { grants: [{ access_token: 'secret', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 3600, scope: 'wrong' }] })
  await g.manager.start(); await g.manager.poll()
  assert.equal((await g.manager.status()).connection, 'signed-out')
  assert.ok(!JSON.stringify(await g.manager.status()).includes('secret'))
})
test('OAuth verifies account identity before saving authorization', async t => {
  const f = await fixture(t, { identity: { statusInfo: { code: 1000048 }, data: { userInfo: { realUserID: 'wrong-user' } } } })
  await f.manager.start(); await f.manager.poll()
  assert.equal((await f.manager.status()).status, 'failed')
  await assert.rejects(readFile(minimaxPaths(f.config).own))
})
test('plugin OAuth refresh rotates credentials and re-resolves identity', async t => {
  const f = await fixture(t)
  await writeFile(minimaxPaths(f.config).own, JSON.stringify({ accessToken: 'old', refreshToken: 'refresh', realUserID: 'stale', expiresAtMs: 1 }))
  const [a, b] = await Promise.all([f.manager.credential(), f.manager.credential()])
  assert.equal(a.accessToken, 'mock-access'); assert.deepEqual(a, b)
  assert.equal(a.realUserID, 'mock-user'); assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].values.grant_type, 'refresh_token')
  assert.equal(JSON.parse(await readFile(minimaxPaths(f.config).own, 'utf8')).refreshToken, 'mock-refresh')
})
test('reads exact native namespace, matches identity fingerprint, never rewrites native credentials', async t => {
  const f = await fixture(t), paths = minimaxPaths(f.config)
  const account = createHash('sha256').update(`${join(paths.home, 'auth')}\0mcode-public`).digest('base64url')
  const doc = { schemaVersion: 1, records: { [`com.minimax.mcode.oauth.prod.cn\0${account}`]: { ...auth, realUserID: undefined, clientId: 'mcode-public', audience: 'agent-backend', expiresAtMs: Date.now() + 3600000 } } }
  await mkdir(dirname(paths.native), { recursive: true }); await writeFile(paths.native, JSON.stringify(doc))
  assert.equal((await readMinimaxLocal(f.config)).source, 'client')
  const c = await f.manager.credential(); assert.equal(c.realUserID, 'mock-user')
  assert.equal(await readFile(paths.native, 'utf8'), JSON.stringify(doc))
  await mkdir(dirname(paths.identity), { recursive: true }); await writeFile(paths.identity, JSON.stringify({ status: 'verified', region: 'cn', buildEnv: 'prod', tokenFingerprint: createHash('sha256').update(auth.accessToken).digest('hex'), realUserID: 'verified-user' }))
  assert.equal((await readMinimaxLocal(f.config)).realUserID, 'verified-user')
})
test('OAuth HTTP form encoding accepts pending 400 but rejects server and redirect responses', async () => {
  const agent = new MockAgent(); agent.disableNetConnect()
  const pool = agent.get('https://account.minimax.cn')
  pool.intercept({ path: '/oauth2/token', method: 'POST', body: 'client_id=mcode-public&code_verifier=a%2Bb' }).reply(400, { error: 'authorization_pending' })
  pool.intercept({ path: '/oauth2/token', method: 'POST' }).reply(500, { error: 'authorization_pending' })
  pool.intercept({ path: '/oauth2/token', method: 'POST' }).reply(302, '', { headers: { location: 'https://evil.example' } })
  const io = createTransport({ dispatcher: agent })
  try {
    assert.equal((await io.form('https://account.minimax.cn/oauth2/token', { client_id: 'mcode-public', code_verifier: 'a+b' })).error, 'authorization_pending')
    await assert.rejects(io.form('https://account.minimax.cn/oauth2/token', {}), { code: 'http-500' })
    await assert.rejects(io.form('https://account.minimax.cn/oauth2/token', {}))
  } finally { await io.close() }
})
test('MiniMax switch participates in schedule, deduplication, and old settings remain unchanged', async t => {
  const f = await fixture(t)
  let count = 0
  const runner = new Runner({ ...f.config, providers: ['minimax'], time: '00:00' }, { transport: {}, minimax: f.manager, readers: { minimax: async () => ({ key: 'demo' }) }, checkers: { minimax: async () => { count++; return { status: 'claimed', credits: 400 } } } })
  t.after(() => runner.dispose())
  await runner.run(); await runner.run(); assert.equal(count, 1)
  await runner.updateSettings({ providers: ['trae', 'workbuddy'], time: '10:00' })
  const saved = JSON.parse(await readFile(join(f.dir, 'settings.json'), 'utf8'))
  assert.deepEqual(saved.providers, ['trae', 'workbuddy']); assert.equal(saved.time, '10:00')
  await runner.updateSettings({ providers: [] }); assert.equal((await runner.run({ manual: true })).status, 'no-providers')
})
