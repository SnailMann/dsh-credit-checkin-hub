import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readQoder, readQoderSession } from '../src/qoder.js'

test('Qoder JSON credentials recognize user_id, isolate accounts and follow token refresh', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-qoder-credentials-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'session.json'), config = { qoderCredentialFile: path }
  await writeFile(path, JSON.stringify({ token: 'dt-test-first', user_id: 'user-1' }))
  const first = await readQoder(config)
  await writeFile(path, JSON.stringify({ access_token: 'dt-test-refreshed', uid: 'user-1' }))
  const refreshed = await readQoder(config)
  assert.equal(first.key, refreshed.key); assert.equal(refreshed.token, 'dt-test-refreshed')
  await writeFile(path, JSON.stringify({ token: 'dt-test-second', uid: 'user-2' }))
  assert.notEqual((await readQoder(config)).key, first.key)
  await writeFile(path, JSON.stringify({ token: 'dt-test-secret', uid: '' }))
  await assert.rejects(readQoder(config), e => e.code === 'identity-missing' && !e.message.includes('dt-test-secret'))
})
test('default Qoder login never falls back to native desktop auth or Keychain', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-qoder-no-keychain-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await assert.rejects(readQoderSession({ dataDir: dir }), { code: 'signed-out' })
  const path = join(dir, 'legacy.dat')
  await writeFile(path, Buffer.from('v10encrypted-test'))
  await assert.rejects(readQoderSession({ qoderAuth: path }), e => e.code === 'credential-format' && /独立网页登录/.test(e.message))
})
