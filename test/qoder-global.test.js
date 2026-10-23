import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QoderAuth, qoderPath, readQoderGlobal, QODER_DESKTOP_CLIENT } from '../src/qoder.js'
import { qoderSite } from '../src/qoder-sites.js'
import { qoderDeviceIdentity, qoderRuntimePath } from '../src/qoder-device.js'
import { checkinQoderGlobal, createTransport } from '../src/providers.js'
import { normalizeConfig, checkinDay } from '../src/config.js'
import { Runner } from '../src/runner.js'
import { MockAgent } from 'undici'

const proof = { machineToken: 'proof', machineCode: 'code', machineType: 'type' }
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-qoder-regions-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
test('Qoder CN and Global browser logins use separate official hosts, sessions and account keys', async t => {
  const dataDir = await directory(t), managers = [], seen = []
  for (const region of ['cn', 'global']) {
    const site = qoderSite(region)
    const io = { get: async (url, headers) => {
      seen.push(url); assert.equal(new URL(url).origin, site.api)
      if (new URL(url).pathname.endsWith('/poll')) return { token: region + '-access', refresh_token: region + '-refresh', user_id: 'same-uid', expires_in: 3600 }
      assert.equal(headers.Authorization, `Bearer ${region}-access`); return { id: 'same-uid' }
    } }
    const auth = new QoderAuth({ dataDir }, io, { region, deviceIdentity: async () => proof })
    managers.push(auth); t.after(() => auth.dispose())
    const pending = await auth.start(), url = new URL(pending.verificationUrl)
    assert.equal(url.origin, site.site); assert.equal(url.searchParams.get('client_id'), QODER_DESKTOP_CLIENT)
    assert.equal(url.searchParams.get('redirect_uri'), region === 'global' ? 'qoder-app://' : null)
    await auth.poll()
    assert.equal((await auth.status()).connection, 'connected')
    const file = qoderPath({ dataDir }, site), saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.token, region + '-access'); assert.equal(saved.region, region)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    assert.ok(!JSON.stringify(await auth.status()).includes('-access'))
  }
  assert.notEqual((await managers[0].credential()).key, (await managers[1].credential()).key)
  assert.equal(seen.length, 4)
})
test('Global refresh is pinned to global API and leaves CN session unchanged', async t => {
  const dataDir = await directory(t), config = { dataDir }, cnPath = qoderPath(config), globalPath = qoderPath(config, qoderSite('global'))
  const cn = JSON.stringify({ token: 'cn-access', refreshToken: 'cn-refresh', uid: 'cn-id' })
  await writeFile(cnPath, cn)
  await writeFile(globalPath, JSON.stringify({ token: 'global-old', refreshToken: 'global-refresh', uid: 'global-id', machineId: 'global-machine', region: 'global', clientId: QODER_DESKTOP_CLIENT, expiresAtMs: 1 }))
  let refreshed = 0
  const auth = new QoderAuth(config, {
    post: async (url, headers, body) => { refreshed++; assert.equal(url, 'https://openapi.qoder.sh/api/v1/deviceToken/refresh'); assert.deepEqual(body, { refresh_token: 'global-refresh', machine_id: 'global-machine' }); return { device_token: 'global-new', refresh_token: 'global-rotated', expires_in: 3600 } },
    get: async (url, headers) => { assert.equal(url, 'https://openapi.qoder.sh/api/v1/userinfo'); assert.equal(headers.Authorization, 'Bearer global-new'); return { id: 'global-id' } },
  }, { region: 'global' })
  t.after(() => auth.dispose())
  assert.equal((await auth.credential()).token, 'global-new'); assert.equal(refreshed, 1)
  assert.equal(await readFile(cnPath, 'utf8'), cn)
  assert.equal(JSON.parse(await readFile(globalPath, 'utf8')).refreshToken, 'global-rotated')
})
test('Global ignores CN explicit paths and rejects explicitly mismatched region before network requests', async t => {
  const dataDir = await directory(t), cnFile = join(dataDir, 'cn.json')
  await writeFile(cnFile, JSON.stringify({ token: 'cn-secret', uid: 'same-id', region: 'cn' }))
  await assert.rejects(readQoderGlobal({ dataDir, qoderCredentialFile: cnFile }), { code: 'signed-out' })
  let requested = false
  const auth = new QoderAuth({ dataDir, qoderGlobalCredentialFile: cnFile }, { get: async () => { requested = true } }, { region: 'global' })
  t.after(() => auth.dispose())
  await assert.rejects(auth.credential(), { code: 'region-mismatch' }); assert.equal(requested, false)
  await writeFile(cnFile, JSON.stringify({ token: 'unmarked-cn-secret', uid: 'same-id' }))
  await assert.rejects(auth.credential(), { code: 'region-mismatch' }); assert.equal(requested, false)
  assert.throws(() => qoderSite('other'))
})
test('Global device verification uses environment 3 and its own installed official helper', async () => {
  let invoked
  const run = (path, args, options, done) => { invoked = { path, args }; queueMicrotask(() => done(null, JSON.stringify(proof))); return { stdin: { on() {}, end() {} } } }
  assert.deepEqual(await qoderDeviceIdentity('global-account', { qoderRuntime: '/cn/helper', qoderGlobalRuntime: '/global/helper' }, undefined, run, qoderSite('global')), proof)
  assert.deepEqual(invoked, { path: '/global/helper', args: ['3', '--account-stdin'] })
})
test('Global queries, claims and confirms only its exact daily campaign on the global API', async () => {
  const agent = new MockAgent(); agent.disableNetConnect()
  const pool = agent.get('https://openapi.qoder.sh'), path = '/sash/api/v1/me/campaigns'
  const row = { campaignId: 'opaque-round', actionType: 'CLAIM_BENEFIT', claimStatus: 'CLAIMABLE', benefit: { kind: 'CREDITS', amount: 100 }, placements: [{ content: { en: { title: 'Claim 100 Credits Daily' } } }] }
  const headers = { authorization: 'Bearer global-secret', 'cosy-machinetoken': 'proof', 'cosy-machinecode': 'code', 'cosy-machinetype': 'type' }
  pool.intercept({ path, method: 'GET', headers }).reply(200, { campaigns: [row] })
  pool.intercept({ path: path + '/opaque-round/claim', method: 'POST', headers, body: '{}' }).reply(200, {})
  pool.intercept({ path, method: 'GET', headers }).reply(200, { campaigns: [{ ...row, claimStatus: 'CLAIMED' }] })
  const transport = createTransport({ dispatcher: agent })
  try { const r = await checkinQoderGlobal({ token: 'global-secret', getMachineIdentity: async () => proof }, transport); assert.equal(r.status, 'claimed'); assert.equal(r.credits, 100); assert.match(r.message, /国际版/); agent.assertNoPendingInterceptors() }
  finally { await transport.close() }
})
test('Global and CN schedules reset at 10 Beijing time and preserve separate success records', async t => {
  const dataDir = await directory(t); let now = new Date('2026-10-23T01:59:59Z'); const calls = { qoder: 0, 'qoder-global': 0 }
  const runner = new Runner({ dataDir, time: '09:05', providers: ['qoder', 'qoder-global'] }, { now: () => now, transport: {}, readers: Object.fromEntries(Object.keys(calls).map(p => [p, async () => ({ key: 'same-id' })])), checkers: Object.fromEntries(Object.keys(calls).map(p => [p, async () => { calls[p]++; return { status: 'claimed', credits: 100 } }])) })
  t.after(() => runner.dispose())
  const early = await runner.run(); assert.equal(early.results['qoder-global'].status, 'not-due'); assert.deepEqual(calls, { qoder: 0, 'qoder-global': 0 })
  now = new Date('2026-10-23T02:00:00Z'); await runner.run(); await runner.run({ manual: true }); assert.deepEqual(calls, { qoder: 1, 'qoder-global': 1 })
  const state = await runner.status(); assert.equal(state.history.length, 2); assert.equal(Object.keys(state.accounts).length, 2)
  await runner.updateSettings({ providers: ['qoder'] }); now = new Date('2026-10-24T02:00:00Z'); await runner.run(); assert.deepEqual(calls, { qoder: 2, 'qoder-global': 1 })
  assert.equal(checkinDay('qoder-global', new Date('2026-10-23T01:59:59Z'), 'America/New_York'), '2026-10-22')
  assert.equal(checkinDay('qoder-global', new Date('2026-10-23T02:00:00Z'), 'America/New_York'), '2026-10-23')
})
test('Adding Global preserves the old default platforms until explicitly enabled', () => {
  assert.deepEqual(normalizeConfig().providers, ['trae', 'workbuddy', 'qoder', 'minimax'])
  assert.deepEqual(normalizeConfig({ providers: ['qoder-global'] }).providers, ['qoder-global'])
})

test('Global runtime selection prefers its installed app, then its own cached official helper', () => {
  const config = { dataDir: '/plugin/data' }, site = qoderSite('global'), cache = '/plugin/data/runtimes/qoder-global/runtime-info'
  assert.equal(qoderRuntimePath(config, site, path => path === cache), cache)
  assert.equal(qoderRuntimePath(config, site, () => true), site.runtime)
  assert.equal(qoderRuntimePath(config, site, () => false), site.runtime)
  assert.equal(qoderRuntimePath({ ...config, qoderRuntime: '/cn/helper' }, site, () => false), site.runtime)
  assert.equal(qoderRuntimePath({ ...config, qoderGlobalRuntime: '/explicit/global' }, site, () => true), '/explicit/global')
  assert.equal(qoderRuntimePath(config, qoderSite(), path => path === cache), qoderSite().runtime)
})
test('Official SDK connection timeout produces a safe actionable retryable error', async () => {
  const run = (path, args, options, done) => { queueMicrotask(() => done({ code: 1 }, '', 'sgsdk init callback timed out after 20s SECRET')); return { stdin: { on() {}, end() {} } } }
  await assert.rejects(qoderDeviceIdentity('account', { qoderGlobalRuntime: '/official/global' }, undefined, run, qoderSite('global')), e => e.code === 'qoder-device-network' && e.retryable === true && /代理/.test(e.message) && !e.message.includes('SECRET'))
})
