import { Runner } from './runner.js'
import { registerWeb } from './web.js'
export const name = 'multi-app-credit-checkin'

export function apply(ctx, config = {}) {
  ctx.effect(() => {
    const runner = new Runner(config, { log: message => ctx.logger.info(`[daily-checkin] ${message}`) })
    runner.start()
    ctx.inject(['webServer'], webCtx => registerWeb(webCtx, runner))
    ctx.inject(['tools'], toolCtx => {
      const tools = toolCtx.get('tools')
      for (const action of ['status', 'run']) {
        tools.register({
          name: `daily_checkin_${action}`,
          timeoutMs: 240000,
          description: action === 'status' ? '查看 Trae CN / WorkBuddy / Qoder CN / Qoder 国际版 / MiniMax Code 每日签到计划和本地记录（不发网络请求）。' : '立即尝试领取 Trae CN / WorkBuddy / Qoder CN / Qoder 国际版 / MiniMax Code 今日签到积分，已签账号跳过。',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
          execute: async () => JSON.stringify(action === 'status' ? await runner.status() : await runner.run({ manual: true })),
        })
      }
    })
    ctx.logger.info(`每日签到已启用：${runner.config.timezone} ${runner.config.time}，运行期间自动执行。`)
    return () => runner.dispose()
  })
}
