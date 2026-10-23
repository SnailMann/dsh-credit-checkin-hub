import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'

export const PROVIDERS = ['trae', 'workbuddy', 'qoder', 'qoder-global', 'minimax']

export function normalizeConfig(input = {}) {
  const enabled = input.enabled ?? true
  if (typeof enabled !== 'boolean') throw new Error('enabled 必须为布尔值')
  const time = input.time ?? '09:05'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('time 必须为 HH:mm')
  const timezone = input.timezone ?? 'Asia/Shanghai'
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
  const providers = input.providers ?? PROVIDERS.filter(p => p !== 'qoder-global')
  if (!Array.isArray(providers) || providers.some(p => !PROVIDERS.includes(p))) throw new Error('providers 只接受 trae、workbuddy、qoder、qoder-global、minimax')
  const desktopHome = join(homedir(), 'Library/Application Support/dsh-desktop/harness')
  const dshHome = process.env.DSH_HOME ?? (process.platform === 'darwin' && existsSync(desktopHome) ? desktopHome : join(homedir(), '.dsh'))
  const dataDir = resolve(input.dataDir ?? process.env.DSH_CHECKIN_DATA_DIR ?? join(dshHome, 'daily-checkin'))
  return { ...input, enabled, time, timezone, providers: [...new Set(providers)], dataDir }
}

export function publicSettings(config) {
  return { enabled: config.enabled, time: config.time, timezone: config.timezone, providers: [...config.providers] }
}

export function localClock(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(p => [p.type, p.value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

export function checkinDay(provider, date, timezone) {
  // Qoder's round changes at 10:00 in Beijing, including manual claims before 10.
  return ['qoder', 'qoder-global'].includes(provider)
    ? localClock(new Date(date.getTime() - 10 * 3600000), 'Asia/Shanghai').day
    : localClock(date, timezone).day
}
