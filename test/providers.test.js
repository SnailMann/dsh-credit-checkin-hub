import test from 'node:test'
import assert from 'node:assert/strict'
import { MockAgent } from 'undici'
import { createTransport, checkinTrae, checkinWorkBuddy, checkinQoder } from '../src/providers.js'
import { safeError, CheckinError } from '../src/errors.js'

const c = { token: 'test-token', deviceId: '123', reqSource: 1, accessToken: 'wb-token', uid: 'u1' }
const stub = docs => {
  const calls = []
  const request = async (...args) => { calls.push(args); const value = docs.shift(); if (value instanceof Error) throw value; return value }
  return { calls, post: request, get: request }
}
test('Trae uses CN identity and verifies receipt after claim', async () => {
  const t = stub([{ enable: true, checked_in: false, credits: 100, extra_credits: 100 }, { code: 0 }, { checked_in: true }])
  const r = await checkinTrae(c, t)
  assert.equal(r.status, 'claimed'); assert.equal(r.credits, 100)
  assert.equal(r.extraCredits, undefined)
  assert.equal(t.calls.length, 3)
  assert.equal(t.calls[1][0], 'https://api.trae.cn/trae/api/v2/ug/checkin_credits/claim')
  assert.deepEqual(t.calls[1][2], { req_source: 1 })
  assert.equal(t.calls[1][1]['x-device-id'], '123')
})
test('Trae skips already signed accounts and unavailable campaigns', async () => {
  for (const [doc, status] of [[{ enable: true, checked_in: true }, 'already-claimed'], [{ enable: false, checked_in: false }, 'unavailable']]) {
    const t = stub([doc]); assert.equal((await checkinTrae(c, t)).status, status); assert.equal(t.calls.length, 1)
  }
})
test('Trae rejects malformed status before claiming', async () => {
  const t = stub([{}]); await assert.rejects(checkinTrae(c, t), { code: 'protocol' }); assert.equal(t.calls.length, 1)
})
test('Trae does not treat an empty 200 or unconfirmed receipt as success', async () => {
  await assert.rejects(checkinTrae(c, stub([{ enable: true, checked_in: false }, {}, { checked_in: false }])), { code: 'unconfirmed', retryable: true })
})
test('Trae handles another client claiming concurrently', async () => {
  assert.equal((await checkinTrae(c, stub([{ enable: true, checked_in: false }, { code: 9004 }, { checked_in: true }]))).status, 'already-claimed')
})
test('WorkBuddy classifies real 10001 and legacy 1001 already-claimed codes', async () => {
  for (const code of [10001, 1001]) assert.equal((await checkinWorkBuddy(c, stub([{ code }]))).status, 'already-claimed')
})
test('WorkBuddy only confirms explicit credit payload and distinguishes unavailable', async () => {
  assert.equal((await checkinWorkBuddy(c, stub([{ code: 0, data: { credit: 100, streak_days: 3 } }]))).credits, 100)
  for (const code of [1002, 1003]) assert.equal((await checkinWorkBuddy(c, stub([{ code }]))).status, 'unavailable')
  for (const doc of [{}, { code: 0 }, { code: 0, data: {} }]) await assert.rejects(checkinWorkBuddy(c, stub([doc])))
})
test('HTTP transport recognizes WorkBuddy HTTP 400 business response, but rejects server errors', async () => {
  const agent = new MockAgent(); agent.disableNetConnect()
  const pool = agent.get('https://www.codebuddy.cn')
  pool.intercept({ path: '/test', method: 'POST' }).reply(400, { code: 10001, msg: '今天已签到' })
  pool.intercept({ path: '/test', method: 'POST' }).reply(503, { code: 10001 })
  pool.intercept({ path: '/test', method: 'POST' }).reply(401, { token: 'must-never-leak' })
  const t = createTransport({ dispatcher: agent })
  try {
    assert.equal((await t.post('https://www.codebuddy.cn/test', {}, {})).code, 10001)
    await assert.rejects(t.post('https://www.codebuddy.cn/test', {}, {}), { code: 'http-503', retryable: true })
    await assert.rejects(t.post('https://www.codebuddy.cn/test', {}, {}), e => e.code === 'auth-or-verification' && !e.message.includes('must-never-leak'))
    agent.assertNoPendingInterceptors()
  } finally { await t.close() }
})
test('error logs never echo unexpected error bodies or child process secrets', () => {
  assert.ok(!JSON.stringify(safeError(new Error('token=SECRET'))).includes('SECRET'))
  assert.equal(safeError(new CheckinError('network', '网络失败', true)).retryable, true)
})

const campaign = (status = 'CLAIMABLE', id = 'daily-credits') => ({ campaignId: id, actionType: 'CLAIM_BENEFIT', claimStatus: status, benefit: { kind: 'CREDITS', amount: 100 } })
test('Qoder claims through client type 10 and confirms the exact campaign', async () => {
  const t = stub([{ campaigns: [campaign()] }, {}, { campaigns: [campaign('CLAIMED')] }])
  const result = await checkinQoder(c, t)
  assert.equal(result.status, 'claimed'); assert.equal(result.credits, 100)
  assert.equal(t.calls[0][1]['Cosy-ClientType'], '10')
  assert.equal(t.calls[1][0], 'https://openapi.qoder.com.cn/sash/api/v1/me/campaigns/daily-credits/claim')
  assert.equal(t.calls.length, 3)
  const after = { ...campaign('CLAIMED') }; delete after.benefit
  assert.equal((await checkinQoder(c, stub([{ campaigns: [campaign()] }, {}, { campaigns: [after] }]))).status, 'claimed')
})
test('Qoder does not confuse no activity or expired campaigns with already claimed', async () => {
  for (const docs of [[{ campaigns: [] }], [{ showCampaign: true, campaigns: [campaign('EXPIRED')] }], [new CheckinError('http-404', '活动不存在')]]) {
    const t = stub(docs); assert.equal((await checkinQoder(c, t)).status, 'unavailable'); assert.equal(t.calls.length, 1)
  }
  const t = stub([{ campaigns: [campaign('CLAIMED')] }])
  assert.equal((await checkinQoder(c, t)).status, 'already-claimed'); assert.equal(t.calls.length, 1)
})
test('Qoder rejects malformed responses and never treats an empty claim 200 as receipt', async () => {
  await assert.rejects(checkinQoder(c, stub([{}])), { code: 'protocol' })
  await assert.rejects(checkinQoder(c, stub([{ campaigns: [campaign()] }, {}, { campaigns: [] }])), { code: 'unconfirmed' })
  await assert.rejects(checkinQoder(c, stub([{ campaigns: [campaign()] }, {}, { campaigns: [campaign()] }])), { code: 'unconfirmed' })
})
test('Qoder preserves a failed claim unless a follow-up query proves it was claimed concurrently', async () => {
  const error = new CheckinError('http-410', '活动结束')
  await assert.rejects(checkinQoder(c, stub([{ campaigns: [campaign()] }, error, { campaigns: [] }])), { code: 'http-410' })
  assert.equal((await checkinQoder(c, stub([{ campaigns: [campaign()] }, error, { campaigns: [campaign('CLAIMED')] }]))).status, 'already-claimed')
})
test('Qoder only selects credit benefits, avoids ambiguous campaigns and supports wrapped responses', async () => {
  const t = stub([{ campaigns: [{ ...campaign(), actionType: 'OPEN_URL' }] }])
  assert.equal((await checkinQoder(c, t)).status, 'unavailable')
  assert.equal((await checkinQoder(c, stub([{ campaigns: [campaign('CLAIMABLE', 'gift-a'), campaign('CLAIMABLE', 'gift-b')] }]))).status, 'unavailable')
  await assert.rejects(checkinQoder(c, stub([{ campaigns: [campaign('CLAIMABLE', 'daily-a'), campaign('CLAIMABLE', 'daily-b')] }])), { code: 'campaign-ambiguous' })
  assert.equal((await checkinQoder(c, stub([{ code: 0, data: { campaigns: [campaign('CLAIMED')] } }]))).status, 'already-claimed')
})
test('GET transport sends no body or content-type and retains standard error handling', async () => {
  const agent = new MockAgent(); agent.disableNetConnect()
  agent.get('https://openapi.qoder.com.cn').intercept({ path: '/campaigns', method: 'GET' }).reply(200, { campaigns: [] })
  const t = createTransport({ dispatcher: agent })
  try { assert.deepEqual(await t.get('https://openapi.qoder.com.cn/campaigns', {}), { campaigns: [] }); agent.assertNoPendingInterceptors() }
  finally { await t.close() }
})

test('Qoder recognizes daily campaign titles in popup placements and ignores claimed unrelated credit gifts', async () => {
  const daily = { ...campaign('CLAIMABLE', 'opaque-id'), campaignKey: 'act-20260918', placements: [{ type: 'POPUP', content: { zh: { title: '每天领 100 Credits' } } }] }
  const unrelated = campaign('CLAIMED', 'anniversary-gift')
  const io = stub([{ campaigns: [unrelated, daily] }, {}, { campaigns: [unrelated, { ...daily, claimStatus: 'CLAIMED' }] }])
  assert.equal((await checkinQoder(c, io)).status, 'claimed')
  assert.ok(io.calls[1][0].endsWith('/opaque-id/claim'))
  const missing = await checkinQoder(c, stub([{ campaigns: [unrelated] }]))
  assert.equal(missing.status, 'unavailable'); assert.equal(missing.retryable, true)
})
