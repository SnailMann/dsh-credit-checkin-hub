import test from 'node:test'
import assert from 'node:assert/strict'
import { qoderDeviceIdentity } from '../src/qoder-device.js'
import { checkinQoder } from '../src/providers.js'
import { safeError } from '../src/errors.js'

const proof = { machineToken: 'official-token', machineCode: 'official-code', machineType: 'official-type' }
function helper(output = JSON.stringify(proof), error) {
  const calls = []
  const run = (path, args, options, done) => {
    const call = { path, args, options }; calls.push(call)
    queueMicrotask(() => done(error, output))
    return { stdin: { on() {}, end(value) { call.input = value } } }
  }
  return { calls, run }
}
test('Qoder uses the installed official CN helper with account on stdin and bounded execution', async () => {
  const io = helper(JSON.stringify({ ...proof, vmInfo: 'not-retained', accountOutcome: 'not-retained' }))
  assert.deepEqual(await qoderDeviceIdentity('verified-account', { qoderRuntime: '/official/runtime-info' }, undefined, io.run), proof)
  const call = io.calls[0]
  assert.equal(call.path, '/official/runtime-info'); assert.deepEqual(call.args, ['0', '--account-stdin'])
  assert.deepEqual(JSON.parse(call.input), { account: 'verified-account' })
  assert.equal(call.options.timeout, 25000); assert.equal(call.options.killSignal, 'SIGKILL'); assert.equal(call.options.maxBuffer, 65536)
  assert.ok(!call.args.includes('verified-account'))
})
test('Qoder device errors do not leak helper output and cancellation avoids spawning', async () => {
  for (const [error, code] of [[{ code: 'ENOENT' }, 'qoder-device-missing'], [{ killed: true, message: 'SECRET' }, 'qoder-device-failed']]) {
    const io = helper('SECRET', error)
    await assert.rejects(qoderDeviceIdentity('account', { qoderRuntime: '/official/runtime-info' }, undefined, io.run), e => e.code === code && !JSON.stringify(safeError(e)).includes('SECRET'))
  }
  const controller = new AbortController(); controller.abort(); const io = helper()
  await assert.rejects(qoderDeviceIdentity('account', {}, controller.signal, io.run), { code: 'cancelled' })
  assert.equal(io.calls.length, 0)
})
test('Qoder rejects missing or unsafe device fields before any campaign request', async () => {
  for (const doc of ['SECRET', '{}', JSON.stringify({ ...proof, machineCode: 'bad\nheader' }), JSON.stringify({ ...proof, machineToken: 'x'.repeat(4097) })]) {
    await assert.rejects(qoderDeviceIdentity('account', { qoderRuntime: '/official/runtime-info' }, undefined, helper(doc).run), { code: 'qoder-device-invalid' })
  }
})
test('Qoder sends official device proof on query, claim and receipt query without substituting machine ID', async () => {
  const calls = [], row = { campaignId: 'daily-100', actionType: 'CLAIM_BENEFIT', claimStatus: 'CLAIMABLE', benefit: { kind: 'CREDITS', amount: 100 } }
  let claimed = false, generated = 0
  const check = headers => { calls.push(headers); assert.equal(headers['Cosy-MachineToken'], proof.machineToken); assert.equal(headers['Cosy-MachineCode'], proof.machineCode); assert.equal(headers['Cosy-MachineType'], proof.machineType); assert.equal(headers['Cosy-MachineId'], 'login-machine') }
  const result = await checkinQoder({ token: 'access', machineId: 'login-machine', getMachineIdentity: async () => { generated++; return proof } }, {
    get: async (url, headers) => { check(headers); return { campaigns: [{ ...row, claimStatus: claimed ? 'CLAIMED' : 'CLAIMABLE' }] } },
    post: async (url, headers) => { check(headers); claimed = true; return {} },
  })
  assert.equal(result.status, 'claimed'); assert.equal(result.credits, 100); assert.equal(calls.length, 3); assert.equal(generated, 1)
})

test('Qoder stops before querying campaigns when official device verification fails', async () => {
  let queried = false
  await assert.rejects(checkinQoder({ token: 'access', getMachineIdentity: async () => { throw Error('device unavailable') } }, { get: async () => { queried = true } }))
  assert.equal(queried, false)
})
