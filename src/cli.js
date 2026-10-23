#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { normalizeConfig } from './config.js'
import { doctor } from './credentials.js'
import { Runner } from './runner.js'
import { safeError } from './errors.js'

const args = process.argv.slice(2)
const command = args[0] ?? 'status'
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
try {
  const file = option('--config')
  const input = file ? JSON.parse(await readFile(file, 'utf8')) : {}
  const config = normalizeConfig({ ...input, ...(option('--data-dir') ? { dataDir: option('--data-dir') } : {}) })
  if (command === 'doctor') {
    const report = await doctor(config)
    console.log(JSON.stringify(report, null, 2))
    if (Object.values(report.credentials).some(c => !c.ready)) process.exitCode = 1
  } else if (['status', 'run', 'tick'].includes(command)) {
    const runner = new Runner(config)
    try {
      const result = command === 'status' ? await runner.status() : await runner.run({ manual: command === 'run' })
      console.log(JSON.stringify(result, null, 2))
      if (Object.values(result.results ?? {}).some(r => r.status === 'failed') || result.status === 'busy') process.exitCode = 1
    } finally { await runner.dispose() }
  } else {
    console.log('Usage: dsh-daily-checkin <doctor|status|run|tick> [--config config.json] [--data-dir PATH]')
    process.exitCode = 2
  }
} catch (e) { console.error(JSON.stringify(safeError(e))); process.exitCode = 1 }
