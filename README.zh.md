# dsh-workspace-api-key

[English](README.md) | 中文

一个 DeepSeek Harness 插件：为每个工作区单独绑定一把 DeepSeek API key。

DSH 只从一个全局凭据 ref（默认 `DEEPSEEK_API_KEY`）解析 DeepSeek key，于是所有工作区的所有会话花的都是同一把 key。这个插件加了一个面板，让单个工作区可以用自己的 key，这样一把 key 的花费就只落在跑在该工作区里的会话上；没有单独配置的工作区仍然用系统默认。

## 你会得到

- **一行侧栏入口**，叫「API Key 分配」，紧跟在宿主自己的「插件」行下方，点开是全宽页面。
- **按工作区配置的 key** —— 列出 `workspaceRegistry` 服务里注册的全部工作区，各自一个 key 输入框。
- **系统默认卡片** —— 当前生效的 ref、值的来源（`file`、`env` 等）以及打码后的值。
- **测试连接** —— 用该 key 真发一次 `POST <baseURL>/messages`（`max_tokens: 1`），返回 `ok`、`invalid`、`quota`、`rate-limit` 或 `unreachable`。
- **key 失效提醒** —— 401/403 把绑定的 key 标为 `invalid`，402 标为 `quota`，429 标为 `rate-limit`。你下次打开面板时会看到受影响的工作区，并可以选择**重新配置**、**改用系统默认**或**稍后**。
- **一键回退** —— 清空某个条目会删掉生成的凭据 ref，该工作区回到系统默认。

## 实现方式

宿主半边（`lib/index.js`）：

- 每个进程包装一次 `credentials.resolve`（通过 `ctx.effect` 在卸载时还原），而不是去注册第二个同名服务或第二条 provider 路由——对一个已被占用的名字，cordis 不允许这两者；
- 从 `agents.currentInitiator()?.session?.header?.cwd` 取当前会话的目录：agent loop 把整个回合跑在那个异步作用域里，所以解析凭据时这个值是拿得到的；
- 把该目录与 `workspaceRegistry.list()` 做规范化后比对（绝对化、去掉尾部分隔符、Windows 折大小写）；
- 由目录派生出稳定的 ref `DEEPSEEK_API_KEY_WS_<sha1(规范化路径) 前 16 位十六进制大写>`，通过凭据服务写入 key，并在该工作区下返回这个 ref 的值；
- 只改写 provider 真正会读的 ref：默认 ref、每个适配器配置的 `apiKeyEnv`，以及插件自己生成的 ref；其它 ref 原样透传；
- 自己的账本（哪个目录对应哪个 ref、失效标记）落在 `$DSH_HOME/storages/dsh-workspace-api-key.json`；
- 通过 `agent/request-error` waterfall 观察失败，但**从不**返回 `{kind: 'retry'}`——只记录判定结果并 `next()` 放行。

浏览器半边（`lib/client.js`）注册到 `sidebar.panellist` 槽（`order: 1`）与 `main` 槽（key 为 `workspace-api-key`），和 `dsh-skill-mcp-panel` 用的是同一套槽。全部是朴素的 `React.createElement`，没有构建步骤，也不打包任何依赖。

### HTTP 接口（仅限回环）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/wsk-api/state` | 默认 ref 状态、工作区列表、覆盖项、失效标记 |
| GET | `/wsk-api/resolve` | 当前会话 `cwd` 此刻解析到哪个工作区 |
| POST | `/wsk-api/set` | `{path, title, key}` 给该目录绑定 key；`{useDefault: true}` 或空 key 为清除 |
| POST | `/wsk-api/test` | `{path}`（或 `{ref}`、`{key}`）真发一次请求并返回判定 |
| POST | `/wsk-api/clear-flag` | `{path}` 清掉失效/配额标记 |

只接受本机回环调用（`127.0.0.1`、`::1`、`::ffff:127.0.0.1`），且 `Origin` 必须同源或缺失。任何响应都不会包含明文 key，只有掩码。

`/wsk-api/set` 也接受不是注册工作区的目录；这类条目会和它们所属的工作区一起列在面板里。

## 安装

插件被市场收录后，可以直接在「设置 → 插件市场」里一键安装；也可以手动装：

```sh
# 在 profile 目录里，例如 ~/.dsh/profiles/desktop
pnpm add "dsh-workspace-api-key@github:COH2357/dsh-workspace-api-key"
```

然后把 `"dsh-workspace-api-key"` 加进该 profile `package.json` 的 `dsh.profile.bundles`，重启 DSH。本地开发用 link 代替：

```jsonc
"dependencies": { "dsh-workspace-api-key": "link:/path/to/dsh-workspace-api-key" }
```

## 测试

```sh
node test/host.test.mjs     # 55 条断言
node test/client.test.mjs   # 48 条断言
```

两个套件都不需要启动 DSH。宿主套件用一个假 ctx（假的 `credentials`、`workspaceRegistry`、`agents`、`webServer`，以及打桩的 `fetch`）驱动 `apply()`，覆盖 ref 派生、工作区匹配、把第二个适配器的 `apiKeyEnv` 一起重定向、清回默认、401/402/429/5xx 的判定、回环与来源校验、状态落盘。浏览器套件通过一个极小的 `window.__ModuleLoader__` 与自制 React 运行时加载 `lib/client.js`，渲染出面板，断言槽注册、首屏渲染、失效弹窗、保存、测试连接、清标记与返回。

## 要求与限制

- 已在 DSH Desktop 2.0.17（`@deepseek-ai/dsh*` 0.2.0-rc.2、`@deepseek-ai/cordis` 4.0.4）上验证。插件没有运行时依赖，也不 import 任何 `@deepseek-ai/*` 包，只用宿主服务（`credentials`、`workspaceRegistry`、`agents`、`webServer`、`llm`、`settings`）与 Node 内置模块。
- 绑定粒度是目录，作用对象是读取被包装 ref 的任意 provider 路由；不是按会话，也不是按模型。
- key 通过凭据服务存放在 `$DSH_HOME/.credentials.yaml` 的 `refs:` 里，明文，和默认 key 完全一样。它不会被写进会话日志、插件状态文件或插件目录。
- 匹配是规范化之后的文本比较。如果某个会话的 `cwd` 是指向已注册工作区路径的符号链接或 junction，则匹配不上，会走系统默认。
- 卸载插件不会删除已生成的 `*_WS_*` ref，可在「设置 → 模型」里清掉。

## 许可

MIT
