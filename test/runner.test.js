import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Runner } from '../src/runner.js'
import { Store } from '../src/store.js'
import { normalizeConfig, localClock, checkinDay } from '../src/config.js'
import { CheckinError } from '../src/errors.js'

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-checkin-test-'))
  let now = new Date('2026-10-16T03:05:00Z'), account = 'one', calls = 0, qoderCalls = 0
  const runner = new Runner({ dataDir: dir, providers: ['trae'], ...options.config }, {
    now: () => now, transport: {}, readers: { trae: async () => ({ key: account }), workbuddy: async () => ({ key: 'wb' }), qoder: async () => ({ key: account }) },
    checkers: { trae: async () => { calls++; return options.checker ? options.checker() : { status: 'claimed', credits: 100 } }, workbuddy: async () => ({ status: 'already-claimed' }), qoder: async () => { qoderCalls++; return { status: 'claimed', credits: 100 } } },
  })
  t.after(async () => { await runner.dispose(); await rm(dir, { recursive: true, force: true }) })
  return { runner, dir, setTime: value => { now = new Date(value) }, setAccount: value => { account = value }, calls: () => calls, qoderCalls: () => qoderCalls }
}
test('timezone and schedule use Beijing day independently of host timezone', () => {
  assert.deepEqual(localClock(new Date('2026-10-15T16:00:00Z'), 'Asia/Shanghai'), { day: '2026-10-16', time: '00:00' })
  assert.throws(() => normalizeConfig({ time: '24:00' }))
  assert.throws(() => normalizeConfig({ timezone: 'bad/timezone' }))
  assert.throws(() => normalizeConfig({ providers: ['other'] }))
})
test('wait before scheduled time, catch up after startup, skip persisted success, reset next day', async t => {
  const f = await fixture(t)
  f.setTime('2026-10-16T00:59:00Z'); assert.equal((await f.runner.run()).status, 'not-due'); assert.equal(f.calls(), 0)
  f.setTime('2026-10-16T05:00:00Z'); await f.runner.run(); await f.runner.run(); assert.equal(f.calls(), 1)
  f.setTime('2026-10-17T03:05:00Z'); await f.runner.run(); assert.equal(f.calls(), 2)
  assert.equal((await stat(join(f.dir, 'state.json'))).mode & 0o777, 0o600)
})
test('manual trigger works before scheduled time; account switching isolates daily records', async t => {
  const f = await fixture(t)
  f.setTime('2026-10-16T00:00:00Z'); await f.runner.run({ manual: true })
  f.setAccount('two'); await f.runner.run({ manual: true }); assert.equal(f.calls(), 2)
  f.setAccount('one'); assert.equal((await f.runner.run({ manual: true })).results.trae.cached, true)
})
test('network retry uses 5m / 30m / 2h delays and stops after four attempts', async t => {
  const f = await fixture(t, { checker: () => { throw new CheckinError('network', '网络失败', true) } })
  await f.runner.run(); await f.runner.run(); assert.equal(f.calls(), 1)
  f.setTime('2026-10-16T03:10:00Z'); await f.runner.run(); assert.equal(f.calls(), 2)
  f.setTime('2026-10-16T03:40:00Z'); await f.runner.run(); assert.equal(f.calls(), 3)
  f.setTime('2026-10-16T05:40:00Z'); await f.runner.run(); assert.equal(f.calls(), 4)
  f.setTime('2026-10-16T11:00:00Z'); await f.runner.run(); assert.equal(f.calls(), 4)
})
test('auth/business failures do not loop, manual retry remains available', async t => {
  const f = await fixture(t, { checker: () => { throw new CheckinError('auth', '重新登录') } })
  await f.runner.run(); f.setTime('2026-10-16T08:00:00Z'); await f.runner.run(); assert.equal(f.calls(), 1)
  await f.runner.run({ manual: true }); assert.equal(f.calls(), 2)
})
test('provider failure does not block the other provider', async t => {
  const f = await fixture(t, { config: { providers: ['trae', 'workbuddy'] }, checker: () => { throw new Error('SECRET') } })
  const result = await f.runner.run()
  assert.equal(result.results.workbuddy.status, 'already-claimed')
  assert.ok(!JSON.stringify(await f.runner.status()).includes('SECRET'))
})
test('shared disk lock prevents overlapping CLI and scheduled attempts', async t => {
  let release
  const wait = new Promise(resolve => { release = resolve })
  const f = await fixture(t, { checker: async () => { await wait; return { status: 'claimed' } } })
  const unlock = await f.runner.store.lock()
  assert.equal((await f.runner.run()).status, 'busy')
  await unlock()
  const first = f.runner.run()
  // Wait until the checker has acquired the lock, without relying on a timing delay.
  while (f.calls() === 0) await new Promise(resolve => setImmediate(resolve))
  assert.equal((await f.runner.run()).status, 'busy')
  release(); await first; assert.equal(f.calls(), 1)
})
test('corrupt state fails closed; status is read-only', async t => {
  const f = await fixture(t)
  await writeFile(join(f.dir, 'state.json'), '{bad json')
  await assert.rejects(f.runner.run(), { code: 'state-invalid' }); assert.equal(f.calls(), 0)
})
test('store recovers a lock abandoned by a dead process', async t => {
  const f = await fixture(t)
  await writeFile(join(f.dir, 'run.lock'), JSON.stringify({ pid: 2147483647 }))
  const store = new Store(f.dir), release = await store.lock()
  assert.equal(typeof release, 'function'); await release()
})
test('saved master switch pauses automatic requests but permits manual check-in', async t => {
  const f = await fixture(t)
  await f.runner.updateSettings({ enabled: false })
  assert.equal((await f.runner.run()).status, 'paused'); assert.equal(f.calls(), 0)
  await f.runner.run({ manual: true }); assert.equal(f.calls(), 1)
  assert.equal((await f.runner.status()).schedule.enabled, false)
})
test('platform switches allow disabling both platforms and apply to manual runs', async t => {
  const f = await fixture(t, { config: { providers: ['trae', 'workbuddy'] } })
  await f.runner.updateSettings({ providers: ['workbuddy'] })
  const result = await f.runner.run({ manual: true })
  assert.equal(f.calls(), 0); assert.equal(result.results.trae, undefined)
  assert.equal(result.results.workbuddy.status, 'already-claimed')
  await f.runner.updateSettings({ providers: [] })
  assert.equal((await f.runner.run({ manual: true })).status, 'no-providers')
})
test('saved time changes scheduler immediately and survives a new instance', async t => {
  const f = await fixture(t)
  await f.runner.updateSettings({ time: '12:00', enabled: false, providers: ['workbuddy'] })
  const another = new Runner({ dataDir: f.dir }, { transport: {} })
  try {
    assert.deepEqual((await another.status()).schedule, { time: '12:00', timezone: 'Asia/Shanghai', enabled: false, providers: ['workbuddy'] })
  } finally { await another.dispose() }
  await f.runner.updateSettings({ enabled: true, providers: ['trae'] })
  assert.equal((await f.runner.run()).status, 'not-due')
  f.setTime('2026-10-16T04:00:00Z'); await f.runner.run(); assert.equal(f.calls(), 1)
})
test('settings API cannot change credential files and invalid values preserve previous settings', async t => {
  const f = await fixture(t)
  await f.runner.updateSettings({ time: '10:30' })
  for (const patch of [{ time: '25:00' }, { enabled: 'false' }, { providers: ['unknown'] }, { workbuddyAuth: '/secret' }, { timezone: null }]) {
    await assert.rejects(f.runner.updateSettings(patch), { code: 'settings-input' })
  }
  assert.equal((await f.runner.status()).schedule.time, '10:30')
  await writeFile(join(f.dir, 'settings.json'), '{bad json')
  await assert.rejects(f.runner.run(), { code: 'settings-invalid' }); assert.equal(f.calls(), 0)
})
test('Qoder automatic check-in waits for 10:00 without delaying the other providers', async t => {
  const f = await fixture(t, { config: { providers: ['trae', 'qoder'], time: '09:00' } })
  f.setTime('2026-10-16T01:05:00Z')
  const before = await f.runner.run()
  assert.equal(before.results.qoder.status, 'not-due'); assert.equal(f.calls(), 1); assert.equal(f.qoderCalls(), 0)
  f.setTime('2026-10-16T02:00:00Z'); await f.runner.run()
  assert.equal(f.qoderCalls(), 1); assert.equal(f.calls(), 1)
})
test('Qoder manual claim before 10:00 cannot suppress the new round after 10:00', async t => {
  const f = await fixture(t, { config: { providers: ['qoder'], time: '09:00' } })
  f.setTime('2026-10-16T01:05:00Z')
  const before = await f.runner.run({ manual: true })
  assert.equal(before.results.qoder.day, '2026-10-15')
  await f.runner.run({ manual: true }); assert.equal(f.qoderCalls(), 1)
  f.setTime('2026-10-16T02:00:00Z'); const after = await f.runner.run()
  assert.equal(after.results.qoder.day, '2026-10-16'); assert.equal(f.qoderCalls(), 2)
  f.setTime('2026-10-17T01:30:00Z'); await f.runner.run({ manual: true }); assert.equal(f.qoderCalls(), 2)
})
test('Qoder respects a later user schedule and its Beijing round across other timezones', async t => {
  const f = await fixture(t, { config: { providers: ['qoder'], time: '11:00' } })
  f.setTime('2026-10-16T02:00:00Z'); assert.equal((await f.runner.run()).status, 'not-due')
  f.setTime('2026-10-16T03:00:00Z'); await f.runner.run(); assert.equal(f.qoderCalls(), 1)
  assert.equal(checkinDay('qoder', new Date('2026-10-16T01:59:59Z'), 'America/New_York'), '2026-10-15')
  assert.equal(checkinDay('qoder', new Date('2026-10-16T02:00:00Z'), 'America/New_York'), '2026-10-16')
})

test('manual retry rechecks unavailable activity and automatic retry respects backoff', async t => {
  let ready = false
  const f = await fixture(t, { checker: () => ready ? { status: 'claimed', credits: 100 } : { status: 'unavailable', retryable: true } })
  await f.runner.run(); await f.runner.run(); assert.equal(f.calls(), 1)
  ready = true
  await f.runner.run({ manual: true }); assert.equal(f.calls(), 2)
  await f.runner.run(); assert.equal(f.calls(), 2)
})
