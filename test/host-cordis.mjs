// Run with DSH Desktop's Electron as Node; verifies the exact bundled host runtime.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const resources = '/Applications/DSH Desktop.app/Contents/Resources'
const { registerHostModuleFallback } = await import(pathToFileURL(`${resources}/host-module-fallback.mjs`))
registerHostModuleFallback(`${resources}/app.asar/node_modules/@deepseek-ai/dsh/lib/bin.js`)
const { Context, Service } = await import('@deepseek-ai/cordis')
const { ToolRuntime } = await import('@deepseek-ai/dsh-tools')
const { readPluginMeta } = await import('@deepseek-ai/dsh-app-boot')
const plugin = await import('../src/index.js')
const dir = await mkdtemp(join(tmpdir(), 'dsh-checkin-host-'))
const ctx = new Context()
let tools
try {
  const routes = new Map()
  class WebServer extends Service {
    constructor(ctx) { super(ctx, 'webServer') }
    register(route) { routes.set(route.path, route); return () => routes.delete(route.path) }
  }
  new WebServer(ctx)
  class SystemPrompt extends Service {
    constructor(ctx) { super(ctx, 'systemPrompt') }
    tools() { return () => {} }
  }
  new SystemPrompt(ctx)
  tools = new ToolRuntime(ctx)
  const fiber = ctx.plugin(plugin, { dataDir: dir, time: '23:59', providers: ['trae'] })
  await fiber.inertia
  assert.equal(fiber.state, 2)
  assert.equal(typeof routes.get('/plugins/dsh-credit-checkin').handler, 'function')
  // Read the localized metadata through a throwaway profile that declares this
  // checkout exactly like the Desktop plugin page does (link dependency).
  const root = fileURLToPath(new URL('..', import.meta.url))
  const profile = join(dir, 'profile')
  await mkdir(join(profile, 'node_modules'), { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'host-test', private: true, dependencies: { 'dsh-credit-checkin': `link:${root}` } }))
  await symlink(root, join(profile, 'node_modules/dsh-credit-checkin'), 'dir')
  const meta = readPluginMeta('dsh-credit-checkin', pathToFileURL(join(profile, 'package.json')).href)
  assert.equal(meta.title.zh, '多平台积分签到')
  const definition = tools.get('daily_checkin_status')
  assert.ok(tools.get('daily_checkin_run'))
  const value = await definition.execute({})
  const rendered = tools.createSuccessResult({ arguments: {}, token: {} }, definition, value)
  assert.deepEqual(rendered.content, [{ type: 'text', text: value }])
  const status = JSON.parse(value)
  assert.equal(status.schedule.time, '23:59')
  assert.equal(status.history.length, 0)
  await fiber.dispose()
  assert.equal(tools.get('daily_checkin_status'), undefined)
  assert.equal(tools.get('daily_checkin_run'), undefined)
  assert.equal(routes.size, 0)
  console.log('PASS: packaged Cordis activation, localized plugin name, web route, tools, and unload cleanup')
} finally { await rm(dir, { recursive: true, force: true }) }
