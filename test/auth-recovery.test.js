import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiniMaxAuth } from '../src/minimax.js'
import { QoderAuth, QODER_DESKTOP_CLIENT } from '../src/qoder.js'
import { CheckinError } from '../src/errors.js'
import { Runner } from '../src/runner.js'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const grant = token => ({ access_token: token, refresh_token: 'mock-rotated-refresh', scope: 'agent.default', token_type: 'Bearer', expires_in: 3600 })
const qoderGrant = { device_token: 'mock-refreshed-token', refresh_token: 'mock-rotated-refresh', expires_in: 3600 }
async function sandbox(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-auth-recovery-')), managers = []
  t.after(async () => {
    await Promise.all(managers.map(manager => manager.dispose()))
    await rm(dataDir, { recursive: true, force: true })
  })
  return { dataDir, keep: manager => { managers.push(manager); return manager } }
}

for (const phase of ['refresh', 'identity']) {
  test(`MiniMax login wins over an old session blocked in ${phase}`, async t => {
    const f = await sandbox(t), entered = deferred(), release = deferred()
    const path = join(f.dataDir, 'minimax-auth.json')
    await writeFile(path, JSON.stringify({ accessToken: 'mock-old-A', refreshToken: 'mock-refresh-A', realUserID: 'mock-account-A', expiresAtMs: 1 }))
    const auth = f.keep(new MiniMaxAuth({ dataDir: f.dataDir }, {
      form: async (url, values) => {
        if (values.grant_type === 'refresh_token') {
          if (phase === 'refresh') { entered.resolve(); await release.promise }
          return grant('mock-new-A')
        }
        if (url.endsWith('/device/code')) return { device_code: 'mock-device', user_code: 'MOCK', verification_uri: 'https://account.minimax.cn/activate', expires_in: 600 }
        return grant('mock-token-B')
      },
      get: async (_url, headers) => {
        const isA = headers.Authorization === 'Bearer mock-new-A'
        if (isA && phase === 'identity') { entered.resolve(); await release.promise }
        return { data: { userInfo: { realUserID: isA ? 'mock-account-A' : 'mock-account-B' } } }
      },
    }))
    t.after(() => release.resolve())
    const oldRead = assert.rejects(auth.credential(), { code: 'account-changed' })
    await entered.promise
    await auth.start(); await auth.poll()
    assert.equal(JSON.parse(await readFile(path, 'utf8')).realUserID, 'mock-account-B')
    release.resolve(); await oldRead
    assert.equal(JSON.parse(await readFile(path, 'utf8')).realUserID, 'mock-account-B')
    assert.equal((await auth.credential()).realUserID, 'mock-account-B')
  })
}

for (const provider of ['qoder', 'qoder-global', 'minimax']) {
  test(`${provider} recovers a rotated token after identity failure and restart`, async t => {
    const f = await sandbox(t), minimax = provider === 'minimax', region = provider === 'qoder-global' ? 'global' : 'cn'
    const path = join(f.dataDir, `${provider === 'qoder' ? 'qoder' : provider}-auth.json`)
    const initial = minimax ? { accessToken: 'mock-old', realUserID: 'mock-user' } : { token: 'mock-old', uid: 'mock-user', clientId: QODER_DESKTOP_CLIENT }
    await writeFile(path, JSON.stringify({ ...initial, region, refreshToken: 'mock-initial-refresh', expiresAtMs: 1 }))
    let refreshes = 0, identities = 0
    const refresh = async values => {
      assert.equal(values.refresh_token, 'mock-initial-refresh')
      assert.equal(++refreshes, 1, 'a revoked refresh token must never be reused')
      return minimax ? grant('mock-refreshed-token') : qoderGrant
    }
    const io = {
      form: async (_url, values) => refresh(values),
      post: async (_url, _headers, values) => refresh(values),
      get: async () => {
        if (++identities === 1) throw new CheckinError('network', 'Mock identity timeout', true)
        return minimax ? { data: { userInfo: { realUserID: 'mock-user' } } } : { id: 'mock-user' }
      },
    }
    const create = () => f.keep(minimax ? new MiniMaxAuth({ dataDir: f.dataDir }, io) : new QoderAuth({ dataDir: f.dataDir }, io, { region }))
    const first = create()
    await assert.rejects(first.credential(), { code: 'network' })
    const pending = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(pending.refreshToken, 'mock-rotated-refresh')
    assert.equal(pending.identityPending, true)
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    await first.dispose()
    const recovered = await create().credential()
    assert.equal(minimax ? recovered.accessToken : recovered.token, 'mock-refreshed-token')
    assert.equal(refreshes, 1); assert.equal(identities, 2)
    assert.equal(JSON.parse(await readFile(path, 'utf8')).identityPending, false)
  })

  test(`${provider} credential network failures obey persistent backoff and allow re-login`, async t => {
    const f = await sandbox(t), minimax = provider === 'minimax', region = provider === 'qoder-global' ? 'global' : 'cn'
    const path = join(f.dataDir, `${provider}-auth.json`)
    const initial = minimax ? { accessToken: 'mock-old' } : { token: 'mock-old', uid: 'mock-user', clientId: QODER_DESKTOP_CLIENT }
    await writeFile(path, JSON.stringify({ ...initial, region, refreshToken: 'mock-initial-refresh', expiresAtMs: 1 }))
    const base = Date.parse('2026-10-24T03:00:00Z')
    let now = base, identities = 0, refreshes = 0
    const io = {
      form: async () => { refreshes++; return grant('mock-refreshed-token') },
      post: async () => { refreshes++; return qoderGrant },
      get: async () => { identities++; throw new CheckinError('network', 'Mock identity timeout', true) },
      close: async () => {},
    }
    const create = () => f.keep(new Runner({ dataDir: f.dataDir, providers: [provider], time: '00:00' }, { transport: io, now: () => new Date(now) }))
    let runner = create()
    await runner.run(); assert.equal(identities, 1); assert.equal(refreshes, 1)
    now = base + 60000
    await runner.run(); assert.equal(identities, 1)
    await runner.dispose(); runner = create()
    await runner.run(); assert.equal(identities, 1, 'restart must preserve the credential backoff')
    for (const [minutes, expected] of [[5, 2], [6, 2], [35, 3], [36, 3], [155, 4], [200, 4]]) {
      now = base + minutes * 60000
      await runner.run(); assert.equal(identities, expected)
    }
    assert.equal(refreshes, 1, 'rotation must not reset the retry budget')
    await runner.run({ manual: true }); assert.equal(identities, 5)
    await runner.run(); assert.equal(identities, 5)
    // Replacing the local grant represents a fresh explicit login, which must
    // not be blocked by the previous grant's errors, even on the same day.
    await writeFile(path, JSON.stringify({ ...initial, ...(minimax ? { accessToken: 'mock-relogin' } : { token: 'mock-relogin' }), region }))
    await runner.run(); assert.equal(identities, 6)
    now = base + 86400000
    await runner.run(); assert.equal(identities, 7)
  })
}

for (const region of ['cn', 'global']) {
  test(`Qoder ${region} external refresh survives restart without modifying its source`, async t => {
    const f = await sandbox(t), provider = region === 'cn' ? 'qoder' : 'qoder-global', path = join(f.dataDir, 'external.json')
    const original = JSON.stringify({ token: 'mock-external-old', uid: 'mock-user', region, refreshToken: 'mock-initial-refresh', expiresAtMs: 1 })
    await writeFile(path, original)
    const config = { dataDir: f.dataDir, [region === 'cn' ? 'qoderCredentialFile' : 'qoderGlobalCredentialFile']: path }
    let refreshes = 0
    const io = {
      post: async () => { assert.equal(++refreshes, 1); return qoderGrant },
      get: async (_url, headers) => ({ id: headers.Authorization === 'Bearer mock-replacement' ? 'mock-other-user' : 'mock-user' }),
    }
    const create = () => f.keep(new QoderAuth(config, io, { region }))
    const first = create(), oldKey = (await first.credential()).key
    assert.equal((await first.credential()).token, 'mock-refreshed-token')
    assert.equal(await readFile(path, 'utf8'), original)
    const recovery = join(f.dataDir, `${provider}-refresh.json`)
    assert.equal((await stat(recovery)).mode & 0o777, 0o600)
    assert.ok(!(await readFile(recovery, 'utf8')).includes(path))
    await first.dispose()
    const second = create()
    assert.equal((await second.credential()).token, 'mock-refreshed-token')
    assert.equal(refreshes, 1)
    await writeFile(path, JSON.stringify({ token: 'mock-replacement', uid: 'mock-other-user', region }))
    const replaced = await second.credential()
    assert.equal(replaced.token, 'mock-replacement'); assert.notEqual(replaced.key, oldKey)
  })
}

test('pending rotated grants never bypass identity validation', async t => {
  const f = await sandbox(t)
  await writeFile(join(f.dataDir, 'minimax-auth.json'), JSON.stringify({ accessToken: 'mock-pending', realUserID: 'unverified-local-user', identityPending: true }))
  const minimax = f.keep(new MiniMaxAuth({ dataDir: f.dataDir }, { get: async () => ({ data: {} }) }))
  await assert.rejects(minimax.credential(), { code: 'identity-missing' })
  await writeFile(join(f.dataDir, 'qoder-auth.json'), JSON.stringify({ token: 'mock-pending', uid: 'mock-expected', clientId: QODER_DESKTOP_CLIENT, identityPending: true }))
  const qoder = f.keep(new QoderAuth({ dataDir: f.dataDir }, { get: async () => ({ id: 'mock-other' }) }))
  await assert.rejects(qoder.credential(), { code: 'account-changed' })
})

for (const provider of ['qoder', 'minimax']) {
  test(`${provider} shares the four-attempt budget across credential and claim failures`, async t => {
    const f = await sandbox(t), minimax = provider === 'minimax', path = join(f.dataDir, `${provider}-auth.json`)
    const initial = minimax ? { accessToken: 'mock-old' } : { token: 'mock-old', uid: 'mock-user', clientId: QODER_DESKTOP_CLIENT }
    await writeFile(path, JSON.stringify({ ...initial, refreshToken: 'mock-refresh', expiresAtMs: 1 }))
    const base = Date.parse('2026-10-24T03:00:00Z')
    let now = base, identities = 0, claims = 0, refreshes = 0
    const io = {
      form: async () => { refreshes++; return grant('mock-refreshed-token') },
      post: async () => { refreshes++; return qoderGrant },
      get: async () => {
        if (++identities <= 2) throw new CheckinError('network', 'Mock identity timeout', true)
        return minimax ? { data: { userInfo: { realUserID: 'mock-user' } } } : { id: 'mock-user' }
      },
      close: async () => {},
    }
    const runner = f.keep(new Runner({ dataDir: f.dataDir, providers: [provider], time: '00:00' }, {
      now: () => new Date(now), transport: io,
      checkers: { [provider]: async () => { claims++; throw new CheckinError('network', 'Mock claim timeout', true) } },
    }))
    for (const minutes of [0, 5, 35, 155]) { now = base + minutes * 60000; await runner.run() }
    assert.equal(identities, 3); assert.equal(claims, 2); assert.equal(refreshes, 1)
    const saved = JSON.parse(await readFile(path, 'utf8'))
    await writeFile(path, JSON.stringify({ ...saved, expiresAtMs: 1 }))
    now = base + 200 * 60000
    const result = await runner.run()
    assert.equal(result.results[provider].cached, true)
    assert.equal(result.results[provider].attempts, 4)
    assert.equal(refreshes, 1, 'an exhausted budget must stop credential refresh as well')
    assert.equal(claims, 2)
  })
}
