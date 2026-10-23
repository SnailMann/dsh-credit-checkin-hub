import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { qoderSite } from './qoder-sites.js'
import { CheckinError } from './errors.js'

export function qoderRuntimePath(config, site = qoderSite(), exists = existsSync) {
  if (config[site.runtimeKey]) return config[site.runtimeKey]
  if (site.region === 'global' && !exists(site.runtime) && config.dataDir) {
    const cached = join(config.dataDir, 'runtimes/qoder-global/runtime-info')
    if (exists(cached)) return cached
  }
  return site.runtime
}

// Use Qoder's installed official device helper, without reading its login store.
export async function qoderDeviceIdentity(account, config = {}, signal, run = execFile, site = qoderSite()) {
  if (signal?.aborted) throw new CheckinError('cancelled', '签到任务已取消。')
  if (process.platform !== 'darwin' && !config[site.runtimeKey]) throw new CheckinError('qoder-device-unsupported', '当前系统尚未适配 Qoder 官方设备验证工具。')
  if (typeof account !== 'string' || !account.trim() || Buffer.byteLength(account) > 512) throw new CheckinError('identity-missing', `${site.name} 设备验证缺少已确认的账号。`)
  const path = qoderRuntimePath(config, site)
  const stdout = await new Promise((resolve, reject) => {
    const child = run(path, [site.deviceEnvironment, '--account-stdin'], { encoding: 'utf8', timeout: 25000, killSignal: 'SIGKILL', maxBuffer: 65536, windowsHide: true, ...(signal ? { signal } : {}) }, (error, output, stderr) => {
      if (!error) { resolve(output); return }
      if (signal?.aborted) reject(new CheckinError('cancelled', '签到任务已取消。'))
      else if (error.code === 'ENOENT') reject(new CheckinError('qoder-device-missing', `请安装 ${site.name} 桌面端，以使用官方设备验证完成每日领取。`))
      else if (/sgsdk init callback timed out/.test(String(stderr ?? ''))) reject(new CheckinError('qoder-device-network', `${site.name} 官方设备验证初始化超时，请检查网络或代理，或更新对应客户端后重试。`, true))
      else reject(new CheckinError('qoder-device-failed', 'Qoder 官方设备验证未完成，将稍后重试；请确认客户端已正常安装。', true))
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(JSON.stringify({ account }) + '\n')
  })
  let doc
  try { doc = JSON.parse(stdout.trim().split('\n')[0]) } catch {}
  const result = {}
  for (const key of ['machineToken', 'machineCode', 'machineType']) {
    const value = doc?.[key]
    if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 4096 || !/^[\x20-\x7e]+$/.test(value)) throw new CheckinError('qoder-device-invalid', 'Qoder 官方设备验证返回格式异常，未提交领取。', true)
    result[key] = value.trim()
  }
  return result
}
