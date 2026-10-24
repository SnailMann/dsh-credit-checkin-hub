// Verify the installed desktop's real package inventory and bundle composition.
// Profile registration is written directly here (link dependency + bundle entry +
// node_modules symlink), matching what the Desktop plugin page produces when a
// local directory is installed; no pnpm run and no network access needed.
import assert from 'node:assert/strict'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const resources = '/Applications/DSH Desktop.app/Contents/Resources'
const anchor = `${resources}/app.asar/node_modules/@deepseek-ai/dsh/package.json`
const { registerHostModuleFallback } = await import(pathToFileURL(`${resources}/host-module-fallback.mjs`))
registerHostModuleFallback(`${resources}/app.asar/node_modules/@deepseek-ai/dsh/lib/bin.js`)
const { loadProfileDirectory, composeEntries } = await import('@deepseek-ai/dsh-app-boot')
const { PluginManager } = await import('@deepseek-ai/dsh-plugin-manager')
const root = fileURLToPath(new URL('..', import.meta.url))
const home = await mkdtemp(join(tmpdir(), 'dsh-checkin-registration-'))
const dir = join(home, 'profiles/web')
try {
  await mkdir(join(dir, 'node_modules'), { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: 'registration-test',
    private: true,
    dependencies: { 'dsh-credit-checkin-hub': `link:${root}` },
    dsh: { profile: { bundles: ['dsh-credit-checkin-hub'] } },
  }, null, 2))
  // A user-owned override left over from an older manual install: the bundle
  // supplies the row, this block only carries custom configuration.
  await writeFile(join(dir, 'cordis.patch.yml'), '# BEGIN managed dsh-credit-checkin-hub\n- id: daily-checkin\n  name: dsh-credit-checkin-hub\n  config:\n    time: "11:37"\n    providers: [qoder]\n# END managed dsh-credit-checkin-hub\n')
  await symlink(root, join(dir, 'node_modules/dsh-credit-checkin-hub'), 'dir')
  const manager = Object.assign(Object.create(PluginManager.prototype), {
    profile: { dir, installAnchor: anchor },
    protectsManager: () => false,
    declaredRows: () => ({ rows: [], overrides: [] }),
  })
  const row = (await manager.listBundles()).find(item => item.name === 'dsh-credit-checkin-hub')
  assert.ok(row, 'local package appears in the real desktop plugin inventory')
  assert.equal(row.installed, true); assert.equal(row.enabled, true)
  assert.equal(row.error, undefined)
  assert.equal(row.meta.title.zh, 'dsh-credit-checkin-hub')
  let profile = loadProfileDirectory('dsh', dir, anchor)
  let entries = composeEntries([...profile.layers.map(layer => layer.patches), profile.patches])
  assert.equal(entries.filter(entry => entry.name === 'dsh-credit-checkin-hub').length, 1)
  assert.equal(entries.find(entry => entry.name === 'dsh-credit-checkin-hub').config.time, '11:37')
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  manifest.dsh.profile.bundles = []
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
  profile = loadProfileDirectory('dsh', dir, anchor)
  entries = composeEntries([...profile.layers.map(layer => layer.patches), profile.patches])
  assert.equal(entries.filter(entry => entry.name === 'dsh-credit-checkin-hub').length, 0)
  assert.equal((await manager.listBundles()).find(item => item.name === 'dsh-credit-checkin-hub').enabled, false)
  console.log('PASS: actual desktop inventory discovers local plugin; enabled composes one runner, disabled composes none; custom config preserved')
} finally { await rm(home, { recursive: true, force: true }) }
