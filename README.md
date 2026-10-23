# 多平台积分签到

DSH Desktop 插件，支持 **Trae CN、WorkBuddy 国内版、Qoder CN、Qoder 国际版和 MiniMax Code 国内版**，默认北京时间 **每天 09:05** 自动领取签到积分。Qoder CN 每天 10:00 开放新一轮领取，定时早于 10:00 时仅 Qoder 顺延到 10:00。Trae / WorkBuddy 使用客户端已登录账号；Qoder CN / Qoder 国际版 / MiniMax Code 使用设置页中的独立网页登录，不需要把 token 贴到对话里。

已验证版本：**DSH Desktop 0.12.1**（插件登记、组合包启用/关闭、真实 PluginManager 识别与配置合成已实测，见「验证」），运行时 Node ≥ 22.19.0。

## 安装

本插件尚未上传插件市场，用 DSH Desktop 自带的插件页安装，不需要 npm、不需要命令行：

1. 打开 DSH Desktop，点左侧栏的 **「插件」**。
2. 点右上角 **「添加插件」** → **「安装第三方插件」**。
3. 在「包名或地址」里填安装源，二选一：
   - **本地目录**：本仓库的绝对路径，例如 `/Users/you/Desktop/develop/dsh-credit-checkin-hub`，必须是含 `package.json` 的仓库根目录。
   - **Git 地址**：`https://github.com/SnailMann/dsh-credit-checkin-hub`，仓库需公开，且本机能访问 GitHub。
4. 点 **「安装」**，完成后选 **「立即启用」**。如果当时直接关掉了对话框，插件已安装但处于关闭状态，到 **「已安装插件」** 分组里打开它的开关即可。
5. 如果插件页提示 **「请重启 DSH 使更改生效」**，从菜单栏 **「Harness → 重启」** 重启一次；后台插件只在启动或重新组合时装配，仅刷新页面不会重载后台。

装好后 **「已安装插件」** 分组里的显示名是 **「Trae CN / WorkBuddy / Qoder CN / Qoder 国际版 / MiniMax Code 积分签到」**。安装只向当前 Profile 登记依赖与组合包（本地目录登记为 `link:`），不改动 DSH 应用包，也不影响其他插件。

> 从旧版本升级：早期版本用 `npm run install:dsh` 手写过 `cordis.patch.yml` 的管理块，那个脚本已移除。如果 profile 的 `cordis.patch.yml` 里还留着 `# BEGIN managed dsh-daily-checkin` 段或 `- insert:` 条目，先删掉它再按上面步骤重装，否则会出现第二个签到实例。用插件页重装也是升级的唯一方式：插件页对其他插件只提供「卸载」，没有「更新」。

## 设置

重启后打开 **「设置 → 积分签到」**；也可以从「插件」页本插件详情页里的配置区进入，两处是同一个面板。

- **每日自动签到**：总开关，关闭后暂停定时任务，仍允许点「立即签到」。
- **每日签到时间**：选时间后点「保存时间」，默认北京时间 09:05。
- **平台开关**：Trae CN、WorkBuddy、Qoder CN、Qoder 国际版、MiniMax Code 各自独立，可任意组合。关闭的平台在自动和手动签到时都会跳过。
- **立即签到已启用平台**：不必等定时任务，已签到的账号自动跳过。
- **最近签到记录**：各平台执行时间、结果和积分；失败时卡片显示原因。

开关修改即时保存，时间需点保存；设置写进数据目录的 `settings.json`，下次启动继续使用。界面设置优先于 YAML 里的初始值。升级、重装、重开开关都不会重置你选过的时间和平台。

![设置界面（截图中的签到记录为模拟数据）](settings-preview.jpg)

## 各平台登录

**Trae CN / WorkBuddy**：自动读取本机客户端已登录账号，无需登录操作。登录过期时打开对应客户端完成登录/刷新，再点「立即签到」。平台若要求设备验证，需在客户端完成。

**Qoder CN**：点 **「登录 Qoder CN」→「打开 Qoder CN 官方登录页」**，在浏览器完成登录并选择账号，页面显示「已连接国内版账号」后打开开关。每日活动要求官方设备验证，因此需安装 Qoder CN 桌面端：插件调用其自带 `runtime-info` 工具，不安装 CLI，也不读取客户端 `auth.v1.dat` 或 macOS 钥匙串。登录链接 5 分钟有效，可取消后重新获取。按北京时间 **10:00 至次日 10:00** 为一轮去重；10:00 前手动领过上一轮，不会阻止 10:00 后领新一轮。仅当活动返回明确可领的积分项才提交，领取后复查同一活动标记为已领；「没活动」「已过期」不算签到成功。活动规则见 [Qoder CN 每日领取 100 Credits](https://docs.qoder.cn/events/100credits)。

**Qoder 国际版**：在独立卡片点 **「登录 Qoder 国际版」**，到 `qoder.com` 完成官方网页登录，再打开该平台开关。国际版固定使用 `openapi.qoder.sh`，不读取国内版的 token、刷新令牌或设备缓存；会话独立存在 `qoder-global-auth.json`，去重与记录也独立。领取同样需要官方设备验证工具，默认用 `/Applications/Qoder.app/Contents/Resources/umid/runtime-info`，可用 `qoderGlobalRuntime` 指定其他位置。插件 npm 包不包含、不分发该二进制，需自行从 Qoder 官方安装包提取。国际版按官方配置传环境参数 `3`，国内版为 `0`，不会拿国内版设备凭据去请求国际版。规则见 [Qoder 国际版每日领取 100 Credits](https://docs.qoder.com/events/100credits)，实际积分以接口返回为准。

**MiniMax Code**：点 **「登录 MiniMax Code」**，在 **MiniMax 官方授权页**按提示完成授权，页面显示「已连接国内版账号」后打开开关。无需安装 MiniMax Code CLI；如已用官方 CLI，插件也会尝试读取 `~/.minimax` 下国内正式环境的登录文件。仅在服务端返回明确领取回执后记录成功，返回的 `points` 已含 `bonus_points`，不重复相加。规则见 [MiniMax Code 官方积分说明](https://agent.minimax.cn/docs/code/account/usage)。

## 运行行为

- 定时执行，不依赖聊天、模型调用或打开面板。
- 超过签到时间才启动 DSH、或电脑从睡眠恢复时，自动补签当天。
- 成功后按账号持久化去重；CLI、多个 Profile 和插件共用数据目录时用文件锁。
- 网络、限流及服务端临时故障在 5 分钟、30 分钟、2 小时后重试，当天自动执行最多 4 次。
- Qoder 未返回每日活动时按同样退避复查；手动签到可重新查询此前「暂无活动」。登录失效、验证要求和未知业务错误会记录原因，避免反复请求。
- 记录保留最近 100 次，不记录 token、手机号或接口原始响应。

**DSH 必须保持运行，电脑需要联网。** 退出 DSH 时不执行；下次启动且超过设定时间后补签当天，无法补领以前日期。插件不安装系统常驻服务。

### 升级后提示「接口不存在」

这表示页面已加载新版，而后台仍是旧插件。用菜单栏 **「Harness → 重启」** 重载后台；仅关闭面板、刷新页面或关窗口不会重载后台插件。重启前先结束正在执行的任务。

## 查看与立即签到

对话里说「查看每日签到状态」或「立即执行今日签到」，模型可调用：

| 工具 | 行为 |
| --- | --- |
| `daily_checkin_status` | 只读本地记录与计划，不发网络请求 |
| `daily_checkin_run` | 立即执行，已成功记录的账号跳过，允许重试之前失败 |

不经过模型也可执行（在仓库源码目录里先 `npm install`，需要 Node ≥ 22.19.0）：

```sh
npm run doctor   # 只检查本地登录文件，不发网络请求、不输出 token
npm run checkin  # 立即签到
npm run status   # 查看计划和记录
```

结果里 `claimed` 表示服务端确认领取，`already-claimed` 今日已签，`unavailable` 无活动或不满足条件，`failed` 未能确认成功。积分来自服务端，不承诺固定每日额度。

## 高级配置

日常用界面即可。需要改数据目录、登录文件等时，编辑当前 Profile 的 `cordis.patch.yml`（macOS：`~/Library/Application Support/dsh-desktop/harness/profiles/web/cordis.patch.yml`），重启生效。

下面这段是**覆盖**，用来改组合包给出的默认配置，不是新增插件——插件页安装时已经登记过组合包，这里不要再写 `- insert:`，否则会多出一个签到实例：

```yaml
- id: daily-checkin
  name: dsh-daily-checkin
  config:
    enabled: true
    time: '09:05'
    timezone: Asia/Shanghai
    providers: [trae, workbuddy, qoder, minimax]
    dataDir: /absolute/path/to/dsh-home/daily-checkin
```

`providers` 可只留一个，或设 `[]` 全部关闭。`dataDir` 保存 `settings.json`、`state.json` 和锁文件；MiniMax 授权后另有 `minimax-auth.json`，Qoder CN 网页登录存 `qoder-auth.json`，国际版独立存 `qoder-global-auth.json`。CLI 默认用 `DSH_HOME/daily-checkin`；macOS 装了 DSH Desktop 时自动识别其 Harness 目录，否则用 `~/.dsh/daily-checkin`。也可存成 JSON 后 `node src/cli.js run --config /path/to/config.json`，或用 `--data-dir` 覆盖目录。`settings.json` 里已保存的界面选项会覆盖这些初始值。

| 配置项 | 用途 |
| --- | --- |
| `traeStorage` / `TRAE_STORAGE_FILE` | Trae CN 的 `User/globalStorage/storage.json` |
| `traeProduct` | Trae CN 的 `product.json`，识别 Code / Work 请求来源 |
| `traeCredentialFile` | 自备的 `{token,userId,deviceId,reqSource}` JSON |
| `traeReqSource` | `1` 为 Trae Code，`2` 为 Trae Work；优先自动识别 |
| `workbuddyAuth` / `WORKBUDDY_AUTH_FILE` | WorkBuddy 的 `workbuddy-desktop.info` 或同形 JSON |
| `workbuddyElectron` / `WORKBUDDY_ELECTRON_BIN` | WorkBuddy 自带的 Electron 可执行文件 |
| `qoderAuth` / `QODER_AUTH_FILE` | 兼容用的会话 JSON 路径；不支持加密客户端文件 |
| `qoderRuntime` | macOS Qoder CN 官方 `runtime-info` 路径，默认 `/Applications/Qoder CN.app/Contents/Resources/umid/runtime-info` |
| `qoderCredentialFile` | 可选会话 JSON，支持 `token`/`access_token` 与 `uid`/`user_id`/`id`；执行时向官方验证账号 |
| `qoderGlobalCredentialFile` / `qoderGlobalAuth` / `QODER_GLOBAL_AUTH_FILE` | 国际版显式会话 JSON，必须标 `region: "global"`，不回退读国内版 |
| `qoderGlobalRuntime` | 国际版官方 `runtime-info` 路径，不影响国内版 |
| `minimaxHome` | MiniMax Code CLI 数据目录，默认 `~/.minimax`，只读国内正式环境 |
| `minimaxCredentialFile` / `MINIMAX_CODE_AUTH_FILE` | 自备的 `{accessToken,realUserID,region:"cn",expiresAtMs?}` JSON，优先于页面授权 |

Trae / WorkBuddy 的自动发现针对 **macOS 国内版客户端**，已做真实请求验证。Qoder / MiniMax 的网页登录不依赖 macOS 钥匙串；Qoder 每日领取的设备验证工具目前只适配 macOS。其他系统仍需验证宿主兼容性和登录文件路径。TRAE、WorkBuddy、MiniMax Code 国际版未支持。

HTTP 走系统 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`。DSH Desktop 从 Finder 启动时未必继承终端环境变量，需确保 DSH 进程本身能访问各平台官方服务。

## 登录态与边界

源登录文件仅读取。Trae 在内存中解开 byteCrypto 登录信封，优先取当前数字设备号；WorkBuddy 必要时用自己客户端的原生存储助手解密。解密后的 token 只在内存中用于官方域名请求，结果文件权限 `0600`。

Qoder CN 用独立网页登录与桌面端登录身份，旧版钥匙串读取和客户端解密逻辑已移除。访问令牌、刷新令牌、官方验证后的账号 ID 和随机设备 ID 存于数据目录 `qoder-auth.json`（`0600`），只向固定 Qoder 官方域名发送；到期用设备刷新接口续期并校验账号一致。页面接口、工具输出和签到记录都不返回这些令牌。每日活动请求用已安装 Qoder CN 的官方 `runtime-info 0 --account-stdin` 生成设备信息，账号 ID 走标准输入不进进程参数；只保留三个必要设备字段，内存按账号缓存 50 分钟，不落盘。工具有 25 秒超时和输出限制；缺工具或验证失败会给出具体原因，不再误报「无活动」。

**Trae / WorkBuddy 的登录态由客户端续期**：插件每次读取最新文件。平台接口来自客户端实现，后续版本可能变化，届时需要适配。

MiniMax Code 用官方 OAuth 设备授权 + PKCE，只请求 `agent.default`。授权并验证身份后，令牌存 `minimax-auth.json`（`0600`），用于定时签到和执行前续期，不出现在页面 API、工具输出或记录中。官方 CLI 凭据始终只读；CLI 登录过期请在设置页重新授权。撤销授权请用 MiniMax 官方账号管理，页面「取消登录」只取消当前未完成的授权流程。

## 卸载

在 **「插件」** 页 → **「已安装插件」** 分组找到本插件：

- **关闭开关**：停用组合包，定时任务停止，依赖与设置都保留，随时可以再打开。
- **卸载**：彻底移除插件，会弹确认框；卸载只移除插件自身的注册，签到记录和客户端登录态保留。

两种操作后如果提示需要重启，用菜单栏 **「Harness → 重启」** 重启一次。要清掉签到记录，再手动删除数据目录里的 `daily-checkin/`。

## 验证

```sh
npm test
ELECTRON_RUN_AS_NODE=1 '/Applications/DSH Desktop.app/Contents/MacOS/DSH Desktop' test/host-registration.mjs
ELECTRON_RUN_AS_NODE=1 '/Applications/DSH Desktop.app/Contents/MacOS/DSH Desktop' test/host-cordis.mjs
```

- 离线测试 78 项（`npm test`，8 个测试文件）：多平台领取判定、已签/无活动/异常回执、MiniMax 奖励去重与 PKCE 授权、Qoder 两区登录与跨区凭据拒绝、10:00 换轮、设备环境参数、去重、退避与手动复查、Web 路由来源保护。
- 2026-10-24 在 DSH Desktop 0.12.1 上实测：用 Desktop 自带运行时按插件页同一路径注册（`link:` 依赖 + `dsh.profile.bundles`，另测 `git+file://` 地址）后，真实 PluginManager 把本包识别为已安装、已启用，组合包只生成一个签到实例；关闭组合包后不再生成实例；用户原有的时间、平台和自定义路径保留。
- 真实领取：Trae CN 领取成功（`credits` 100，复查确认已签）；WorkBuddy 返回「今天已签到」被正确识别；Qoder CN 于 2026-10-17 经用户真实网页登录后完成领取，活动由 `CLAIMABLE` 变为 `CLAIMED`，记录 `credits: 100`。
- 未验证：MiniMax Code 真实账号授权与领取（授权链接生成已通过真实网络验证）；Qoder 国际版真实领取（网页登录和官方身份校验已通过，本机官方设备工具初始化返回 `sgsdk init callback timed out after 20s`，开系统 HTTPS 代理仍复现）。插件会明确记录失败，不把网页登录成功或模拟记录当成到账。

## 许可与致谢

MIT。byteCrypto 与 WorkBuddy 信封解码部分改编自 MIT 项目 [dsh-connect](https://github.com/yembors64632/dsh-connect)；MiniMax Code 适配参考官方 MIT 项目 [MiniMax-AI/minimax-code](https://github.com/MiniMax-AI/minimax-code)；Qoder 设备网页登录协议对照官方 npm 包 `@qodercn-ai/qoderclicn` 1.1.72（Apache-2.0，仅阅读未执行）。详见 `NOTICE.md`、`THIRD-PARTY-LICENSE`、`MINIMAX-LICENSE`、`QODER-LICENSE`。
