import { mkdir, open, readFile, rename, unlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CheckinError } from './errors.js'

export class Store {
  constructor(dir) { this.dir = dir; this.path = join(dir, 'state.json'); this.lockPath = join(dir, 'run.lock') }
  async read() {
    try {
      const state = JSON.parse(await readFile(this.path, 'utf8'))
      if (state.version !== 1 || !state.accounts || typeof state.accounts !== 'object' || Array.isArray(state.accounts) || !Array.isArray(state.history)) throw new Error()
      if (Object.values(state.accounts).some(entry => !entry || typeof entry.at !== 'string' || !Number.isInteger(entry.attempts))) throw new Error()
      return state
    } catch (e) {
      if (e.code === 'ENOENT') return { version: 1, accounts: {}, history: [] }
      throw new CheckinError('state-invalid', '签到记录无法读取，请备份并检查 state.json。')
    }
  }
  async write(state) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const tmp = `${this.path}.${randomUUID()}.tmp`
    try {
      const f = await open(tmp, 'wx', 0o600)
      try { await f.writeFile(JSON.stringify(state, null, 2) + '\n'); await f.sync() } finally { await f.close() }
      await rename(tmp, this.path)
    } finally { await unlink(tmp).catch(() => {}) }
  }
  async lock() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const f = await open(this.lockPath, 'wx', 0o600)
        await f.writeFile(JSON.stringify({ pid: process.pid })); await f.close()
        return async () => { await unlink(this.lockPath).catch(() => {}) }
      } catch (e) {
        if (e.code !== 'EEXIST') throw e
        // Recover only when the previous process is gone. A live process retains its lock.
        let stale = false
        try {
          const { pid } = JSON.parse(await readFile(this.lockPath, 'utf8'))
          if (!Number.isInteger(pid) || pid <= 0) throw new Error()
          try { process.kill(pid, 0) } catch (e) { stale = e.code === 'ESRCH' }
        } catch {
          const info = await stat(this.lockPath).catch(() => undefined)
          stale = info && Date.now() - info.mtimeMs > 300000
        }
        if (!stale) return undefined
        await unlink(this.lockPath).catch(() => {})
      }
    }
    return undefined
  }
}
