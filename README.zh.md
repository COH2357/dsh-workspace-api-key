# dsh-workspace-api-key

[English](README.md) | 中文

一个 DeepSeek Harness 插件：为每个工作区——必要时也可以为单个会话——单独绑定一把 DeepSeek API key。

DSH 只从一个全局凭据 ref（默认 `DEEPSEEK_API_KEY`）解析 DeepSeek key，于是所有工作区的所有会话花的都是同一把 key。这个插件加了一个面板，让单个工作区、甚至单个会话可以用自己的 key，这样一把 key 的花费就只落在你指定的会话上。没有单独配置的层级继续用上层设置：

```
会话 key  →  工作区 key  →  系统默认
```

## 你会得到

- **一行侧栏入口**，叫「API Key 分配」，紧跟在宿主自己的「插件」行下方，点开是全宽页面。
- **按工作区配置的 key** —— 列出 `workspaceRegistry` 服务里注册的全部工作区，各自一个 key 输入框。
- **按会话配置的 key** —— 每个工作区行可以展开（默认折叠），列出该目录下的会话，每个会话有自己的 key；从上层继承的会话会如实标注层级，而不是假装自己配了 key。
- **系统默认卡片** —— 当前生效的 ref、值的来源（`file`、`env` 等）以及打码后的值。
- **测试连接** —— 用该 key 真发一次 `POST <baseURL>/messages`（`max_tokens: 1`），返回 `ok`、`invalid`、`quota`、`rate-limit` 或 `unreachable`；测试成功会顺手清掉失效标记。
- **key 失效提醒** —— 401/403 把绑定的 key 标为 `invalid`，402 标为 `quota`，429 标为 `rate-limit`。当你点进一个生效 key 已失效的会话时，覆盖层会说明情况，并给出**去配置**、**改用上层设置**或**稍后**。
- **不匹配提醒** —— 如果绑 key 时记下的是某个服务商（比如 `deepseek-official`），而该会话现在跑在另一个服务商上，点进这个会话时会提醒你，因为那次请求会拿着对方不认的 key 发出去。
- **绝不悄悄换 key** —— 两种提醒都不会改动实际使用的 key，决定权始终在你手上；自动替换会直接破坏「按会话分离计费」这个初衷。
- **一键回退** —— 清空会话条目回到工作区 key，清空工作区条目回到系统默认。
- **每个工作区一个搜索开关** —— 每个工作区行上都有「同步搜索 API」复选框。勾选后，该目录下会话发出的 `web_search` / `web_fetch` 请求改用它们聊天时用的那把 key（会话 → 工作区 → 系统默认）；不勾选则继续用官方「设置 → 插件 → 网页搜索」里配置的那把 key。会话自己配了 key 时永远优先，所以「工作区同步、会话单独设置」花的是会话那把 key，而不是搜索默认 key。
- **在失败之前就提醒的搜索告警** —— 配了搜索 key 但没打开「启用新版 Web 搜索 API」，或者新版 API 打开了但它的 key ref 是空的，面板会显示提醒条，点进会话时的覆盖层也会用一句可直接照做的话说明；当生效的搜索通道不是新版 API 时，覆盖层不会拿搜索问题打扰你。
- **使用说明** —— 面板顶部有「使用说明」，推荐两把 key 分工：聊天默认用 `default`，搜索默认用 `search-default`，两份预算互不干扰；里面还画了层级，并列出了会触发提醒的几种情况。

## 实现方式

宿主半边（`lib/index.js`）：

- 每个进程包装一次 `credentials.resolve`（通过 `ctx.effect` 在卸载时还原），而不是去注册第二个同名服务或第二条 provider 路由——对一个已被占用的名字，cordis 不允许这两者；
- 从 `agents.currentInitiator()?.session` 取当前会话的目录与 id：agent loop 把整个回合跑在那个异步作用域里，所以解析凭据时这两个值都拿得到，解析器据此选中「有 key 的最具体层级」；
- 把该目录与 `workspaceRegistry.list()` 做规范化后比对（绝对化、去掉尾部分隔符、Windows 折大小写）；
- 由每一层派生出稳定的 ref —— 工作区是 `DEEPSEEK_API_KEY_WS_<sha1(规范化路径) 前 16 位十六进制大写>`，会话是 `DEEPSEEK_API_KEY_SS_<sha1(会话 id) 前 16 位十六进制大写>`（会话 id 含 `-`，不能直接当 ref 名）——通过凭据服务写入 key，并返回这个 ref 的值；
- 只改写 provider 真正会读的 ref：默认 ref、每个适配器配置的 `apiKeyEnv`，以及插件自己生成的 ref；其它 ref 原样透传；
- 把「搜索请求」和「聊天请求」分开。官方新版 Search/Fetch API（`web.searchProvider === 'deepseek-search-api'`）自己解析 key，而它默认读的又是聊天用的 `DEEPSEEK_API_KEY`，所以光看 ref 分不出这次要 key 是为了什么。宿主半边因此把 `ctx.web.search` / `ctx.web.fetch` 包进一个 `AsyncLocalStorage` 作用域，只有当 `credentials.resolve` 在这个作用域里被调用时才套用搜索规则：先看会话自己的 key（永远最优先），再看该工作区有没有勾「同步搜索 API」，勾了就依次用工作区 key、系统默认 key，没勾就用搜索插件配置的那个 ref。旧版基于 Messages 的搜索仍然走原来的聊天层级，因为那条路线本身就是一次 messages 请求；
- 会话列表来自 `sessionController` 服务（`list()`，会拆开它 `{items: […]}` 的信封），控件缺失 / 抛错 / 列表为空时再退到宿主 live 会话服务（`ctx.get('sessions').list()`），所以那种情况下面板仍能列出会话；侧栏藏起来的两种会话这里也藏：子代理会话（`origin: 'subagent'` 或带 `parentSession`）和**空会话**（建了但一句话都没发过，侧栏只显示当前开着的那个）。两种都不过滤的话，一个只有 1 个真实会话的工作区会列出 13 个；
- 不是注册工作区的目录，只有侧栏真的会显示它才会被列出来。这件事宿主判不了：「空会话里只有当前开着的那个算数」是浏览器端才知道的事（`retainedBy.mainView`），所以宿主把这种目录连同每个会话的 `blank` 标记一起发出去，并用 `hiddenBlankDirs` 点名「里面全是空会话」的目录，由浏览器半边套用与侧栏一致的判据；
- `/wsk-api/state` 会带上插件自身版本与会话探针（`available`、`shape`、`source`、`count`、`withoutCwd`、`subagents`、`samples`、`error`，以及工作区路径样本），面板据此说明**为什么**没有列出会话：宿主半边是旧版本（只刷新了页面而没重启应用）、没有 `sessionController`、`list()` 抛错、信封形状不认识，还是会话的 `cwd` 与任何工作区路径都对不上；
- 自己的账本（哪一层对应哪个 ref、失效标记、key 是给哪个服务商记的）落在 `$DSH_HOME/storages/dsh-workspace-api-key.json`；
- 通过 `agent/request-error` waterfall 观察失败，但**从不**返回 `{kind: 'retry'}`——只记录判定结果并 `next()` 放行。

浏览器半边（`lib/client.js`）注册到 `sidebar.panellist` 槽（`order: 1`）、`main` 槽（key 为 `workspace-api-key`）与 `shell.overlay` 槽（点进会话时的提醒），和 `dsh-skill-mcp-panel`、`dsh-429-guard` 用的是同一套槽。全部是朴素的 `React.createElement`，没有构建步骤，也不打包任何依赖。它会把宿主行与浏览器端 `sessions` 存储（`ctx.get('sessions').list.getSnapshot()`，也就是侧栏自己渲染的数据）合并起来，因此标题取自 `displayTitle`，浏览器端只认识一部分会话时也不会把宿主行挤掉，宿主列不出会话时面板也照样有会话可列。这个存储由 `dsh-api-session-controller` 在插件 `apply()` **之后**才提供，所以面板与覆盖层都会为它重试（每 500ms 一次，最多 40 次），而不是首次渲染拿不到就放弃。覆盖层向 `/wsk-api/check?sessionId=…&path=…` 查询当前占据主视图的会话，每个会话最多问一次，它的按钮只负责把你带到面板——改 key 只能由面板里的操作完成。

### HTTP 接口（仅限回环）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/wsk-api/state` | 默认 ref 状态、工作区及其会话、覆盖项、失效标记 |
| GET | `/wsk-api/resolve` | 当前会话此刻解析到哪一层、哪个 ref |
| GET | `/wsk-api/check` | `?sessionId=…&path=…` 只读判定：生效层级、key、失效标记、服务商不匹配、`needsAttention` |
| POST | `/wsk-api/set` | `{scope: 'workspace' \| 'session', path \| sessionId, title, key, provider?}` 绑定 key；`{useDefault: true}` 或空 key 为清除 |
| POST | `/wsk-api/test` | `{scope, path \| sessionId \| ref}`（或 `{key}`）真发一次请求并返回判定；`invalid` 打标记，`ok` 清标记 |
| POST | `/wsk-api/clear-flag` | `{ref}` 或一个目标，清掉失效/配额标记 |
| POST | `/wsk-api/search-sync` | `{path, enabled}` —— 打开或关闭某个工作区的「同步搜索 API」 |

只接受本机回环调用（`127.0.0.1`、`::1`、`::ffff:127.0.0.1`），且 `Origin` 必须同源或缺失。任何响应都不会包含明文 key，只有掩码。

工作区目标也接受不是注册工作区的目录；这类条目会作为「未分组目录」列在面板里，且只列侧栏真的会显示的目录——一个目录里若只有「刚建好、一句话都没发过」的空会话，侧栏不会显示它（空会话里只有当前打开的那个算数），面板也不会列。

## 安装

插件被市场收录后，可以直接在「设置 → 插件市场」里一键安装；也可以从 npm 装：

```sh
# 用 DSH 自带的 CLI 装进某个 profile（web、tui……）。Desktop 自己的 profile
# 由 Electron 应用独占管理，请在它的界面里安装。
dsh plugin --profile web add dsh-workspace-api-key
```

这条命令会把参数原样转交给 profile 目录里的 pnpm，等价的手写形式是：

```sh
# 在 profile 目录里，例如 ~/.dsh/profiles/web
pnpm add dsh-workspace-api-key          # 或者：npm install dsh-workspace-api-key
```

锁版本用 `dsh-workspace-api-key@0.2.8`；直接从仓库装则用 `dsh-workspace-api-key@github:COH2357/dsh-workspace-api-key`（git 来源的插件会在安装时现场构建）。

然后把 `"dsh-workspace-api-key"` 加进该 profile `package.json` 的 `dsh.profile.bundles`，重启 DSH。本地开发用 link 代替：

```jsonc
"dependencies": { "dsh-workspace-api-key": "link:/path/to/dsh-workspace-api-key" }
```

## 测试

```sh
node test/host.test.mjs     # 157 条断言
node test/client.test.mjs   # 162 条断言
```

两个套件都不需要启动 DSH。宿主套件用一个假 ctx（假的 `credentials`、`workspaceRegistry`、`agents`、`sessionController`、`sessions`、`webServer`，以及打桩的 `fetch`）驱动 `apply()`，覆盖 ref 派生、会话→工作区→默认的级联、工作区匹配、把第二个适配器的 `apiKeyEnv` 一起重定向、清回默认、401/402/429/5xx 的判定、回环与来源校验、状态落盘，以及会话探针（含 `{items}` 信封与 live 兜底）。浏览器套件通过一个极小的 `window.__ModuleLoader__` 与自制 React 运行时加载 `lib/client.js`，渲染出面板与覆盖层，断言槽注册、首屏渲染、会话折叠/展开、会话级保存与测试、宿主列不出会话时从浏览器端存储恢复会话（标题取 `displayTitle`、隐藏子代理会话与空会话、浏览器端只认识一部分会话时不挤掉宿主行）、会话列表服务晚于插件提供时的重试、未分组目录卡片、失效与不匹配提醒、「去配置」的交接、没有会话列表时的降级，以及 `ctx.get('layout')` 在插件 apply 之后才可用时返回键仍然有效。宿主套件还带一个假的 `web` 服务与假的设置服务，验证搜索作用域：旧通道沿用聊天层级、新版通道用它自己的 key、工作区开关接管、会话 key 压过两者、两类搜索提醒，以及搜索连接测试。浏览器套件覆盖搜索相关界面：每个工作区行的「同步搜索 API」复选框、它发出的 `/wsk-api/search-sync`、提醒条与「使用说明」弹窗。

## 要求与限制

- 已在 DSH Desktop 2.0.17（`@deepseek-ai/dsh*` 0.2.0-rc.2、`@deepseek-ai/cordis` 4.0.4）上验证。插件没有运行时依赖，也不 import 任何 `@deepseek-ai/*` 包，只用宿主服务（`credentials`、`workspaceRegistry`、`agents`、`sessionController`、`webServer`、`llm`、`settings`）与 Node 内置模块。
- 搜索功能依赖自带官方 Search/Fetch API 的 DSH（`web-deepseek-api`，即「设置 → 插件 → 网页搜索」里那个「启用新版 Web 搜索 API」）。没有这个能力的版本上，插件根本收不到搜索请求：开关照旧显示，面板会如实报告当前是旧版 Messages 通道，而不是瞎猜。
- 每一层只有一把 key：一个会话无论被哪个 provider 路由读取，用的都是同一把 key；key 记下的服务商与会话当前服务商不一致时会被报为「不匹配」，但同一服务商内换模型不算不匹配，因为 DeepSeek key 是账号级的。
- 会话按目录（`cwd`）归入工作区。宿主自己的 `list()` 会跳过从未存过 `cwd` 的历史会话，而 live 兜底只认识当前装载中的会话，所以面板列出的会话可能比侧栏少；只在浏览器端存储里可见的会话，除了侧栏知道的那个 `cwd` 之外没有别的路径信息。
- 「测试连接」说的是 Anthropic Messages 协议（`POST <baseURL>/messages` 带 `x-api-key` 与 `anthropic-version: 2023-06-01`），也就是 DeepSeek 路由用的协议；换了别的协议的 provider 一样可以按层绑 key，只是测试可能把有效的 key 报成失败。
- key 通过凭据服务存放在 `$DSH_HOME/.credentials.yaml` 的 `refs:` 里，明文，和默认 key 完全一样。它不会被写进会话日志、插件状态文件或插件目录。
- 匹配是规范化之后的文本比较。如果某个会话的 `cwd` 是指向已注册工作区路径的符号链接或 junction，则匹配不上，会走上层层级。
- 卸载插件不会删除已生成的 `*_WS_*` / `*_SS_*` ref，可在「设置 → 模型」里清掉。
- 如果面板列出了工作区却没有可展开的会话，请看面板底部的诊断行。出现红色「宿主端插件还是旧版本」横幅，说明 DSH 进程没有重启过：宿主半边只在启动时加载，关窗口和刷新页面都不算——请完全退出 DSH Desktop 再打开。其余情况诊断行会写明宿主看到多少个会话、会话列表来自哪个来源（`sessionController`、live 兜底，还是浏览器端存储）；一个都对不上时，还会并排给出会话 `cwd` 样本与工作区路径样本，便于比对。

## 许可

MIT
