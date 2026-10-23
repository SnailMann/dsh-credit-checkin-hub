import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { normalizeConfig, publicSettings } from './config.js'
import { CheckinError } from './errors.js'

export class Settings {
  constructor(config) { this.base = config; this.path = join(config.dataDir, 'settings.json'); this.pending = Promise.resolve() }
  async read() {
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8'))
      return normalizeConfig({ ...this.base, ...this.validate(saved) })
    } catch (e) {
      if (e.code === 'ENOENT') return this.base
      throw new CheckinError('settings-invalid', '签到设置无法读取，请检查 settings.json。')
    }
  }
  validate(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !['enabled', 'time', 'timezone', 'providers'].includes(k))) throw new CheckinError('settings-input', '仅可设置签到开关、时间、时区和平台。')
    for (const value of Object.values(patch)) if (value === null) throw new CheckinError('settings-input', '设置值不能为空。')
    try { normalizeConfig({ ...this.base, ...patch }) } catch { throw new CheckinError('settings-input', '设置格式不正确，请检查时间、时区和平台开关。') }
    return patch
  }
  update(patch) {
    this.validate(patch)
    const task = this.pending.then(async () => {
      const current = await this.read()
      const next = normalizeConfig({ ...current, ...patch })
      await mkdir(this.base.dataDir, { recursive: true, mode: 0o700 })
      const tmp = `${this.path}.${randomUUID()}.tmp`
      try {
        const file = await open(tmp, 'wx', 0o600)
        try { await file.writeFile(JSON.stringify(publicSettings(next), null, 2) + '\n'); await file.sync() } finally { await file.close() }
        await rename(tmp, this.path)
      } finally { await unlink(tmp).catch(() => {}) }
      return next
    })
    this.pending = task.catch(() => {})
    return task
  }
}
