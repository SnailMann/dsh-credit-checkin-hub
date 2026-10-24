// MiniMax Code public protocol adapted from MiniMax-AI/minimax-code (MIT).
import { createHash, randomBytes } from 'node:crypto'
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { CheckinError, safeError } from './errors.js'

const ORIGIN = 'https://agent.minimaxi.com'
const ACCOUNT = 'https://account.minimax.cn'
const CLIENT = 'mcode-public'
const hash = (value, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(value).digest(encoding)
const text = v => typeof v === 'string' && v.trim() ? v.trim() : undefined
const number = v => typeof v === 'number' && Number.isFinite(v) && v >= 0
const protocol = () => new CheckinError('protocol', 'MiniMax Code 响应格式发生变化，未确认签到。')
export const minimaxPaths = config => {
  const home = resolve(config.minimaxHome ?? join(homedir(), '.minimax'))
  return {
    own: join(config.dataDir, 'minimax-auth.json'),
    explicit: config.minimaxCredentialFile ?? process.env.MINIMAX_CODE_AUTH_FILE,
    native: join(home, 'auth/prod/cn/mcode-public/auth.json'),
    identity: join(home, 'cli-auth/prod/cn/account-identity.json'),
    home,
  }
}
async function jsonFile(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (e) { if (e.code === 'ENOENT') return undefined; throw new CheckinError('credential-unreadable', 'MiniMax Code 登录文件无法读取，请在积分签到设置页重新登录。') }
}
export async function readMinimaxLocal(config) {
  const paths = minimaxPaths(config)
  let c, source
  if (paths.explicit) { c = await jsonFile(paths.explicit); source = 'explicit' }
  else {
    c = await jsonFile(paths.own); source = 'plugin'
    if (!c) {
      const doc = await jsonFile(paths.native)
      const account = hash(`${join(paths.home, 'auth')}\0${CLIENT}`, 'sha256', 'base64url')
      c = doc?.records?.[`com.minimax.mcode.oauth.prod.cn\0${account}`]
      source = 'client'
      if (c) {
        if (c.clientId !== CLIENT || c.audience !== 'agent-backend') throw new CheckinError('credential-format', 'MiniMax Code 本机 OAuth 登录格式不受支持，请在设置页登录。')
        const identity = await jsonFile(paths.identity)
        if (identity?.status === 'verified' && identity.region === 'cn' && identity.buildEnv === 'prod' && identity.tokenFingerprint === hash(c.accessToken ?? '')) c = { ...c, realUserID: identity.realUserID }
      }
    }
  }
  if (!text(c?.accessToken)) throw new CheckinError('signed-out', 'MiniMax Code 未登录，请在「设置 → 积分签到」点击登录 MiniMax Code。')
  if (c.region && c.region !== 'cn') throw new CheckinError('region', '当前仅支持 MiniMax Code 国内版。')
  return { ...c, source }
}
export function minimaxRequest(path, c, { body, now = Date.now(), identity = false } = {}) {
  const url = new URL(path, ORIGIN)
  url.search = new URLSearchParams({
    device_platform: identity ? 'mcode' : 'web', biz_id: '3', app_id: '3001', version_code: '22201',
    ...(!identity ? { is_desktop: '1', desktop_version: '0.6.5' } : {}),
    unix: String(now), timezone_offset: String(new Date().getTimezoneOffset() * -60), sys_language: 'zh', lang: 'zh',
    device_id: '0', os_name: process.platform, browser_name: 'mcode', user_id: c.realUserID ?? '0', client: 'mcode',
  }).toString()
  const second = Math.floor(now / 1000)
  return { url: url.href, headers: {
    Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'MiniMaxCode', Authorization: `Bearer ${c.accessToken}`,
    yy: hash(`${encodeURIComponent(url.pathname + url.search)}_${body ?? '{}'}${hash(String(now), 'md5')}ooui`, 'md5'),
    'x-timestamp': String(second), 'x-signature': hash(`${second}I*7Cf%WZ#S&%1RlZJ&C2${body ?? ''}`, 'md5'),
  } }
}
function unwrap(doc) {
  const code = doc?.base_resp?.status_code
  if (code !== 0) {
    if (code === 1000048) throw new CheckinError('auth-or-verification', 'MiniMax Code 登录失效，请在积分签到设置页重新登录。')
    if (typeof code !== 'number') throw protocol()
    throw new CheckinError(`business-${code}`, `MiniMax Code 请求未获确认（业务码 ${code}），请在官方页面查看。`)
  }
  if (!doc.data || typeof doc.data !== 'object' || Array.isArray(doc.data)) throw protocol()
  return doc.data
}
function panel(value) {
  if (!value || !Number.isInteger(value.scene) || value.scene < 0 || value.scene > 4 || !Array.isArray(value.days) || value.days.length !== 7) throw protocol()
  const days = value.days
  if (new Set(days.map(d => d?.day_no)).size !== 7 || days.some(d => !d || !Number.isInteger(d.day_no) || d.day_no < 1 || d.day_no > 7 || !number(d.points) || d.bonus_points !== undefined && !number(d.bonus_points) || ![1, 2, 3, 4].includes(d.status) || typeof d.is_today !== 'boolean') || days.filter(d => d.is_today).length > 1 || days.filter(d => d.status === 2).length > 1) throw protocol()
  return value
}
async function identity(c, transport, signal) {
  const request = minimaxRequest('/v1/api/user/info', c, { identity: true })
  const doc = await transport.get(request.url, request.headers, signal)
  if (typeof doc?.base_resp?.status_code === 'number' && doc.base_resp.status_code !== 0) unwrap(doc)
  if (typeof doc?.statusInfo?.code === 'number' && doc.statusInfo.code !== 0) throw new CheckinError('auth-or-verification', 'MiniMax Code 账号验证失败，请重新登录。')
  const data = doc.data ?? doc
  const user = data.userInfo ?? data.user_info ?? doc.userInfo ?? doc.user_info
  const id = text(user?.realUserID) ?? text(user?.real_user_id)
  if (!id) throw new CheckinError('identity-missing', 'MiniMax Code 未返回账号标识，请重新登录。')
  return id
}
export async function checkinMinimax(c, transport, signal) {
  if (!text(c.realUserID)) throw new CheckinError('identity-missing', 'MiniMax Code 缺少账号标识，请重新登录。')
  const request = minimaxRequest('/minimax-cloud/api/v1/signin/status', c)
  const before = panel(unwrap(await transport.get(request.url, request.headers, signal)))
  if (before.days.some(d => d.is_today && d.status === 3)) return { status: 'already-claimed', message: 'MiniMax Code 今日已签到。' }
  const target = before.days.find(d => d.status === 2)
  if (!target) return { status: 'unavailable', message: 'MiniMax Code 当前没有可领取的签到积分。' }
  const claimRequest = minimaxRequest('/minimax-cloud/api/v1/signin/claim', c, { body: '{}' })
  const claim = unwrap(await transport.post(claimRequest.url, claimRequest.headers, {}, signal))
  const after = panel(claim.panel)
  if (!text(claim.claim_id) || ![1, 2].includes(claim.claim_result) || !Number.isInteger(claim.day_no) || claim.day_no !== target.day_no || !number(claim.points) || !number(claim.expire_at_ms) || !after.days.some(d => d.day_no === claim.day_no && d.status === 3)) throw protocol()
  if (claim.claim_result === 2) return { status: 'already-claimed', message: 'MiniMax Code 今日已签到。' }
  // bonus_points is already included in points in the official wire contract.
  return { status: 'claimed', message: 'MiniMax Code 签到成功，服务端已确认。', credits: claim.points }
}

export class MiniMaxAuth {
  constructor(config, transport, { now = Date.now, signal } = {}) {
    this.config = config; this.transport = transport; this.now = now
    this.controller = new AbortController()
    this.signal = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal
    this.state = { status: 'idle' }; this.epoch = 0; this.saving = Promise.resolve()
  }
  async status() {
    let connection = 'signed-out'
    try { const c = await readMinimaxLocal(this.config); connection = c.expiresAtMs && c.expiresAtMs <= this.now() && !(c.source === 'plugin' && c.refreshToken) ? 'expired' : 'connected' } catch {}
    return { connection, ...this.state }
  }
  assertCurrent(epoch = this.epoch) {
    if (this.signal.aborted) throw new CheckinError('cancelled', '插件已停止。')
    if (epoch !== this.epoch) throw new CheckinError('account-changed', 'MiniMax Code 登录账号已变化，请重新执行签到。')
  }
  save(c, { epoch, replace = false, current = () => true } = {}) {
    const task = this.saving.then(async () => {
      const check = () => {
        this.assertCurrent(epoch)
        if (!current()) throw new CheckinError('cancelled', '此次登录已取消。')
      }
      check()
      const path = minimaxPaths(this.config).own, temp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
      await mkdir(this.config.dataDir, { recursive: true, mode: 0o700 })
      try {
        await writeFile(temp, JSON.stringify({ ...c, region: 'cn' }) + '\n', { mode: 0o600 })
        check()
        await rename(temp, path)
        if (replace) this.epoch++
      } finally { await rm(temp, { force: true }) }
    })
    this.saving = task.catch(() => {})
    return task
  }
  grant(doc, previous) {
    let claims
    try { claims = JSON.parse(Buffer.from(doc.access_token?.split('.')[1] ?? '', 'base64url').toString()) } catch {}
    const rawScope = doc.scope ?? claims?.scope ?? claims?.scp
    const scopes = typeof rawScope === 'string' ? rawScope.split(/\s+/) : Array.isArray(rawScope) ? rawScope : []
    if (!scopes.includes('agent.default')) throw protocol()
    if (!text(doc.access_token) || !text(doc.refresh_token ?? previous?.refreshToken) || !number(doc.expires_in) || doc.expires_in <= 0 || doc.token_type?.toLowerCase() !== 'bearer') throw protocol()
    return { accessToken: doc.access_token, refreshToken: doc.refresh_token ?? previous?.refreshToken, expiresAtMs: this.now() + doc.expires_in * 1000 }
  }
  async credential(options = {}) {
    if (this.reading) return this.reading
    this.reading = this.readCredential(options)
    try { return await this.reading } finally { this.reading = undefined }
  }
  async readCredential({ beforeNetwork } = {}) {
    const epoch = this.epoch
    let c = await readMinimaxLocal(this.config)
    const credentialRevision = c.credentialRevision ?? hash(c.accessToken)
    this.assertCurrent(epoch)
    beforeNetwork?.(credentialRevision)
    if (c.expiresAtMs && c.expiresAtMs <= this.now() + 60000) {
      if (c.source !== 'plugin' || !c.refreshToken) throw new CheckinError('signed-out', 'MiniMax Code 登录过期，请在积分签到设置页重新登录。')
      const doc = await this.transport.form(`${ACCOUNT}/oauth2/token`, { grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: CLIENT, scope: 'agent.default', audience: 'agent-backend' }, this.signal)
      if (doc.error) throw new CheckinError('signed-out', 'MiniMax Code 登录续期失败，请在积分签到设置页重新登录。')
      c = { ...this.grant(doc, c), source: 'plugin', identityPending: true, credentialRevision }
      // Preserve rotated tokens before a separate identity request can fail.
      // Pending grants cannot be returned for use until identity is verified.
      await this.save(c, { epoch })
    }
    if (c.identityPending || !text(c.realUserID)) {
      c.realUserID = await identity(c, this.transport, this.signal)
      if (c.source === 'plugin') {
        c.identityPending = false
        await this.save(c, { epoch })
      }
    }
    this.assertCurrent(epoch)
    return { accessToken: c.accessToken, realUserID: c.realUserID, key: hash(`minimax:${c.realUserID}`).slice(0, 24) }
  }
  async start() {
    if (this.starting) return this.starting
    this.starting = this.startAuthorization()
    try { return await this.starting } finally { this.starting = undefined }
  }
  async startAuthorization() {
    if (this.signal.aborted) throw new CheckinError('cancelled', '插件已停止。')
    if (this.pending && this.pending.expiresAt > this.now()) return this.status()
    const verifier = randomBytes(32).toString('base64url')
    const doc = await this.transport.form(`${ACCOUNT}/oauth2/device/code`, { client_id: CLIENT, scope: 'agent.default', audience: 'agent-backend', code_challenge: hash(verifier, 'sha256', 'base64url'), code_challenge_method: 'S256' }, this.signal)
    const custom = !doc.device_code && number(doc.expired_in)
    const code = text(custom ? doc.user_code : doc.device_code), userCode = text(doc.user_code)
    const ttl = doc.expires_in ?? (doc.expired_in >= 1e12 ? (doc.expired_in - this.now()) / 1000 : doc.expired_in)
    let url
    try { url = new URL(doc.verification_uri_complete ?? doc.verification_uri ?? doc.verification_url) } catch { throw protocol() }
    if (url.protocol !== 'https:' || !['account.minimax.cn', 'agent.minimaxi.com', 'agent.minimax.cn'].includes(url.hostname) || url.username || url.password || url.port || !code || !userCode || !number(ttl) || ttl <= 0) throw protocol()
    const interval = Math.max(3000, Math.min(60000, number(doc.interval) && doc.interval > 0 ? doc.interval * (custom ? 1 : 1000) : 5000))
    const expiresAt = this.now() + Math.min(ttl, 900) * 1000
    if (this.signal.aborted) throw new CheckinError('cancelled', '插件已停止。')
    this.pending = { verifier, code, custom, interval, expiresAt }
    this.state = { status: 'pending', verificationUrl: url.href, userCode, expiresAt: new Date(expiresAt).toISOString() }
    this.schedule(this.pending)
    return this.status()
  }
  schedule(pending) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.polling = this.poll(pending).finally(() => { this.polling = undefined })
    }, pending.interval)
    this.timer.unref?.()
  }
  async poll(pending = this.pending) {
    if (!pending || pending !== this.pending || this.signal.aborted) return
    try {
      if (this.now() >= pending.expiresAt) throw new CheckinError('login-expired', '登录授权已过期，请重新点击登录。')
      const doc = await this.transport.form(`${ACCOUNT}/oauth2/token`, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', [pending.custom ? 'user_code' : 'device_code']: pending.code, client_id: CLIENT, code_verifier: pending.verifier }, this.signal)
      if (pending !== this.pending || this.signal.aborted) return
      const status = doc.error ?? doc.status
      if (['authorization_pending', 'pending', 'slow_down'].includes(status)) {
        if (status === 'slow_down') pending.interval += 5000
        this.schedule(pending); return
      }
      if (status) throw new CheckinError('login-denied', 'MiniMax Code 授权未完成或已被拒绝，请重新登录。')
      const c = this.grant(doc)
      c.realUserID = await identity(c, this.transport, this.signal)
      if (pending !== this.pending || this.signal.aborted) return
      await this.save(c, { replace: true, current: () => pending === this.pending })
      this.pending = undefined; this.state = { status: 'authorized' }
    } catch (e) {
      if (pending !== this.pending || this.signal.aborted) return
      if (e.retryable && this.now() < pending.expiresAt) { this.schedule(pending); return }
      this.pending = undefined; this.state = { status: 'failed', message: safeError(e).message }
    }
  }
  cancel() { clearTimeout(this.timer); this.pending = undefined; this.state = { status: 'idle' }; return this.status() }
  async dispose() { this.controller.abort(); clearTimeout(this.timer); this.pending = undefined; await Promise.allSettled([this.polling, this.starting, this.reading, this.saving].filter(Boolean)) }
}
