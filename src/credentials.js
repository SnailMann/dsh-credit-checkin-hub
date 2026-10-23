import { readFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash, createDecipheriv } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readMinimaxLocal, minimaxPaths } from './minimax.js'
import { readQoder, readQoderGlobal, qoderPath } from './qoder.js'
export { readQoder } from './qoder.js'
import { qoderSite } from './qoder-sites.js'
import { unseal } from './trae-vault.js'
import { CheckinError } from './errors.js'

const exec = promisify(execFile)
const support = process.platform === 'darwin' ? join(homedir(), 'Library/Application Support')
  : process.platform === 'win32' ? process.env.APPDATA ?? join(homedir(), 'AppData/Roaming') : join(homedir(), '.config')
export const defaults = {
  traeStorage: join(support, 'Trae CN/User/globalStorage/storage.json'),
  traeProduct: '/Applications/Trae CN.app/Contents/Resources/app/product.json',
  workbuddyAuth: join(support, 'CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info'),
  workbuddyElectron: '/Applications/WorkBuddy.app/Contents/MacOS/Electron',
}
const present = async path => access(path).then(() => true, () => false)
async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch { throw new CheckinError('credential-unreadable', '无法读取登录文件；请先在客户端登录，或检查凭据路径。') }
}
const fingerprint = (provider, id) => createHash('sha256').update(`${provider}:${id}`).digest('hex').slice(0, 24)

export async function readTrae(config = {}) {
  const path = config.traeCredentialFile ?? config.traeStorage ?? process.env.TRAE_STORAGE_FILE ?? defaults.traeStorage
  const doc = await readJson(path)
  const value = doc['iCubeAuthInfo://icube.cloudide']
  let session
  try { session = value ? JSON.parse(value.startsWith('dGMF') ? unseal(value) : value) : doc }
  catch { throw new CheckinError('credential-format', 'Trae 登录文件格式已变化，请更新插件或指定凭据 JSON。') }
  if (typeof session?.token !== 'string' || !session.token) throw new CheckinError('signed-out', 'Trae CN 未登录，请在客户端重新登录。')
  // Trae can retain an old aha- device alongside its current numeric registration.
  const keys = Object.keys(doc).filter(k => /^iCubeAuthInfo:\/\/icube-dc:\d+$/.test(k))
  const deviceId = session.deviceId ?? keys.at(-1)?.split(':').at(-1)
  if (!deviceId) throw new CheckinError('device-missing', 'Trae 缺少设备号，请启动 Trae CN 完成设备注册。')
  let source = config.traeReqSource ?? session.reqSource
  if (source === undefined) {
    const product = await readJson(config.traeProduct ?? defaults.traeProduct).catch(() => ({}))
    source = String(product.packageType ?? '').startsWith('SOLO_') ? 2 : 1
  }
  if (![1, 2].includes(source)) throw new CheckinError('config', 'traeReqSource 只接受 1（Code）或 2（Work）。')
  if (!session.userId) throw new CheckinError('identity-missing', 'Trae 凭据缺少 userId，无法隔离每日签到记录。')
  return { token: session.token, deviceId, reqSource: source, key: fingerprint('trae', session.userId) }
}

function lp(value) {
  const b = Buffer.from(value), h = Buffer.alloc(4)
  h.writeUInt32BE(b.length)
  return Buffer.concat([h, b])
}
// WorkBuddy authenticated envelope format, adapted from dsh-connect (MIT).
export function openWorkBuddyEnvelope(wrapped, secret) {
  const e = JSON.parse(Buffer.from(wrapped.envelope, 'base64').toString())
  if (e.suite !== 1) throw new Error('Unsupported envelope suite')
  const suite = Buffer.alloc(4); suite.writeUInt32BE(e.suite)
  const aad = Buffer.concat([Buffer.from('WB-AAD\0'), Buffer.from([1]), lp('WBEV1'), lp('sym-v1'), suite, lp(e.keyId), Buffer.from([2, 0, 0])])
  const key = createHash('sha256').update(secret).digest()
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(e.nonce, 'base64'))
  d.setAAD(aad); d.setAuthTag(Buffer.from(e.authTag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(e.ciphertext, 'base64')), d.final()]).toString()
}

export async function readWorkBuddy(config = {}) {
  const doc = await readJson(config.workbuddyAuth ?? process.env.WORKBUDDY_AUTH_FILE ?? defaults.workbuddyAuth)
  const auth = doc.auth ?? doc.credential ?? doc
  let accessToken = auth.accessToken, uid = doc.account?.uid ?? auth.uid
  let domain = auth.domain, enterpriseId = doc.account?.enterpriseId ?? auth.enterpriseId
  const values = [accessToken, uid, domain, enterpriseId]
  if (values.some(v => v?.$wbEncrypted === 1)) {
    let secret
    try {
      const binary = config.workbuddyElectron ?? process.env.WORKBUDDY_ELECTRON_BIN ?? defaults.workbuddyElectron
      const result = await exec(binary, ['-e', 'process.stdout.write(String(process._linkedBinding("electron_browser_workbuddy_storage").loggerGet()))'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 15000, maxBuffer: 1024 * 1024,
      })
      const payload = JSON.parse(result.stdout.trim())
      if (payload.version !== 1 || typeof payload.atRestSecretKey !== 'string') throw new Error()
      secret = payload.atRestSecretKey
      ;[accessToken, uid, domain, enterpriseId] = values.map(v => v?.$wbEncrypted === 1 ? openWorkBuddyEnvelope(v, secret) : v)
    } catch { throw new CheckinError('credential-decryption', 'WorkBuddy 登录态解密失败，请检查客户端安装位置与版本。') }
  }
  if (typeof accessToken !== 'string' || !accessToken) throw new CheckinError('signed-out', 'WorkBuddy 未登录，请在客户端重新登录。')
  if (typeof uid !== 'string' || !uid) throw new CheckinError('identity-missing', 'WorkBuddy 凭据缺少 uid，无法隔离每日签到记录。')
  if (typeof domain === 'string' && /workbuddy\.ai$/i.test(domain)) throw new CheckinError('region', '此插件仅支持 WorkBuddy 国内版。')
  return { accessToken, uid, domain, enterpriseId, key: fingerprint('workbuddy', `${uid}:${enterpriseId ?? ''}`) }
}

const readers = { trae: readTrae, workbuddy: readWorkBuddy, qoder: readQoder, 'qoder-global': readQoderGlobal, minimax: async config => { const c = await readMinimaxLocal(config); if (c.expiresAtMs && c.expiresAtMs <= Date.now()) throw new CheckinError('signed-out', 'MiniMax Code 访问令牌已过期；设置页登录可由插件续期。'); return { key: c.realUserID ? fingerprint('minimax', c.realUserID) : 'identity-pending' } } }

export async function doctor(config) {
  const result = {}
  for (const provider of config.providers) {
    try {
      const c = await readers[provider](config, { manual: true })
      result[provider] = { ready: true, accountKey: c.key, ...(provider === 'trae' ? { reqSource: c.reqSource } : {}) }
    } catch (e) { result[provider] = { ready: false, code: e.code ?? 'internal', message: e instanceof CheckinError ? e.message : '凭据检查失败。' } }
  }
  return { credentials: result, paths: {
    traeStoragePresent: await present(config.traeStorage ?? defaults.traeStorage),
    workbuddyAuthPresent: await present(config.workbuddyAuth ?? defaults.workbuddyAuth),
    minimaxAuthPresent: await present(minimaxPaths(config).explicit ?? minimaxPaths(config).own) || await present(minimaxPaths(config).native),
    qoderAuthPresent: await present(qoderPath(config)),
    qoderGlobalAuthPresent: await present(qoderPath(config, qoderSite('global'))),
  } }
}
