import test from 'node:test'
import assert from 'node:assert/strict'
import { Dispatcher, MockAgent } from 'undici'
import { createTransport } from '../src/providers.js'

// Feed actual undici fetch a partial response and then interrupt its body.
// The fallback bounds the fixture if the request deadline ever stops working.
class InterruptedBody extends Dispatcher {
  constructor(interrupt) { super(); this.interrupt = interrupt }
  dispatch(_options, handler) {
    let timer
    handler.onConnect(error => { clearTimeout(timer); handler.onError(error) })
    queueMicrotask(() => {
      timer = setTimeout(() => handler.onError(new Error('Mock fixture deadline exceeded')), 1000)
      handler.onHeaders(200, [], () => {}, 'OK')
      handler.onData(Buffer.from('{"ok":'))
      setImmediate(() => this.interrupt?.(error => { clearTimeout(timer); handler.onError(error) }))
    })
    return true
  }
  async close() {}
}

test('response body timeout remains retryable after successful headers', async () => {
  const io = createTransport({ dispatcher: new InterruptedBody(), timeoutMs: 30 })
  const start = Date.now()
  try {
    await assert.rejects(io.get('https://mock.example/status', {}), { code: 'network', retryable: true })
    assert.ok(Date.now() - start < 900, 'the request deadline must also bound response body reads')
  } finally { await io.close() }
})

test('response body cancellation stays cancelled and stream failures stay retryable', async () => {
  const controller = new AbortController()
  const cancelled = createTransport({ dispatcher: new InterruptedBody(() => controller.abort()) })
  const broken = createTransport({ dispatcher: new InterruptedBody(fail => fail(new Error('Mock socket reset'))) })
  try {
    await assert.rejects(cancelled.get('https://mock.example/status', {}, controller.signal), { code: 'cancelled', retryable: false })
    await assert.rejects(broken.get('https://mock.example/status', {}), { code: 'network', retryable: true })
  } finally { await cancelled.close(); await broken.close() }
})

test('complete malformed JSON still fails as a non-retryable protocol error', async () => {
  const agent = new MockAgent(); agent.disableNetConnect()
  agent.get('https://mock.example').intercept({ path: '/status', method: 'GET' }).reply(200, '{bad json')
  const io = createTransport({ dispatcher: agent })
  try { await assert.rejects(io.get('https://mock.example/status', {}), { code: 'protocol', retryable: false }) }
  finally { await io.close() }
})
