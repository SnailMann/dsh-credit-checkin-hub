import { fetch, EnvHttpProxyAgent } from 'undici'
import { qoderSite } from './qoder-sites.js'
import { CheckinError } from './errors.js'

export function createTransport({ dispatcher = new EnvHttpProxyAgent() } = {}) {
  const transport = {
    async request(method, url, headers, body, signal, options = {}) {
      try {
        const response = await fetch(url, {
          method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
          ...(body !== undefined ? { body: options.form ? new URLSearchParams(body).toString() : JSON.stringify(body) } : {}), dispatcher, redirect: 'error',
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
        })
        if ([401, 403].includes(response.status)) throw new CheckinError('auth-or-verification', '登录已失效或需要客户端验证，请打开对应客户端处理后重试。')
        let doc
        try { doc = await response.json() } catch {
          if (!response.ok) throw new CheckinError(`http-${response.status}`, `签到服务返回 HTTP ${response.status}。`, response.status === 429 || response.status >= 500)
          throw new CheckinError('protocol', '签到服务未返回有效 JSON。')
        }
        // WorkBuddy uses HTTP 400 for "already checked in" (10001).
        if (!response.ok && !(response.status === 400 && (options.form && typeof doc?.error === 'string' || typeof doc?.code === 'number' && doc.code !== 0))) throw new CheckinError(`http-${response.status}`, `签到服务返回 HTTP ${response.status}。`, response.status === 429 || response.status >= 500)
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new CheckinError('protocol', '签到服务响应格式发生变化。')
        return doc
      } catch (e) {
        if (e instanceof CheckinError) throw e
        if (signal?.aborted) throw new CheckinError('cancelled', '签到任务已取消。')
        if (e instanceof SyntaxError) throw new CheckinError('protocol', '签到服务未返回有效 JSON。')
        throw new CheckinError('network', '无法连接签到服务，请检查网络或 HTTP(S)_PROXY 设置。', true)
      }
    },
    post(url, headers, body, signal) { return transport.request('POST', url, headers, body, signal) },
    get(url, headers, signal) { return transport.request('GET', url, headers, undefined, signal) },
    form(url, body, signal) { return transport.request('POST', url, { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal, { form: true }) },
    async close() { await dispatcher.close() },
  }
  return transport
}

const credit = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
function businessError(provider, doc) {
  const code = typeof doc.code === 'number' ? doc.code : 'unknown'
  return new CheckinError(`business-${code}`, `${provider} 签到未获确认（业务码 ${code}），请在客户端查看活动或验证提示。`)
}

export async function checkinTrae(c, transport, signal) {
  const headers = { Authorization: `Cloud-IDE-JWT ${c.token}`, 'x-ide-token': c.token, 'x-device-id': c.deviceId }
  const post = action => transport.post(`https://api.trae.cn/trae/api/v2/ug/checkin_credits/${action}`, headers, { req_source: c.reqSource }, signal)
  const before = await post('status')
  if (before.code !== undefined && before.code !== 0) throw businessError('Trae CN', before)
  if (typeof before.enable !== 'boolean' || typeof before.checked_in !== 'boolean') throw new CheckinError('protocol', 'Trae 签到状态缺少 enable/checked_in，未提交领取。')
  if (before.checked_in) return { status: 'already-claimed', message: '今日已签到。' }
  if (!before.enable) return { status: 'unavailable', message: '当前账号未开放签到。' }
  const claim = await post('claim')
  if (claim.code !== undefined && claim.code !== 0) {
    // Another client may have checked in between status and claim.
    const after = await post('status')
    if (after.checked_in === true) return { status: 'already-claimed', message: '今日已签到。' }
    throw businessError('Trae CN', claim)
  }
  // An empty 200 is not proof of receipt. The client sometimes omits code.
  const after = await post('status')
  if (after.checked_in !== true) throw new CheckinError('unconfirmed', 'Trae 领取后仍未显示已签到，将稍后复查。', true)
  // extra_credits is activity metadata, not independently confirmed receipt.
  // Report only credits; never add both status fields as an awarded total.
  return { status: 'claimed', message: '签到成功，服务端已确认。', credits: credit(before.credits) }
}

export async function checkinWorkBuddy(c, transport, signal) {
  const headers = { Authorization: `Bearer ${c.accessToken}`, 'X-User-Id': c.uid }
  if (c.domain) headers['X-Domain'] = c.domain
  if (c.enterpriseId) {
    headers['X-Enterprise-Id'] = c.enterpriseId
    headers['X-Tenant-Id'] = c.enterpriseId
  }
  const doc = await transport.post('https://www.codebuddy.cn/v2/billing/meter/daily-checkin', headers, {}, signal)
  const data = doc.data
  const code = data?.code ?? doc.code
  if ([1001, 10001].includes(code)) return { status: 'already-claimed', message: '今日已签到。' }
  if ([1002, 1003].includes(code)) return { status: 'unavailable', message: code === 1002 ? '当前账号不满足签到条件。' : '签到活动已结束。' }
  if (code !== 0 || !data || typeof data !== 'object' || credit(data.credit) === undefined) throw businessError('WorkBuddy', { code })
  return { status: 'claimed', message: '签到成功，服务端已确认。', credits: credit(data.credit), streakDays: credit(data.streak_days) }
}

export const checkinQoder = (c, transport, signal) => checkinQoderSite(c, transport, signal, qoderSite())
export const checkinQoderGlobal = (c, transport, signal) => checkinQoderSite(c, transport, signal, qoderSite('global'))
async function checkinQoderSite(c, transport, signal, site) {
  const url = `${site.api}/sash/api/v1/me/campaigns`
  const headers = { Authorization: `Bearer ${c.token}`, 'Cosy-ClientType': '10', 'Cosy-Version': '0.4.8', 'Cosy-MachineOS': process.platform, 'User-Agent': 'Qoder', Accept: 'application/json' }
  if (c.machineId) {
    headers['Cosy-MachineId'] = c.machineId
  }
  if (c.getMachineIdentity) {
    const identity = await c.getMachineIdentity()
    headers['Cosy-MachineToken'] = identity.machineToken
    headers['Cosy-MachineCode'] = identity.machineCode
    headers['Cosy-MachineType'] = identity.machineType
  }
  const readCampaigns = async () => {
    const response = await transport.get(url, headers, signal)
    if (response.code !== undefined && response.code !== 0 || response.success === false) throw businessError(`${site.name}`, response)
    const doc = Array.isArray(response.campaigns) ? response : response.data
    if (!doc || !Array.isArray(doc.campaigns)) throw new CheckinError('protocol', `${site.name} 活动响应缺少 campaigns，未确认领取。`)
    return doc.campaigns.filter(row => row?.actionType === 'CLAIM_BENEFIT')
  }
  let before
  try { before = await readCampaigns() } catch (e) {
    if (['http-404', 'http-410'].includes(e.code)) return { status: 'unavailable', message: `${site.name} 当前没有签到活动。` }
    throw e
  }
  const isDaily = row => /daily|check.?in|每日|每天|签到/i.test([
    row.campaignId, row.campaignKey, row.title, row.name, row.campaignName, row.campaignType,
    ...(Array.isArray(row.placements) ? row.placements : []).flatMap(p => Object.values(p.content ?? {}).flatMap(text => [text?.title, text?.description])),
  ].filter(v => typeof v === 'string').join(' '))
  const daily = before.filter(row => row.benefit?.kind === 'CREDITS' && isDaily(row))
  const candidates = daily.filter(row => row.claimStatus === 'CLAIMABLE' && typeof row.campaignId === 'string' && row.campaignId && credit(row.benefit.amount) !== undefined)
  if (candidates.length > 1) throw new CheckinError('campaign-ambiguous', `${site.name} 返回多项每日积分活动，无法确定领取项目，请在客户端查看。`)
  const target = candidates[0]
  if (!target) {
    if (daily.some(row => row.claimStatus === 'CLAIMED')) return { status: 'already-claimed', message: `本轮 ${site.name} 每日积分已领取。` }
    return { status: 'unavailable', message: '官方暂未返回可领的每日积分活动，将稍后复查。', retryable: true }
  }
  let claimError
  try {
    const doc = await transport.post(`${url}/${encodeURIComponent(target.campaignId)}/claim`, headers, {}, signal)
    if (doc.code !== undefined && doc.code !== 0 || doc.success === false) claimError = businessError(`${site.name}`, doc)
  } catch (e) { claimError = e }
  // Confirm the exact campaign, rather than treating an empty 200, a 404,
  // ineligibility, or a disappearing card as proof of receipt.
  const after = await readCampaigns()
  const confirmed = after.find(row => row.campaignId === target.campaignId)?.claimStatus === 'CLAIMED'
  if (confirmed) return claimError
    ? { status: 'already-claimed', message: `本轮 ${site.name} 积分已领取。` }
    : { status: 'claimed', message: `${site.name} 积分领取成功，服务端已确认。`, credits: credit(target.benefit.amount) }
  if (claimError) throw claimError
  throw new CheckinError('unconfirmed', `${site.name} 领取后尚未确认到账，将稍后复查。`, true)
}
