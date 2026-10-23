// Fixed official endpoints: credentials never choose their own request host.
export const QODER_DESKTOP_CLIENT = '732aef47-9cf2-46a2-95fe-4cebb5d0d1fa'
const sites = {
  cn: { region: 'cn', provider: 'qoder', name: 'Qoder CN', accountLabel: '国内版', api: 'https://openapi.qoder.com.cn', site: 'https://qoder.cn', filename: 'qoder-auth.json', credentialKey: 'qoderCredentialFile', authKey: 'qoderAuth', authEnv: 'QODER_AUTH_FILE', runtimeKey: 'qoderRuntime', runtime: '/Applications/Qoder CN.app/Contents/Resources/umid/runtime-info', deviceEnvironment: '0' },
  global: { region: 'global', provider: 'qoder-global', name: 'Qoder 国际版', accountLabel: '国际版', api: 'https://openapi.qoder.sh', site: 'https://qoder.com', filename: 'qoder-global-auth.json', credentialKey: 'qoderGlobalCredentialFile', authKey: 'qoderGlobalAuth', authEnv: 'QODER_GLOBAL_AUTH_FILE', runtimeKey: 'qoderGlobalRuntime', runtime: '/Applications/Qoder.app/Contents/Resources/umid/runtime-info', deviceEnvironment: '3', redirectUri: 'qoder-app://' },
}
for (const site of Object.values(sites)) Object.freeze(site)
export function qoderSite(region = 'cn') {
  if (!Object.hasOwn(sites, region)) throw new Error('Unsupported Qoder region')
  return sites[region]
}
