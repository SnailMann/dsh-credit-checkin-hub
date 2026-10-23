import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { QoderAuth, QODER_DESKTOP_CLIENT } from '../src/qoder.js'
import { CheckinError } from '../src/errors.js'
import { checkinQoder } from '../src/providers.js'

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-qoder-auth-')), calls = []
  let now = Date.now(), polls = 0, identities = 0
  const io = {
    get: async (url, headers, signal) => {
      calls.push({ method: 'GET', url, headers })
      const path = new URL(url).pathname
      if (path.endsWith('/poll')) {
        if (options.poll) return options.poll(polls++, signal)
        return { token: 'mock-device-token', refresh_token: 'mock-refresh', user_id: 'mock-user', expires_at: new Date(now + 3600000).toISOString() }
      }
      if (path.endsWith('/userinfo')) { identities++; return options.identity ?? { id: 'mock-user' } }
      throw Error('unexpected test URL')
    },
    post: async (url, headers, body) => { calls.push({ method: 'POST', url, headers, body }); return options.refresh ?? { device_token: 'refreshed-token', refresh_token: 'rotated-refresh', expires_at: new Date(now + 3600000).toISOString() } },
  }
  const config = { dataDir: dir, ...options.config }, manager = new QoderAuth(config, io, { now: () => now, deviceIdentity: options.deviceIdentity ?? (async () => ({ machineToken: 'mock-device-proof', machineCode: 'mock-device-code', machineType: 'mock-device-type' })) })
  t.after(async () => { await manager.dispose(); await rm(dir, { recursive: true, force: true }) })
  return { dir, config, manager, calls, advance: ms => { now += ms }, identities: () => identities }
}
test('Qoder independent login uses official CN device flow with PKCE and no local native credentials', async t => {
  const f = await fixture(t), state = await f.manager.start(), u = new URL(state.verificationUrl)
  assert.equal(u.origin, 'https://qoder.cn'); assert.equal(u.pathname, '/device/selectAccounts')
  assert.equal(u.searchParams.get('challenge_method'), 'S256')
  assert.equal(u.searchParams.get('client_id'), '732aef47-9cf2-46a2-95fe-4cebb5d0d1fa')
  assert.equal(state.connection, 'signed-out'); assert.equal(state.status, 'pending'); assert.equal(f.calls.length, 0)
  assert.ok(!JSON.stringify(state).includes('verifier'))
  await f.manager.poll()
  const request = new URL(f.calls[0].url)
  const expected = createHash('sha256').update(request.searchParams.get('verifier')).digest('base64url')
  assert.equal(u.searchParams.get('challenge'), expected)
  assert.equal(request.origin, 'https://openapi.qoder.com.cn')
  assert.equal(request.searchParams.get('nonce'), u.searchParams.get('nonce'))
  assert.equal(f.calls[0].headers.Authorization, undefined)
  assert.equal(f.calls[1].headers.Authorization, 'Bearer mock-device-token')
  assert.equal((await f.manager.status()).connection, 'connected')
  assert.ok(!JSON.stringify(await f.manager.status()).includes('mock-device-token'))
  const path = join(f.dir, 'qoder-auth.json')
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.equal(JSON.parse(await readFile(path, 'utf8')).uid, 'mock-user')
})
test('Qoder polling 404 waits; expired links, cancel and rejected auth do not save credentials', async t => {
  const f = await fixture(t, { poll: async () => { throw new CheckinError('http-404', 'not ready') } })
  await f.manager.start(); await f.manager.poll(); assert.equal((await f.manager.status()).status, 'pending')
  f.advance(300001); await f.manager.poll(); assert.equal((await f.manager.status()).status, 'failed')
  assert.match((await f.manager.status()).message, /过期/)
  await f.manager.start(); await f.manager.cancel(); await f.manager.poll(); assert.equal((await f.manager.status()).status, 'idle')
  await assert.rejects(readFile(join(f.dir, 'qoder-auth.json')))
  const g = await fixture(t, { poll: async () => { throw new CheckinError('auth-or-verification', '拒绝登录') } })
  await g.manager.start(); await g.manager.poll(); assert.equal((await g.manager.status()).status, 'failed')
})
test('Qoder refuses missing server identity, account mismatch and malformed grants', async t => {
  for (const options of [{ identity: {} }, { identity: { id: 'other-user' } }, { poll: async () => ({ success: true }) }]) {
    const f = await fixture(t, options)
    await f.manager.start(); await f.manager.poll()
    assert.equal((await f.manager.status()).status, 'failed')
    await assert.rejects(readFile(join(f.dir, 'qoder-auth.json')))
  }
})
test('Qoder resolves absent local account ID from official userinfo and verifies once per token', async t => {
  const f = await fixture(t)
  await writeFile(join(f.dir, 'qoder-auth.json'), JSON.stringify({ token: 'existing-token', clientId: QODER_DESKTOP_CLIENT }))
  const a = await f.manager.credential(), b = await f.manager.credential()
  assert.equal(a.key, b.key); assert.equal(f.identities(), 1)
  assert.equal(JSON.parse(await readFile(join(f.dir, 'qoder-auth.json'), 'utf8')).uid, 'mock-user')
  await writeFile(join(f.dir, 'qoder-auth.json'), JSON.stringify({ token: 'other-token', user_id: 'other-user', clientId: QODER_DESKTOP_CLIENT }))
  await assert.rejects(f.manager.credential(), { code: 'account-changed' })
})
test('Qoder automatically refreshes device tokens with same machine identity and serializes refresh', async t => {
  const f = await fixture(t)
  await writeFile(join(f.dir, 'qoder-auth.json'), JSON.stringify({ token: 'old-token', clientId: QODER_DESKTOP_CLIENT, uid: 'mock-user', refreshToken: 'old-refresh', machineId: 'machine-1', expiresAtMs: 1 }))
  const [a, b] = await Promise.all([f.manager.credential(), f.manager.credential()])
  assert.equal(a.token, 'refreshed-token'); assert.deepEqual(a, b)
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
  assert.deepEqual(f.calls[0].body, { refresh_token: 'old-refresh', machine_id: 'machine-1' })
  const saved = JSON.parse(await readFile(join(f.dir, 'qoder-auth.json'), 'utf8'))
  assert.equal(saved.refreshToken, 'rotated-refresh'); assert.equal(saved.machineId, 'machine-1')
})
test('Qoder browser token flows through campaigns and only exact claimed campaign confirms receipt', async t => {
  const f = await fixture(t)
  await f.manager.start(); await f.manager.poll()
  const c = await f.manager.credential()
  const row = { campaignId: 'daily-credits', actionType: 'CLAIM_BENEFIT', claimStatus: 'CLAIMABLE', benefit: { kind: 'CREDITS', amount: 100 } }
  let claimed = false
  const transport = {
    get: async (url, headers) => { assert.equal(headers.Authorization, 'Bearer mock-device-token'); return { campaigns: [{ ...row, claimStatus: claimed ? 'CLAIMED' : 'CLAIMABLE' }] } },
    post: async (url, headers) => { assert.ok(url.endsWith('/daily-credits/claim')); claimed = true; return {} },
  }
  assert.equal((await checkinQoder(c, transport)).credits, 100)
})
test('Qoder cancellation/disposal prevents late login responses from saving tokens', async t => {
  let release
  const f = await fixture(t, { poll: () => new Promise(resolve => { release = resolve }) })
  await f.manager.start(); const pending = f.manager.poll()
  await f.manager.cancel(); release({ token: 'late-token', user_id: 'mock-user' }); await pending
  assert.equal((await f.manager.status()).connection, 'signed-out')
  await assert.rejects(readFile(join(f.dir, 'qoder-auth.json')))
})

test('Qoder flags legacy CLI login and requires desktop browser login without reusing native credentials', async t => {
  const f = await fixture(t)
  await writeFile(join(f.dir, 'qoder-auth.json'), JSON.stringify({ token: 'cli-token', uid: 'mock-user' }))
  assert.equal((await f.manager.status()).connection, 'upgrade-required')
  await assert.rejects(f.manager.credential(), { code: 'qoder-login-upgrade' })
  assert.equal(f.calls.length, 0)
})

test('Qoder device proof stays in memory, expires and is isolated by verified account', async t => {
  const accounts = []
  const f = await fixture(t, { deviceIdentity: async uid => { accounts.push(uid); return { machineToken: 'proof-' + accounts.length, machineCode: 'code', machineType: 'type' } } })
  await f.manager.start(); await f.manager.poll()
  const c = await f.manager.credential()
  assert.equal((await c.getMachineIdentity()).machineToken, 'proof-1')
  assert.equal((await c.getMachineIdentity()).machineToken, 'proof-1')
  f.advance(50 * 60000 + 1)
  assert.equal((await c.getMachineIdentity()).machineToken, 'proof-2')
  assert.equal((await f.manager.getMachineIdentity('another-account')).machineToken, 'proof-3')
  assert.deepEqual(accounts, ['mock-user', 'mock-user', 'another-account'])
  assert.ok(!(await readFile(join(f.dir, 'qoder-auth.json'), 'utf8')).includes('proof-'))
})
