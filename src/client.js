window.__ModuleLoader__.load({ id: 'dsh-credit-checkin', factory: require => {
  const React = require('react')
  const e = React.createElement
  const API = '/plugins/dsh-credit-checkin'
  const names = { trae: 'Trae CN', workbuddy: 'WorkBuddy', qoder: 'Qoder CN', 'qoder-global': 'Qoder 国际版', minimax: 'MiniMax Code' }
  const providers = Object.keys(names)
  const labels = { claimed: '签到成功', 'already-claimed': '今日已签到', unavailable: '暂无可领活动', failed: '签到失败' }
  const css = `
.dci{max-width:800px;color:var(--dsw-alias-label-primary,#202124);font:13px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;padding:2px 0 24px}.dci *{box-sizing:border-box}.dci h2{margin:0;font-size:21px;line-height:1.4;font-weight:650;letter-spacing:-.4px}.dci p{margin:5px 0 0}.dci .muted{color:var(--dsw-alias-label-tertiary,#737780)}.dci-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:22px}.dci-badge{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-size:11px;background:var(--dsw-alias-background-secondary,#f4f5f6);border-radius:20px;padding:4px 10px}.dci-badge i{width:6px;height:6px;background:#94989f;border-radius:50%}.dci-badge.on i{background:#249969}.dci-box{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;overflow:hidden;margin-bottom:18px}.dci-row{padding:17px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px}.dci-row+.dci-row{border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb)}.dci-title{font-size:14px;font-weight:600}.dci-desc{font-size:12px;color:var(--dsw-alias-label-tertiary,#737780);margin-top:2px}.dci-switch{display:inline-flex;align-items:center;gap:10px;cursor:pointer}.dci-switch input{appearance:none;-webkit-appearance:none;cursor:pointer;width:36px;height:21px;border:1px solid transparent;border-radius:20px;background:#b7bcc4;margin:0;position:relative;transition:background .15s;flex-shrink:0}.dci-switch input:before{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0002;transition:transform .15s}.dci-switch input:checked{background:#2377df}.dci-switch input:checked:before{transform:translateX(15px)}.dci-switch input:disabled{opacity:.5;cursor:wait}.dci input:focus-visible,.dci button:focus-visible{outline:2px solid #2377df;outline-offset:3px}.dci-time{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dci input[type=time]{font:600 15px ui-monospace,monospace;color:inherit;background:var(--dsw-alias-background-primary,#fff);border:1px solid var(--dsw-alias-border-l2,#dce0e5);border-radius:7px;padding:7px 9px}.dci button{font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#dce0e5);border-radius:7px;background:var(--dsw-alias-background-primary,#fff);color:inherit;padding:7px 12px}.dci button:hover:not(:disabled){background:var(--dsw-alias-background-secondary,#f4f5f6)}.dci button:disabled{opacity:.5;cursor:default}.dci button.primary{background:#2377df;border-color:#2377df;color:#fff}.dci button.primary:hover:not(:disabled){background:#1c65bf}.dci-section{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:21px 0 11px}.dci-section h3{font-size:14px;margin:0;font-weight:600}.dci-platforms{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px}.dci-platform{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;padding:17px}.dci-platform-top{display:flex;align-items:center;gap:10px;margin-bottom:16px}.dci-icon{width:34px;height:34px;display:grid;place-items:center;font-size:17px;font-weight:750;border-radius:9px;background:#edf3fb;color:#2863a8}.dci-icon.minimax{background:#fff0e8;color:#bd6434}.dci-login{margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb)}.dci-login a{color:#2377df;overflow-wrap:anywhere}.dci-login code{font:600 14px ui-monospace,monospace;user-select:all}.dci-login button{margin-top:7px}.dci-icon.qoder,.dci-icon.qoder-global{background:#f0eafd;color:#7351b5}.dci-icon.trae{background:#e8f5ee;color:#217b50}.dci-platform-top strong{font-size:14px}.dci-platform-top .dci-switch{margin-left:auto}.dci-result{font-size:12px;min-height:46px}.dci-result .good{color:#21845d}.dci-result .bad{color:#c8463f}.dci-result small{display:block;color:var(--dsw-alias-label-tertiary,#737780);margin-top:3px;line-height:1.5}.dci-footer{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:15px}.dci-note{font-size:11px;color:var(--dsw-alias-label-tertiary,#737780);margin-top:14px!important;line-height:1.7}.dci-message{border-radius:8px;padding:9px 12px;background:#eff5ff;color:#245a9d;margin-bottom:16px;overflow-wrap:anywhere}.dci-message.error{background:#fff0ee;color:#b34337}.dci-table-wrap{overflow-x:auto;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:10px}.dci table{width:100%;border-collapse:collapse;font-size:12px;text-align:left}.dci th{font-size:11px;color:var(--dsw-alias-label-tertiary,#737780);font-weight:500;background:var(--dsw-alias-background-secondary,#f8f9fa)}.dci th,.dci td{padding:10px 13px;border-bottom:1px solid var(--dsw-alias-border-l2,#eceef1);white-space:nowrap}.dci tr:last-child td{border-bottom:0}.dci .empty{padding:24px;text-align:center;color:var(--dsw-alias-label-tertiary,#737780)}@media(max-width:620px){.dci-header{display:block}.dci-header>.dci-badge{margin-top:10px}.dci-platforms{grid-template-columns:1fr}.dci-row,.dci-footer{flex-wrap:wrap}.dci-time{width:100%}}
`
  function Switch({ label, checked, disabled, onChange }) {
    return e('label', { className: 'dci-switch' }, e('input', { type: 'checkbox', role: 'switch', 'aria-label': label, checked, disabled, onChange: event => onChange(event.target.checked) }))
  }
  function Panel() {
    const [data, setData] = React.useState(null)
    const [draftTime, setDraftTime] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    const [message, setMessage] = React.useState('')
    const [error, setError] = React.useState(false)
    const [loginFeedback, setLoginFeedback] = React.useState(null)
    const alive = React.useRef(true)
    const load = React.useCallback(async () => {
      const response = await fetch(`${API}/status`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw Error(payload.error || '读取签到状态失败。')
      if (alive.current) setData(payload)
      return payload
    }, [])
    React.useEffect(() => {
      alive.current = true
      load().catch(err => { if (alive.current) { setError(true); setMessage(err.message) } })
      const timer = setInterval(() => { if (!document.hidden) load().catch(() => {}) }, [data?.minimax?.status, data?.qoder?.status, data?.['qoder-global']?.status].includes('pending') ? 3000 : 15000)
      return () => { alive.current = false; clearInterval(timer) }
    }, [load, data?.minimax?.status, data?.qoder?.status, data?.['qoder-global']?.status])
    const format = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: data?.schedule.timezone ?? 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : ''
    async function post(path, body) {
      const response = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Checkin-Token': data.token }, body: JSON.stringify(body) })
      const payload = await response.json()
      if (!response.ok) throw Error(response.status === 404 && /^\/(minimax|qoder|qoder-global)\//.test(path) ? '后台插件尚未更新，请点击菜单栏「Harness → 重启」后重试；仅刷新页面不会更新后台。' : payload.error || '操作失败。')
      return payload
    }
    async function save(patch) {
      setBusy(true); setMessage(''); setError(false)
      try {
        const result = await post('/settings', patch)
        if (!alive.current) return
        setData(current => ({ ...current, schedule: result.schedule }))
        if (patch.time) setDraftTime(null)
        setMessage('设置已保存，即时生效。')
      } catch (err) { if (alive.current) { setMessage(err.message); setError(true) } }
      finally { if (alive.current) setBusy(false) }
    }
    async function login(provider, cancel = false) {
      const name = names[provider]
      setBusy(true); setError(false); setMessage('')
      setLoginFeedback({ provider, message: cancel ? '正在取消授权…' : `正在获取 ${name} 官方登录链接…` })
      try {
        const connection = await post(`/${provider}/${cancel ? 'cancel' : 'login'}`, {})
        if (alive.current) {
          setData(current => ({ ...current, [provider]: connection }))
          setLoginFeedback(null)
          setMessage(cancel ? '已取消此次登录。' : `请打开 ${name} 官方登录页，完成后此页会自动更新。`)
        }
      } catch (err) { if (alive.current) { setMessage(err.message); setError(true); setLoginFeedback({ provider, message: err.message, error: true }) } }
      finally { if (alive.current) setBusy(false) }
    }
    function loginBox(provider, enabled) {
      const name = names[provider], connection = data[provider]
      const available = provider === 'qoder-global' ? data.capabilities?.includes('qoder-global-login') : provider === 'qoder' ? data.capabilities?.includes('qoder-desktop-login') : Boolean(connection)
      const feedback = loginFeedback?.provider === provider ? loginFeedback : null
      return e('div', { className: 'dci-login' },
        !available && e('div', { className: 'dci-desc', role: 'alert' }, '请先通过「Harness → 重启」加载新版后台，再登录。'),
        feedback && e('div', { className: `dci-message ${feedback.error ? 'error' : ''}`, role: feedback.error ? 'alert' : 'status' }, feedback.message),
        e('div', { className: 'dci-desc' }, connection?.connection === 'connected' ? `已连接${provider === 'qoder-global' ? '国际版' : '国内版'}账号` : connection?.connection === 'upgrade-required' ? `旧版登录，请重新连接 ${name}` : connection?.connection === 'expired' ? '登录已过期，请重新登录' : `请先连接 ${name} 账号`),
        connection?.status === 'pending' ? e(React.Fragment, null,
          connection.userCode && e('div', { className: 'dci-desc' }, '授权码：', e('code', null, connection.userCode)),
          e('a', { href: connection.verificationUrl, target: '_blank', rel: 'noopener noreferrer' }, `打开 ${name} 官方登录页 ↗`),
          e('div', { className: 'dci-desc' }, `有效至 ${format(connection.expiresAt)}，完成后自动连接。`),
          e('button', { disabled: busy, onClick: () => login(provider, true) }, `取消 ${name} 登录`)) : e(React.Fragment, null,
          connection?.status === 'failed' && e('div', { className: 'dci-desc', role: 'alert' }, connection.message),
          e('button', { disabled: busy || !available, onClick: () => login(provider) }, feedback && busy ? '正在获取登录链接…' : `${connection?.connection === 'connected' ? '重新登录' : '登录'} ${name}`)),
        e('div', { className: 'dci-desc' }, provider === 'qoder-global' ? '使用本机 Qoder 国际版官方设备工具，无需读取客户端钥匙串。' : provider === 'qoder' ? '需已安装 Qoder CN，使用官方设备验证，无需读取客户端钥匙串。' : connection?.connection === 'connected' ? '签到时自动检查并续期登录态。' : enabled ? '请先完成官方授权，已启用的任务才能签到。' : '完成官方授权后，再开启签到开关。'))
    }
    async function run() {
      setBusy(true); setMessage(''); setError(false)
      try {
        const result = await post('/run', {})
        await load()
        if (!alive.current) return
        const failed = Object.values(result.results ?? {}).some(r => r.status === 'failed')
        setError(failed)
        setMessage(result.status === 'busy' ? '已有签到任务正在执行，请稍后刷新。' : result.status === 'no-providers' ? '请先开启至少一个平台。' : failed ? '部分平台未能签到，请查看下方原因。' : '签到检查完成，结果已更新。')
      } catch (err) { if (alive.current) { setMessage(err.message); setError(true) } }
      finally { if (alive.current) setBusy(false) }
    }
    return e('section', { className: 'dci', 'aria-label': '多平台积分签到设置' },
      e('style', null, css),
      e('header', { className: 'dci-header' },
        e('div', null, e('h2', null, '多平台积分签到'), e('p', { className: 'muted' }, 'Trae CN · WorkBuddy · Qoder CN · Qoder 国际版 · MiniMax Code'), e('p', { className: 'muted' }, '设置每日签到时间，选择需要自动领取积分的平台。')),
        data && e('span', { className: `dci-badge ${data.schedule.enabled ? 'on' : ''}` }, e('i'), data.running ? '正在签到' : data.schedule.enabled ? '自动签到已开启' : '自动签到已暂停')),
      message && e('div', { className: `dci-message ${error ? 'error' : ''}`, role: error ? 'alert' : 'status' }, message),
      data && (!data.minimax || !data.capabilities?.includes('qoder-global-login')) && e('div', { className: 'dci-message error', role: 'alert' }, '后台插件尚未更新，部分网页登录暂不可用。请点击菜单栏「Harness → 重启」；仅刷新设置页不会更新后台。'),
      !data ? e('div', { className: 'empty' }, error ? e('button', { onClick: () => load().then(() => setMessage('')).catch(err => setMessage(err.message)) }, '重新加载') : '正在读取设置…') : e(React.Fragment, null,
        e('div', { className: 'dci-box' },
          e('div', { className: 'dci-row' }, e('div', null, e('div', { className: 'dci-title' }, '每日自动签到'), e('div', { className: 'dci-desc' }, '总开关关闭后暂停定时任务，仍可手动签到。')),
            e(Switch, { label: '每日自动签到总开关', checked: data.schedule.enabled, disabled: busy, onChange: enabled => save({ enabled }) })),
          e('div', { className: 'dci-row' }, e('div', null, e('div', { className: 'dci-title' }, '每日签到时间'), e('div', { className: 'dci-desc' }, data.schedule.timezone === 'Asia/Shanghai' ? '北京时间 · 每天执行一次' : `${data.schedule.timezone} · 每天执行一次`)),
            e('div', { className: 'dci-time' }, e('input', { type: 'time', 'aria-label': '每日签到时间', value: draftTime ?? data.schedule.time, disabled: busy, onInput: event => setDraftTime(event.currentTarget.value), onChange: event => setDraftTime(event.target.value) }), e('button', { disabled: busy || !draftTime || draftTime === data.schedule.time, onClick: () => save({ time: draftTime }) }, '保存时间')))),
        e('div', { className: 'dci-section' }, e('h3', null, '签到平台'), e('span', { className: 'muted' }, `已开启 ${data.schedule.providers.length} / ${providers.length}`)),
        e('div', { className: 'dci-platforms' }, providers.map(provider => {
          const enabled = data.schedule.providers.includes(provider), row = data.latest[provider]
          return e('article', { className: 'dci-platform', key: provider },
            e('div', { className: 'dci-platform-top' }, e('span', { className: `dci-icon ${provider}`, 'aria-hidden': true }, provider === 'trae' ? 'T' : ['qoder', 'qoder-global'].includes(provider) ? 'Q' : provider === 'minimax' ? 'M' : 'W'), e('strong', null, names[provider]), e(Switch, { label: `${names[provider]} 签到开关`, checked: enabled, disabled: busy, onChange: checked => save({ providers: providers.filter(p => p === provider ? checked : data.schedule.providers.includes(p)) }) })),
            e('div', { className: 'dci-result' }, e('span', { className: row?.status === 'failed' ? 'bad' : ['claimed', 'already-claimed'].includes(row?.status) ? 'good' : 'muted' }, row ? (row.status === 'already-claimed' ? '已签到' : labels[row.status] ?? row.status) : '尚无签到记录', row?.status === 'claimed' && typeof row.credits === 'number' ? ` · +${row.credits} 积分` : ''),
              e('small', null, row ? `${format(row.at)}${row.status === 'failed' ? ` · ${row.message}` : ''}` : '首次执行后在这里查看结果。')),
            e('div', { className: 'dci-desc', style: { marginTop: 10 } }, enabled ? '已加入签到任务' : '已关闭，自动与手动签到均跳过'), ['qoder', 'qoder-global'].includes(provider) && e('div', { className: 'dci-desc' }, '北京时间 10:00 开放新一轮，定时早于 10:00 时顺延。'),
            ['qoder', 'qoder-global', 'minimax'].includes(provider) && loginBox(provider, enabled),
            ['trae', 'workbuddy'].includes(provider) && e('div', { className: 'dci-desc', style: { marginTop: 10 } }, `授权来源：复用本机 ${names[provider]} 客户端已保存的登录态。`))

        })),
        e('div', { className: 'dci-footer' }, e('span', { className: 'muted' }, '平台开关修改后自动保存。'), e('button', { className: 'primary', disabled: busy || data.running || !data.schedule.providers.length, onClick: run }, busy ? '正在处理…' : '立即签到已启用平台')),
        e('p', { className: 'dci-note' }, '请保持 DSH 运行并联网。错过设定时间会在恢复运行后补签当天；已签到的平台自动跳过。登录过期或需验证时，请在对应客户端处理；Qoder CN / Qoder 国际版 / MiniMax Code 可在此页重新登录。'),
        e('div', { className: 'dci-section' }, e('h3', null, '最近签到记录'), e('button', { disabled: busy, onClick: () => load().then(() => { setMessage('状态已刷新。'); setError(false) }).catch(err => { setMessage(err.message); setError(true) }) }, '刷新状态')),
        e('div', { className: 'dci-table-wrap' }, data.history.length ? e('table', null, e('thead', null, e('tr', null, ['时间', '平台', '结果', '积分'].map(text => e('th', { key: text, scope: 'col' }, text)))), e('tbody', null, data.history.map((row, i) => e('tr', { key: `${row.at}-${row.provider}-${i}` }, e('td', null, format(row.at)), e('td', null, names[row.provider] ?? row.provider), e('td', { title: row.message }, row.status === 'already-claimed' ? '已签到' : labels[row.status] ?? row.status), e('td', null, row.status === 'claimed' && typeof row.credits === 'number' ? `+${row.credits}` : '—'))))) : e('div', { className: 'empty' }, '还没有签到记录。'))))
  }
  function apply(ctx) {
    ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'credit-checkin', order: 35, label: () => '积分签到' }, Panel))
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-credit-checkin' }, Panel))
  }
  return { name: 'multi-app-credit-checkin-settings', inject: ['slots'], apply }
} })
