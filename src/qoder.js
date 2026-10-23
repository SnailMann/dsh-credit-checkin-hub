// Region-isolated Qoder desktop browser device flows (PKCE).
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeConfig } from './config.js'
import { CheckinError, safeError } from './errors.js'
import { qoderDeviceIdentity } from './qoder-device.js'

import { qoderSite, QODER_DESKTOP_CLIENT } from './qoder-sites.js'
export { QODER_DESKTOP_CLIENT }
const CLIENT = QODER_DESKTOP_CLIENT
const text = v => typeof v === 'string' && v.trim() ? v.trim() : undefined
const id = v => ['string', 'number'].includes(typeof v) && String(v).trim() ? String(v).trim() : undefined
const digest = value => createHash('sha256').update(value).digest('hex')
const headers = token => ({ Accept: 'application/json', 'User-Agent': 'Qoder', 'Cosy-ClientType': '10', 'Cosy-Version': '0.4.8', 'Cosy-MachineOS': process.platform, ...(token ? { Authorization: `Bearer ${token}` } : {}) })
const protocol = site => new CheckinError('protocol', `${site.name} 登录响应不受支持，请重新登录或更新插件。`)
export const qoderPath = (config, site = qoderSite()) => config[site.credentialKey] ?? config[site.authKey] ?? process.env[site.authEnv] ?? join(config.dataDir ?? normalizeConfig().dataDir, site.filename)
const managedPath = (config, site) => join(config.dataDir, site.filename)
export function qoderIdentity(value) {
  return id(value?.uid) ?? id(value?.user_id) ?? id(value?.userId) ?? id(value?.id)
}
function expiry(value, seconds) {
  if (typeof value === 'string') { const ms = Date.parse(value); if (Number.isFinite(ms)) return ms }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) return Date.now() + seconds * 1000
}
export async function readQoderSession(config = {}, site = qoderSite()) {
  let raw, doc
  try { raw = await readFile(qoderPath(config, site)) }
  catch (e) {
    if (e.code === 'ENOENT') throw new CheckinError('signed-out', `请在「设置 → 积分签到」点击「登录 ${site.name}」，完成独立网页登录。`)
    throw new CheckinError('credential-unreadable', `${site.name} 插件登录文件无法读取，请重新登录或检查文件权限。`)
  }
  if (raw.subarray(0, 3).toString() === 'v10') throw new CheckinError('credential-format', `请移除 ${site.authKey} 中的旧客户端路径，再在设置页登录 ${site.name}。新版使用独立网页登录。`)
  try { doc = JSON.parse(raw.toString()) } catch { throw new CheckinError('credential-format', `${site.name} 会话文件不是有效 JSON，请重新登录。`) }
  const token = text(doc?.token) ?? text(doc?.accessToken) ?? text(doc?.access_token) ?? text(doc?.security_oauth_token)
  if (!token) throw new CheckinError('signed-out', `${site.name} 登录态无效，请在积分签到设置页重新登录。`)
  if (doc.region && doc.region !== site.region || site.region === 'global' && doc.region !== 'global') throw new CheckinError('region-mismatch', `${site.name} 会话区域不匹配，请使用对应区域账号重新登录。`)
  return { ...doc, token, uid: qoderIdentity(doc), expiresAtMs: doc.expiresAtMs ?? expiry(doc.expires_at ?? doc.expiresAt ?? doc.expire_time), refreshToken: doc.refreshToken ?? doc.refresh_token }
}
export const readQoder = (config = {}) => readQoderForSite(config, qoderSite())
export const readQoderGlobal = (config = {}) => readQoderForSite(config, qoderSite('global'))
async function readQoderForSite(config, site) {
  const c = await readQoderSession(config, site)
  if (!c.uid) throw new CheckinError('identity-missing', `${site.name} 会话缺少已验证的账号标识；请使用设置页网页登录，签到时会向官方服务确认账号。`)
  return { token: c.token, key: digest(`${site.provider}:${c.uid}`).slice(0, 24) }
}
async function verifyIdentity(token, transport, signal, expected, site) {
  const doc = await transport.get(`${site.api}/api/v1/userinfo`, headers(token), signal)
  if (doc?.success === false || doc?.code !== undefined && doc.code !== 0) throw new CheckinError('auth-or-verification', `${site.name} 身份验证失败，请重新登录。`)
  const uid = qoderIdentity(doc) ?? qoderIdentity(doc?.data)
  if (!uid) throw new CheckinError('identity-missing', `${site.name} 官方接口未返回账号标识，请重新登录。`)
  if (expected && uid !== expected) throw new CheckinError('account-changed', `${site.name} 登录账号已变化，请重新登录后再签到。`)
  return uid
}
export class QoderAuth {
  constructor(config, transport, { now = Date.now, signal, deviceIdentity, region = 'cn' } = {}) {
    this.site = qoderSite(region)
    this.config = config; this.transport = transport; this.now = now
    this.controller = new AbortController()
    this.signal = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal
    this.deviceIdentity = deviceIdentity ?? (uid => qoderDeviceIdentity(uid, this.config, this.signal, undefined, this.site))
    this.state = { status: 'idle' }; this.epoch = 0
  }
  async status() {
    let connection = 'signed-out'
    try {
      const c = await readQoderSession(this.config, this.site)
      connection = this.needsUpgrade(c) ? 'upgrade-required' : c.expiresAtMs && c.expiresAtMs <= this.now() && !c.refreshToken ? 'expired' : 'connected'
    } catch {}
    return { connection, ...this.state }
  }
  async save(c) {
    const path = managedPath(this.config, this.site), temp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    await mkdir(this.config.dataDir, { recursive: true, mode: 0o700 })
    try { await writeFile(temp, JSON.stringify({ version: 1, ...c, region: this.site.region }) + '\n', { mode: 0o600 }); await rename(temp, path) }
    finally { await rm(temp, { force: true }) }
  }
  needsUpgrade(c) { return qoderPath(this.config, this.site) === managedPath(this.config, this.site) && c.clientId !== CLIENT }
  async start() {
    if (this.signal.aborted) throw new CheckinError('cancelled', '插件已停止。')
    if (this.pending && this.pending.expiresAt > this.now()) return this.status()
    const verifier = randomBytes(64).toString('base64url'), nonce = randomUUID()
    const machineId = randomUUID()
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const url = new URL('/device/selectAccounts', this.site.site)
    url.search = new URLSearchParams({ challenge, challenge_method: 'S256', nonce, machine_id: machineId, client_id: CLIENT }).toString()
    if (this.site.redirectUri) url.searchParams.set('redirect_uri', this.site.redirectUri)
    const expiresAt = this.now() + 300000
    this.pending = { verifier, nonce, machineId, interval: 2000, expiresAt }
    this.state = { status: 'pending', verificationUrl: url.href, expiresAt: new Date(expiresAt).toISOString() }
    this.schedule(this.pending)
    return this.status()
  }
  schedule(pending) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.polling = this.poll(pending).finally(() => { this.polling = undefined }) }, pending.interval)
    this.timer.unref?.()
  }
  grant(doc, previous = {}) {
    const token = text(doc?.token) ?? text(doc?.device_token)
    if (!token) throw protocol(this.site)
    const expiresAtMs = expiry(doc.expires_at, doc.expires_in)
    const refreshExpiresAtMs = expiry(doc.refresh_token_expires_at, doc.refresh_token_expires_in)
    return { token, refreshToken: text(doc.refresh_token) ?? previous.refreshToken, expiresAtMs, refreshExpiresAtMs: refreshExpiresAtMs ?? previous.refreshExpiresAtMs, machineId: previous.machineId }
  }
  async poll(pending = this.pending) {
    if (!pending || pending !== this.pending || this.signal.aborted) return
    try {
      if (this.now() >= pending.expiresAt) throw new CheckinError('login-expired', `${this.site.name} 登录链接已过期，请重新点击登录。`)
      const url = new URL('/api/v1/deviceToken/poll', this.site.api)
      url.search = new URLSearchParams({ nonce: pending.nonce, verifier: pending.verifier, challenge_method: 'S256' }).toString()
      const doc = await this.transport.get(url.href, headers(), this.signal)
      if (pending !== this.pending || this.signal.aborted) return
      const c = { ...this.grant(doc, { machineId: pending.machineId }), clientId: CLIENT }
      c.uid = await verifyIdentity(c.token, this.transport, this.signal, qoderIdentity(doc), this.site)
      if (pending !== this.pending || this.signal.aborted) return
      await this.save(c); this.epoch++; this.identityCache = { tokenHash: digest(c.token), uid: c.uid }
      this.pending = undefined; this.state = { status: 'authorized' }
    } catch (e) {
      if (pending !== this.pending || this.signal.aborted) return
      if ((e.code === 'http-404' || e.retryable) && this.now() < pending.expiresAt) { this.schedule(pending); return }
      this.pending = undefined; this.state = { status: 'failed', message: safeError(e).message }
    }
  }
  async credential() {
    if (this.reading) return this.reading
    this.reading = this.readCredential()
    try { return await this.reading } finally { this.reading = undefined }
  }
  async readCredential() {
    const epoch = this.epoch
    let c = await readQoderSession(this.config, this.site), changed = false
    if (this.needsUpgrade(c)) throw new CheckinError('qoder-login-upgrade', `请在设置页重新连接 ${this.site.name}，升级为新版桌面端网页登录。`)
    if (c.expiresAtMs && c.expiresAtMs <= this.now() + 60000) {
      if (!c.refreshToken || c.refreshExpiresAtMs && c.refreshExpiresAtMs <= this.now()) throw new CheckinError('signed-out', `${this.site.name} 登录已过期，请在设置页重新登录。`)
      const doc = await this.transport.post(`${this.site.api}/api/v1/deviceToken/refresh`, headers(), { refresh_token: c.refreshToken, ...(c.machineId ? { machine_id: c.machineId } : {}) }, this.signal)
      const refreshed = this.grant(doc, c)
      c = { ...c, ...refreshed }; changed = true
    }
    // Server identity is authoritative; never infer identity from a token hash or stale local field.
    let uid
    if (this.identityCache?.tokenHash === digest(c.token)) {
      uid = this.identityCache.uid
      if (c.uid && c.uid !== uid) throw new CheckinError('account-changed', `${this.site.name} 会话账号信息不一致，请重新登录。`)
    } else {
      uid = await verifyIdentity(c.token, this.transport, this.signal, c.uid, this.site)
      this.identityCache = { tokenHash: digest(c.token), uid }
    }
    if (this.epoch !== epoch) throw new CheckinError('account-changed', `${this.site.name} 登录账号已变化，请重新执行签到。`)
    if (qoderPath(this.config, this.site) === managedPath(this.config, this.site) && (changed || c.uid !== uid)) await this.save({ ...c, uid })
    return { token: c.token, key: digest(`${this.site.provider}:${uid}`).slice(0, 24), ...(c.machineId ? { machineId: c.machineId } : {}), getMachineIdentity: () => this.getMachineIdentity(uid) }
  }
  async getMachineIdentity(uid) {
    if (this.deviceCache?.uid === uid && this.deviceCache.expiresAt > this.now()) return this.deviceCache.value
    const value = await this.deviceIdentity(uid)
    this.deviceCache = { uid, value, expiresAt: this.now() + 50 * 60000 }
    return value
  }
  cancel() { clearTimeout(this.timer); this.pending = undefined; this.state = { status: 'idle' }; return this.status() }
  async dispose() { this.controller.abort(); clearTimeout(this.timer); this.pending = undefined; await Promise.allSettled([this.polling, this.reading].filter(Boolean)) }
}
