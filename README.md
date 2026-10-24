# 多平台积分签到

DSH Desktop 插件：每天定时替你领取各平台送的每日积分，不用手动点。

支持 **Trae CN、WorkBuddy 国内版、Qoder CN、Qoder 国际版、MiniMax Code 国内版**，默认北京时间 **每天 09:05** 执行。Qoder CN 每天 10:00 才开放新一轮，定时早于 10:00 时只有 Qoder 顺延到 10:00。

已验证版本：**DSH Desktop 0.12.1**，运行时 Node ≥ 22.19.0。

## 安装

本插件还没上传插件市场，用 DSH Desktop 自带的插件页装，不需要 npm，也不用命令行。

1. 打开 DSH Desktop，点左侧栏 **「插件」**。
2. 点 **「添加插件」** → **「安装第三方插件」**。
3. 「包名或地址」填下面任一个：
   - **Git 地址**（推荐）：`https://github.com/SnailMann/dsh-credit-checkin-hub`
   - **本地目录**：克隆下来的仓库根目录绝对路径，必须含 `package.json`
4. 点 **「安装」**，完成后选 **「立即启用」**。当时若直接关掉了对话框，插件已装上但处于关闭状态，去 **「已安装插件」** 分组把开关打开即可。
5. 如果提示需要重启，从菜单栏 **「Harness → 重启」** 重启一次。后台插件只在启动时装配，刷新页面不会重载后台。

装好后在 **「已安装插件」** 里叫 **「多平台积分签到」**。安装只往当前 Profile 登记依赖和组合包，不动 DSH 应用本体，也不影响其他插件。

## 使用

重启后打开 **「设置 → 积分签到」**，或从「插件」页本插件详情页的配置区进入，两处是同一个面板。

- **每日自动签到**：总开关，关掉后暂停定时任务，但仍可手动签到。
- **每日签到时间**：选好时间点「保存时间」，默认北京时间 09:05。
- **平台开关**：五个平台各自独立，关掉的平台自动和手动都会跳过。
- **立即签到已启用平台**：不用等定时任务，已签过的账号自动跳过。
- **最近签到记录**：各平台的执行时间、结果和积分，失败会显示原因。

界面设置即时生效并优先于 YAML 初始值，升级、重装、反复开关都不会重置你选过的时间和平台。

![设置界面（截图中的签到记录为模拟数据）](settings-preview.jpg)

也可以在对话里说「查看每日签到状态」或「立即执行今日签到」，模型会调用 `daily_checkin_status`（只读本地记录）和 `daily_checkin_run`（立即执行）。

## 各平台登录

**Trae CN / WorkBuddy**：直接读本机客户端已登录的账号，不用额外操作。登录过期就打开对应客户端重新登录，再点「立即签到」。

**Qoder CN**：点 **「登录 Qoder CN」→「打开 Qoder CN 官方登录页」**，在浏览器登录并选账号，页面显示「已连接国内版账号」后打开开关。领取要求官方设备验证，所以要装 Qoder CN 桌面端——插件调用它自带的 `runtime-info`，不装 CLI，也不读客户端 `auth.v1.dat` 或 macOS 钥匙串。登录链接 5 分钟有效，过期重新获取即可。

**Qoder 国际版**：在独立卡片点 **「登录 Qoder 国际版」**，到 `qoder.com` 完成官方网页登录，再打开该平台开关。国际版固定走 `openapi.qoder.sh`，与国内版会话、去重和记录完全隔离。同样需要官方设备验证工具，默认用 `/Applications/Qoder.app/Contents/Resources/umid/runtime-info`，可用 `qoderGlobalRuntime` 指定别处。插件不打包也不分发这个二进制，需自行从 Qoder 官方安装包取得。

**MiniMax Code**：点 **「登录 MiniMax Code」**，在 MiniMax 官方授权页完成授权，页面显示「已连接国内版账号」后打开开关。不需要装 MiniMax Code CLI；如果本机已有官方 CLI，插件也会尝试读取 `~/.minimax` 下的国内正式环境登录文件。

## 卸载

**「插件」** 页 → **「已安装插件」** 找到本插件：

- **关闭开关**：停掉定时任务，依赖和设置都保留，随时能再开。
- **卸载**：彻底移除插件，只删插件自己的注册，签到记录和客户端登录态不动。

要清掉签到记录，卸载后再手动删除数据目录里的 `daily-checkin/`。

## 需要知道的事

- **DSH 必须开着，电脑要联网。** 退出 DSH 时不执行；下次启动且已过设定时间会补签当天，但补不了以前的日子。插件不装系统常驻服务。
- 超过签到时间才启动 DSH、或电脑从睡眠恢复，会自动补签当天。
- 网络或服务端临时故障按 5 分钟、30 分钟、2 小时退避重试，当天最多执行 4 次。
- 只读源登录文件；解密后的 token 仅存内存用于官方域名请求，写盘的结果文件权限 `0600`，记录里不留 token、手机号或原始响应。
- Trae / WorkBuddy 的自动发现针对 **macOS 国内版客户端**；Qoder 的设备验证工具目前也只适配 macOS。TRAE、WorkBuddy、MiniMax Code 国际版未支持。
- HTTP 走系统 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`；从 Finder 启动 DSH 时不一定继承终端环境变量。

## 高级配置

日常用界面就够了。要改数据目录、登录文件路径之类，编辑当前 Profile 的 `cordis.patch.yml`（macOS 路径 `~/Library/Application Support/dsh-desktop/harness/profiles/web/cordis.patch.yml`），重启生效。

下面这段是**覆盖**已有组合包的默认配置，不是新增插件。插件页安装时已经登记过组合包，这里再写 `- insert:` 会多出一个签到实例：

```yaml
- id: daily-checkin
  name: dsh-credit-checkin
  config:
    enabled: true
    time: '09:05'
    timezone: Asia/Shanghai
    providers: [trae, workbuddy, qoder, minimax]
    dataDir: /absolute/path/to/dsh-home/daily-checkin
```

`providers` 可只留一个，或设 `[]` 全关。数据目录里存 `settings.json`、`state.json` 和锁文件；MiniMax 授权后多一个 `minimax-auth.json`，Qoder CN 网页登录存 `qoder-auth.json`，国际版单独存 `qoder-global-auth.json`。`settings.json` 里已保存的界面选项会覆盖上面的初始值。

| 配置项 | 用途 |
| --- | --- |
| `traeStorage` / `TRAE_STORAGE_FILE` | Trae CN 的 `User/globalStorage/storage.json` |
| `traeProduct` | Trae CN 的 `product.json`，识别 Code / Work 请求来源 |
| `traeCredentialFile` | 自备的 `{token,userId,deviceId,reqSource}` JSON |
| `workbuddyAuth` / `WORKBUDDY_AUTH_FILE` | WorkBuddy 的 `workbuddy-desktop.info` 或同形 JSON |
| `workbuddyElectron` / `WORKBUDDY_ELECTRON_BIN` | WorkBuddy 自带的 Electron 可执行文件 |
| `qoderAuth` / `QODER_AUTH_FILE` | 兼容用的会话 JSON；不支持加密客户端文件 |
| `qoderRuntime` | Qoder CN 官方 `runtime-info`，默认 `/Applications/Qoder CN.app/Contents/Resources/umid/runtime-info` |
| `qoderCredentialFile` | 可选会话 JSON，支持 `token`/`access_token` 与 `uid`/`user_id`/`id` |
| `qoderGlobalAuth` / `QODER_GLOBAL_AUTH_FILE` | 国际版会话 JSON，必须标 `region: "global"` |
| `qoderGlobalRuntime` | 国际版官方 `runtime-info` 路径 |
| `minimaxHome` | MiniMax Code CLI 数据目录，默认 `~/.minimax` |
| `minimaxCredentialFile` / `MINIMAX_CODE_AUTH_FILE` | 自备的 `{accessToken,realUserID,region:"cn"}` JSON |

## 许可

MIT。byteCrypto 与 WorkBuddy 信封解码部分改编自 MIT 项目 [dsh-connect](https://github.com/yembors64632/dsh-connect)；MiniMax Code 适配参考官方 MIT 项目 [MiniMax-AI/minimax-code](https://github.com/MiniMax-AI/minimax-code)；Qoder 网页登录协议对照官方 npm 包 `@qodercn-ai/qoderclicn` 1.1.72（Apache-2.0，仅阅读未复制代码）。第三方许可声明见 `LICENSE` 末尾。
