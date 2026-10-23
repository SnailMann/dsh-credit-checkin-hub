import { normalizeConfig, localClock, publicSettings, PROVIDERS, checkinDay } from './config.js'
import { readTrae, readWorkBuddy, readQoder } from './credentials.js'
import { checkinTrae, checkinWorkBuddy, checkinQoder, checkinQoderGlobal, createTransport } from './providers.js'
import { safeError } from './errors.js'
import { Store } from './store.js'
import { MiniMaxAuth, checkinMinimax } from './minimax.js'
import { QoderAuth } from './qoder.js'
import { Settings } from './settings.js'

const terminal = new Set(['claimed', 'already-claimed'])
const retries = [5 * 60000, 30 * 60000, 2 * 3600000]
export class Runner {
  constructor(input = {}, dependencies = {}) {
    this.config = normalizeConfig(input)
    this.settings = dependencies.settings ?? new Settings(this.config)
    this.store = dependencies.store ?? new Store(this.config.dataDir)
    this.readers = dependencies.readers ?? { trae: readTrae, workbuddy: readWorkBuddy, qoder: readQoder }
    this.checkers = dependencies.checkers ?? { trae: checkinTrae, workbuddy: checkinWorkBuddy, qoder: checkinQoder, 'qoder-global': checkinQoderGlobal, minimax: checkinMinimax }
    this.transport = dependencies.transport ?? createTransport()
    this.now = dependencies.now ?? (() => new Date())
    this.log = dependencies.log ?? (() => {})
    this.controller = new AbortController()
    this.jobs = new Set()
    this.minimax = dependencies.minimax ?? new MiniMaxAuth(this.config, this.transport, { signal: this.controller.signal })
    this.qoder = dependencies.qoder ?? new QoderAuth(this.config, this.transport, { signal: this.controller.signal })
    this.qoderGlobal = dependencies.qoderGlobal ?? new QoderAuth(this.config, this.transport, { signal: this.controller.signal, region: 'global' })
    if (!dependencies.readers) {
      this.readers.minimax = () => this.minimax.credential()
      this.readers.qoder = () => this.qoder.credential()
      this.readers['qoder-global'] = () => this.qoderGlobal.credential()
    }
  }
  async status() {
    const config = await this.settings.read()
    return { schedule: publicSettings(config), running: this.jobs.size > 0, minimax: await this.minimax.status(), qoder: await this.qoder.status(), 'qoder-global': await this.qoderGlobal.status(), ...await this.store.read() }
  }
  async updateSettings(patch) { this.config = await this.settings.update(patch); return publicSettings(this.config) }
  async run(options) {
    const task = this.executeRun(options)
    this.jobs.add(task)
    try { return await task } finally { this.jobs.delete(task) }
  }
  async executeRun({ manual = false } = {}) {
    if (this.controller.signal.aborted) return { status: 'stopped' }
    this.config = await this.settings.read()
    if (!manual && !this.config.enabled) return { status: 'paused' }
    if (!this.config.providers.length) return { status: 'no-providers' }
    const now = this.now(), clock = localClock(now, this.config.timezone)
    if (!manual && clock.time < this.config.time) return { status: 'not-due' }
    const unlock = await this.store.lock()
    if (!unlock) return { status: 'busy' }
    try {
      const state = await this.store.read(), results = {}
      for (const provider of PROVIDERS) {
        if (this.controller.signal.aborted) break
        this.config = await this.settings.read()
        if (!manual && !this.config.enabled) break
        if (!this.config.providers.includes(provider)) continue
        if (['qoder', 'qoder-global'].includes(provider) && !manual && localClock(now, 'Asia/Shanghai').time < '10:00') {
          results[provider] = { status: 'not-due', message: `${provider === 'qoder' ? 'Qoder CN' : 'Qoder 国际版'} 将在北京时间 10:00 后执行。` }
          continue
        }
        const day = checkinDay(provider, now, this.config.timezone)
        let c, result
        try { c = await this.readers[provider](this.config, { manual }) } catch (e) { result = safeError(e) }
        // Missing credentials also back off; successful future reads create an account-specific slot.
        const key = `${provider}:${c?.key ?? 'credentials'}`
        const prev = state.accounts[key]
        const sameDay = prev?.day === day
        if (sameDay && terminal.has(prev.status)) { results[provider] = { ...prev, cached: true }; continue }
        if (!manual && sameDay && (prev.attempts >= 4 || prev.retryable !== true || Date.parse(prev.nextAttemptAt) > now.getTime())) {
          results[provider] = { ...prev, cached: true }; continue
        }
        if (!result) {
          try { result = await this.checkers[provider](c, this.transport, this.controller.signal) }
          catch (e) { result = safeError(e) }
        }
        const attempts = sameDay ? prev.attempts + 1 : 1
        const entry = { ...result, provider, day, at: now.toISOString(), attempts }
        if (result.retryable === true && attempts <= retries.length) entry.nextAttemptAt = new Date(now.getTime() + retries[attempts - 1]).toISOString()
        state.accounts[key] = entry
        state.history.push(entry)
        state.history = state.history.slice(-100)
        // Bound old account records when the user switches accounts over time.
        state.accounts = Object.fromEntries(Object.entries(state.accounts).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 50))
        await this.store.write(state)
        results[provider] = entry
        this.log(`${provider}: ${entry.status}${entry.credits !== undefined ? ` (+${entry.credits})` : ''}${entry.code ? ` [${entry.code}]` : ''}`)
      }
      return { day: clock.day, results }
    } finally { await unlock() }
  }
  start() {
    const tick = () => {
      if (this.pending || this.controller.signal.aborted) return
      this.pending = this.run().catch(e => this.log(`scheduler: ${safeError(e).code}`)).finally(() => { this.pending = undefined })
    }
    tick()
    this.timer = setInterval(tick, 60000)
    this.timer.unref?.()
  }
  async dispose() {
    clearInterval(this.timer)
    this.controller.abort()
    await Promise.allSettled([...this.jobs])
    await this.minimax.dispose?.()
    await this.qoder.dispose?.()
    await this.qoderGlobal.dispose?.()
    await this.transport.close?.()
  }
}
