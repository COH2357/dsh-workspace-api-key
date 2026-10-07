/**
 * dsh-workspace-api-key — host half.
 *
 * 目标：让「某个工作区只用某一把 API key」成为可能，从而让计费可按工作区隔离。
 *
 * 机制（方案 1：包装 `credentials.resolve`）：
 *   1. 内置的 `@deepseek-ai/dsh-llm-deepseek-api-key` 每次请求都会拿 provider
 *      profile 里的 `apiKeyEnv`（默认 "DEEPSEEK_API_KEY"）去调
 *      `credentials.resolve(ref)` 取 key；`connection` 里没有任何 per-session
 *      维度（见 dsh-llm-deepseek/lib/index.js:2100-2106、dsh-llm/lib/typert.host.js:1861）。
 *   2. 所以在 `resolve()` 这一层做映射：取「当前正在跑的那个 agent」的
 *      `session.header.cwd`，反查工作区，若该工作区配了专属 key，就用专属 ref
 *      去解析；否则原样回退 → 「没特殊设置就用系统默认」。
 *   3. `currentInitiator()` 是官方自己的做法（先例：
 *      dsh-web-search-deepseek/lib/index.js:302-325 在请求期用
 *      `ctx.get("agents").currentInitiator().session.requestContext()`）。
 *
 * 为什么是 monkey-patch 而不是替换服务：cordis 不允许第二个插件 provide 同名
 * 服务（`service "credentials" has been registered at <...>`，
 * cordis/lib/index.js:813），也不允许跨 fiber `ctx.set`（:786）。而
 * `ctx.get()` 返回的是 traceable proxy，其 `set` trap 是
 * `Reflect.set(target, prop, value, shadow)`、`get` trap 先读 own property
 * （cordis/lib/index.js:123-158），所以在实例上重新赋值 `resolve` 是**所有调用方
 * 都能看到**的，且用 `ctx.effect` 可以干净还原。
 *
 * 安全/稳健性约束：
 *   - wrapper 永不抛异常：内部任何失败都回退到原始 resolve。
 *   - 只拦「provider 真的会去读的 ref」，其它 ref 直接放行。
 *   - 只在 ALS 作用域里有活动 agent 时才做映射；没有就放行（后台请求等）。
 *   - 幂等：重复 apply 不会套娃（用 globalThis 上的 Symbol 记录）。
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, dirname, basename, resolve as pathResolve } from 'node:path'

export const name = 'workspace-api-key'

// cordis 的 `inject` 只支持「字符串数组」或「服务名 → 拦截配置」的对象映射
// （cordis/lib/index.js:1491-1499 `Inject.resolve`）。写成 `{required, optional}`
// 会被当成两个名叫 required/optional 的服务，插件永远停在
// "pending (waiting for services: required, optional)"。
// 这里四个都必须就位才激活：credentials 决定包装能否装上（installResolver 里
// 拿不到就直接 return），webServer 决定配置界面能否注册路由，agents 决定能否
// 读当前会话的 cwd，workspaceRegistry 决定 cwd 能否反查到工作区。
export const inject = ['webServer', 'credentials', 'agents', 'workspaceRegistry']

const API_BASE = '/wsk-api'
const TIMEOUT_MS = 20000
const DEBUG = process.env.WSK_DEBUG === '1'

// 幂等标记：同一进程里可能被 apply 多次（热重载），只装一层 wrapper。
const INSTALL_KEY = Symbol.for('dsh-workspace-api-key/installed')

function log(...args) {
  if (DEBUG) console.log('[workspace-api-key]', ...args)
}

// ─────────────────────────── 路径 / 工作区键 ───────────────────────────

/** 统一的路径比较用规范形：绝对化 + 分隔符统一 + Windows 折大小写。 */
function normPath(p) {
  if (typeof p !== 'string' || p === '') return undefined
  let s = p
  try {
    s = pathResolve(s)
  } catch {
    /* 非法路径：退回原字符串 */
  }
  s = s.replace(/[/\\]+$/, '')
  if (process.platform === 'win32') s = s.toLowerCase()
  return s
}

/**
 * 由「所属目录」派生稳定的凭据 ref。
 * 用「路径」而不是「工作区 id」来派生：未分组会话（没有工作区）也能自然拥有
 * 自己的覆盖项，且工作区被删除重建后仍然认得出同一把 key。
 */
function derivedRef(dir) {
  const norm = normPath(dir)
  if (norm === undefined) return undefined
  const digest = createHash('sha1').update(norm).digest('hex').slice(0, 16).toUpperCase()
  return `DEEPSEEK_API_KEY_WS_${digest}`
}

/** 当前正在执行的那个 agent（ALS 作用域内可达）。 */
function activeAgent(ctx) {
  try {
    const agents = ctx.get('agents')
    if (agents === undefined || typeof agents.currentInitiator !== 'function') return undefined
    return agents.currentInitiator() ?? undefined
  } catch {
    return undefined
  }
}

/** 当前请求所属的目录（工作区路径）。 */
function activeCwd(ctx) {
  const agent = activeAgent(ctx)
  const session = agent?.session
  const cwd = session?.header?.cwd ?? session?.requestHeader?.()?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

/** 所有已注册工作区：规范路径 → 展示信息。 */
function workspaceIndex(ctx) {
  const index = new Map()
  let registry
  try {
    registry = ctx.get('workspaceRegistry')
  } catch {
    registry = undefined
  }
  if (registry === undefined || typeof registry.list !== 'function') return index
  let list = []
  try {
    list = registry.list() ?? []
  } catch {
    return index
  }
  for (const entity of list) {
    let path, title, id
    try {
      path = entity?.path
      title = entity?.title
      id = entity?.id
    } catch {
      continue
    }
    const norm = normPath(path)
    if (norm === undefined) continue
    index.set(norm, {
      id: typeof id === 'string' ? id : undefined,
      path,
      title: typeof title === 'string' && title !== '' ? title : basename(path) || path,
    })
  }
  return index
}

/** cwd → 工作区描述；没有匹配工作区时回退成「以该目录为单位」。 */
function locateWorkspace(ctx, cwd) {
  if (cwd === undefined) return undefined
  const norm = normPath(cwd)
  if (norm === undefined) return undefined
  const hit = workspaceIndex(ctx).get(norm)
  if (hit !== undefined) return { ...hit, kind: 'workspace' }
  return { id: undefined, path: cwd, title: basename(cwd) || cwd, kind: 'directory' }
}

// ─────────────────────────── 覆盖配置（落盘） ───────────────────────────

function stateFilePath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'storages', 'dsh-workspace-api-key.json')
}

function loadState() {
  const path = stateFilePath()
  try {
    if (!existsSync(path)) return { version: 1, overrides: {}, invalid: {} }
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return {
      version: 1,
      overrides: typeof parsed?.overrides === 'object' && parsed.overrides !== null ? parsed.overrides : {},
      invalid: typeof parsed?.invalid === 'object' && parsed.invalid !== null ? parsed.invalid : {},
    }
  } catch (err) {
    console.warn('[workspace-api-key] load state failed:', String(err?.message ?? err))
    return { version: 1, overrides: {}, invalid: {} }
  }
}

function saveState(state) {
  const path = stateFilePath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf8')
    return true
  } catch (err) {
    console.warn('[workspace-api-key] save state failed:', String(err?.message ?? err))
    return false
  }
}

// ─────────────────────────── 凭据读写 ───────────────────────────

async function resolveKey(ctx, ref) {
  if (typeof ref !== 'string' || ref === '') return { value: undefined }
  let credentials
  try {
    credentials = ctx.get('credentials')
  } catch {
    credentials = undefined
  }
  if (credentials === undefined || typeof credentials.resolve !== 'function') return { value: undefined }
  // 插件自己读 key 时必须绕过自己的 wrapper：否则「测试 alpha 的 key」会因为
  // 当前活动会话是 beta 而被重定向成 beta 的 key（本插件 54/55 那条断言抓到的真 bug）。
  const installed = globalThis[INSTALL_KEY]
  const resolve =
    installed !== undefined && installed.credentials === credentials && typeof installed.original === 'function'
      ? installed.original
      : credentials.resolve.bind(credentials)
  try {
    const hit = await resolve(ref)
    return { value: hit?.value, source: hit?.source }
  } catch (err) {
    return { value: undefined, error: String(err?.message ?? err) }
  }
}

async function describeKey(ctx, ref) {
  let credentials
  try {
    credentials = ctx.get('credentials')
  } catch {
    credentials = undefined
  }
  if (credentials === undefined || typeof credentials.describe !== 'function') {
    return { configured: false, error: 'credentials 服务不可用' }
  }
  try {
    const info = await credentials.describe(ref)
    return {
      configured: info?.configured === true,
      source: info?.source,
      writable: info?.writable !== false,
    }
  } catch (err) {
    return { configured: false, error: String(err?.message ?? err) }
  }
}

async function storeKey(ctx, ref, value) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined || typeof credentials.set !== 'function') {
    throw new Error('credentials 服务不可用，无法写入 API key')
  }
  await credentials.set(ref, value)
}

async function clearKey(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined || typeof credentials.unset !== 'function') return
  try {
    await credentials.unset(ref)
  } catch (err) {
    // unset 对不存在的 ref 可能抛错，这里忽略。
    log('unset failed', ref, String(err?.message ?? err))
  }
}

/** key 的前后遮蔽显示形式。 */
function maskKey(value) {
  if (typeof value !== 'string' || value === '') return undefined
  if (value.length <= 10) return `${value.slice(0, 2)}…`
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

/**
 * provider 真正会去读的 ref 集合。
 *
 * 覆盖两层：(1) 全局默认 `DEEPSEEK_API_KEY`；(2) 所有已注册适配器的
 * `dependencies.options().apiKeyEnv`（原生 DeepSeek 适配器与 pi-ai 的每条
 * provider profile 都从这里取 key，见 dsh-llm-deepseek/lib/index.js:2100-2106、
 * dsh-llm-pi-ai/lib/index.js:2557-2563）。另外把所有覆盖 ref 本身也放进去，
 * 保证显式配置过的 ref 一定被拦。
 */
function interceptableRefs(ctx, state) {
  const refs = new Set(['DEEPSEEK_API_KEY'])
  try {
    const llm = ctx.get('llm')
    const adapters = llm?.adapters
    if (adapters !== undefined && typeof adapters.values === 'function') {
      for (const registration of adapters.values()) {
        let options
        try {
          options = registration?.adapter?.dependencies?.options
          options = typeof options === 'function' ? options() : options
        } catch {
          continue
        }
        const ref = options?.apiKeyEnv
        if (typeof ref === 'string' && ref !== '') refs.add(ref)
      }
    }
  } catch {
    /* llm 不可用时只保留默认 ref */
  }
  for (const entry of Object.values(state.overrides)) {
    if (typeof entry?.ref === 'string' && entry.ref !== '') refs.add(entry.ref)
  }
  return refs
}

// ─────────────────────────── 失效判定 ───────────────────────────

function classifyFailure(failure) {
  if (!failure || typeof failure !== 'object') return undefined
  const status = failure.status ?? failure.statusCode
  const code = typeof failure.code === 'string' ? failure.code : ''
  const text = [failure.message, failure.code, failure.requestId]
    .filter((s) => typeof s === 'string')
    .join(' ')
  const causeTexts = []
  let cause = failure.cause
  let guard = 0
  while (cause && guard++ < 6) {
    causeTexts.push(String(cause?.message ?? cause))
    cause = cause?.cause
  }
  const all = `${text} ${causeTexts.join(' ')}`

  if (status === 401 || status === 403) return 'invalid'
  if (/INVALID_CREDENTIAL|UNAUTHORIZED|AUTHENTICATION|MISSING_CREDENTIAL|PERMISSION_DENIED/i.test(`${code} ${all}`)) {
    return 'invalid'
  }
  if (/invalid[_ -]?api[_ -]?key|authentication fails|incorrect api key|api key is invalid|unauthorized/i.test(all)) {
    return 'invalid'
  }
  if (status === 402 || code === 'QUOTA' || /insufficient[_ -]?(balance|quota)|quota[_ -]?(exceeded|exhausted)|balance/i.test(all)) {
    return 'quota'
  }
  if (status === 429 || code === 'RATE_LIMIT' || /\b429\b|rate[\s_-]?limit/i.test(all)) return 'rate-limit'
  return undefined
}

function maskTail(value) {
  if (typeof value !== 'string' || value === '') return undefined
  return value.length <= 4 ? '****' : value.slice(-4)
}

// ─────────────────────────── 测试连接 ───────────────────────────

function sanitizeDetail(text) {
  if (typeof text !== 'string') return undefined
  let out = text
  try {
    const parsed = JSON.parse(text)
    const message = parsed?.error?.message ?? parsed?.message ?? parsed?.error
    if (typeof message === 'string') out = message
  } catch {
    /* 非 JSON：原文 */
  }
  return out
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-****')
    .slice(0, 400)
}

const FALLBACK_BASE_URL = 'https://api.deepseek.com/anthropic'
const FALLBACK_MODEL = 'deepseek-flash'

/**
 * 从已注册适配器里读出真实端点信息。
 *
 * 这是唯一权威来源：`registerDeepSeekProvider` 的 options() 已经合并了 settings
 * 与启动环境变量（见 dsh-llm-deepseek-api-key/lib/index.js 的
 * `resolveAdapterOptions(plainOptions(config), launchEnvironmentOf(ctx))`），
 * 而 `baseURL` 在那边是**未加 `/v1` 的根**（`DeepSeekAdapter` 构造器才做
 * `messagesApiRoot`，见 dsh-llm-deepseek/lib/index.js:650）。
 */
function adapterEndpoint(ctx, preferredProvider) {
  const found = []
  try {
    const llm = ctx.get('llm')
    const adapters = llm?.adapters
    if (adapters !== undefined && typeof adapters.values === 'function') {
      const entries =
        typeof adapters.entries === 'function'
          ? [...adapters.entries()]
          : [...adapters.values()].map((registration) => [undefined, registration])
      for (const [provider, registration] of entries) {
        let options
        try {
          options = registration?.adapter?.dependencies?.options
          options = typeof options === 'function' ? options() : options
        } catch {
          continue
        }
        if (options === undefined || options === null) continue
        const baseURL = typeof options.baseURL === 'string' && options.baseURL !== '' ? options.baseURL : undefined
        const apiKeyEnv = typeof options.apiKeyEnv === 'string' && options.apiKeyEnv !== '' ? options.apiKeyEnv : undefined
        const models = Array.isArray(options.models) ? options.models.filter((m) => typeof m === 'string' && m !== '') : []
        found.push({ provider, baseURL, apiKeyEnv, model: models[0] })
      }
    }
  } catch {
    /* llm 不可用：调用方走兜底 */
  }
  if (preferredProvider !== undefined) {
    const hit = found.find((entry) => entry.provider === preferredProvider)
    if (hit !== undefined && (hit.baseURL !== undefined || hit.apiKeyEnv !== undefined)) return hit
  }
  return found.find((entry) => entry.baseURL !== undefined || entry.apiKeyEnv !== undefined)
}

/** 与 dsh-llm-deepseek/lib/index.js:557-560 逐字同构：缺 `/v1` 就补上。 */
function messagesApiRoot(baseURL) {
  const fallback = FALLBACK_BASE_URL
  if (typeof baseURL !== 'string' || baseURL === '') return fallback
  try {
    const base = baseURL.replace(/\/+$/u, '')
    return new URL(base).pathname.endsWith('/v1') ? base : `${base}/v1`
  } catch {
    return fallback
  }
}

function readBaseURL(ctx) {
  const adapter = adapterEndpoint(ctx, 'deepseek-official')
  if (adapter?.baseURL !== undefined) return adapter.baseURL
  try {
    const settings = ctx.get('settings')
    const value = settings?.get?.('llm-deepseek')?.baseURL ?? settings?.get?.('llm-deepseek-api-key')?.baseURL
    if (typeof value === 'string' && value !== '') return value
  } catch {
    /* 忽略：用默认 */
  }
  return FALLBACK_BASE_URL
}

function readDefaultModel(ctx) {
  try {
    const settings = ctx.get('settings')
    const value = settings?.get?.('agent-default-model')?.model
    if (typeof value === 'string' && value !== '') return value
  } catch {
    /* 忽略 */
  }
  const adapter = adapterEndpoint(ctx, 'deepseek-official')
  if (adapter?.model !== undefined) return adapter.model
  return FALLBACK_MODEL
}

/** 真实打一次最小请求来验证 key。 */
async function probeKey(ctx, key) {
  const root = messagesApiRoot(readBaseURL(ctx))
  const model = readDefaultModel(ctx)
  const started = Date.now()
  let res
  try {
    res = await fetch(`${root}/messages`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    const message = String(err?.message ?? err)
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ok: false,
      verdict: timedOut ? 'unreachable' : 'unreachable',
      status: 0,
      latencyMs: Date.now() - started,
      detail: timedOut ? `请求超时（${TIMEOUT_MS}ms）：${root}` : `${message}（${root}）`,
    }
  }

  const latencyMs = Date.now() - started
  const raw = await res.text().catch(() => '')
  if (res.ok) {
    return { ok: true, verdict: 'ok', status: res.status, latencyMs, detail: '连接正常，key 可用' }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, verdict: 'invalid', status: res.status, latencyMs, detail: sanitizeDetail(raw) ?? 'key 无效（401/403）' }
  }
  if (res.status === 429) {
    return { ok: false, verdict: 'rate-limit', status: res.status, latencyMs, detail: sanitizeDetail(raw) ?? '被限流（429），但 key 本身可能有效' }
  }
  if (res.status === 402) {
    return { ok: false, verdict: 'quota', status: res.status, latencyMs, detail: sanitizeDetail(raw) ?? '余额/配额不足（402）' }
  }
  if (res.status === 400) {
    // 400 通常是请求参数问题（例如模型名），说明鉴权已经通过。
    return { ok: true, verdict: 'ok', status: res.status, latencyMs, detail: `鉴权通过（HTTP 400：${sanitizeDetail(raw) ?? '请求参数被拒'}）` }
  }
  const endpoint = `${root}/messages`
  const hint = res.status === 404 ? `（404：端点 ${endpoint} 不存在，检查 baseURL）` : `（${endpoint}）`
  return { ok: false, verdict: 'error', status: res.status, latencyMs, detail: `${sanitizeDetail(raw) ?? `HTTP ${res.status}`}${hint}` }
}

// ─────────────────────────── 插件主体 ───────────────────────────

export function apply(ctx) {
  const state = loadState()

  // ── 1. 包装 credentials.resolve ──────────────────────────────────────
  installResolver(ctx, state)

  // ── 2. REST API（loopback 可信）──────────────────────────────────────
  let webServer
  try {
    webServer = ctx.get('webServer')
  } catch {
    webServer = undefined
  }
  if (webServer !== undefined && typeof webServer.register === 'function') {
    ctx.effect(() =>
      webServer.register({ kind: 'prefix', path: API_BASE, handler: (req, res) => handle(ctx, state, req, res) }),
    )
    log(`${API_BASE} routes registered`)
  } else {
    console.warn('[workspace-api-key] webServer 服务不可用：配置界面无法工作（key 映射仍然生效）')
  }

  // ── 3. 失效检测：监听请求错误，标记「哪个目录的 key 失效」─────────────
  ctx.effect(() =>
    ctx.on('agent/request-error', async (payload, next) => {
      try {
        const kind = classifyFailure(payload?.failure)
        if (kind === 'invalid') {
          const cwd = payload?.agent?.session?.header?.cwd
          markInvalid(ctx, state, cwd, payload?.failure)
        }
      } catch (err) {
        log('request-error handler failed', String(err?.message ?? err))
      }
      return next()
    }),
  )

  ctx.effect(() => () => {
    saveState(state)
  }, 'workspace-api-key: flush state')

  // 无条件打一行激活日志：桌面端把宿主 console 收进
  // %APPDATA%\DSH Desktop\logs\host\dsh-YYYY-MM-DD.log，
  // 这样「插件到底有没有装上」可以直接从日志判定，不用靠猜。
  console.log(
    `[workspace-api-key] active: routes=${webServer === undefined ? 'unavailable' : API_BASE} overrides=${Object.keys(state.overrides).length} state=${stateFilePath()}`,
  )
}

/**
 * 装上 resolve wrapper。装不上也不能影响宿主：任何异常都吞掉并退回原行为。
 */
function installResolver(ctx, state) {
  if (globalThis[INSTALL_KEY] !== undefined) {
    log('resolver already installed; skipping')
    return
  }
  let credentials
  try {
    credentials = ctx.get('credentials')
  } catch {
    credentials = undefined
  }
  if (credentials === undefined || typeof credentials.resolve !== 'function') {
    console.warn('[workspace-api-key] credentials 服务不可用：无法按工作区切换 key')
    return
  }

  const original = credentials.resolve.bind(credentials)

  const wrapped = async (ref /*, ...rest */) => {
    try {
      if (!interceptableRefs(ctx, state).has(ref)) return await original(ref)
      const cwd = activeCwd(ctx)
      if (cwd === undefined) return await original(ref)
      const ws = locateWorkspace(ctx, cwd)
      if (ws === undefined) return await original(ref)
      const overrideRef = derivedRef(ws.path)
      if (overrideRef === undefined || !state.overrides[overrideRef]) return await original(ref)
      const hit = await original(overrideRef)
      if (hit?.value !== undefined && hit.value !== '') {
        log(`ref ${ref} → ${overrideRef} (${ws.kind}:${ws.title})`)
        return hit
      }
      log(`override ${overrideRef} configured but resolved empty; falling back to ${ref}`)
      return await original(ref)
    } catch (err) {
      log('wrapper fallback:', String(err?.message ?? err))
      try {
        return await original(ref)
      } catch {
        return undefined
      }
    }
  }

  try {
    credentials.resolve = wrapped
    globalThis[INSTALL_KEY] = { wrapped, original, credentials }
    ctx.effect(
      () => () => {
        try {
          credentials.resolve = original
        } catch {
          /* ignore */
        }
        delete globalThis[INSTALL_KEY]
      },
      'workspace-api-key: restore credentials.resolve',
    )
    log('credentials.resolve wrapped')
  } catch (err) {
    console.warn('[workspace-api-key] 包装 credentials.resolve 失败:', String(err?.message ?? err))
  }
}

function markInvalid(ctx, state, cwd, failure) {
  const ws = locateWorkspace(ctx, cwd)
  if (ws === undefined) return
  const ref = derivedRef(ws.path)
  if (ref === undefined || !state.overrides[ref]) return
  const previous = state.invalid[ref]
  if (previous !== undefined && previous.status === 'invalid' && previous.code === failure?.code) return
  state.invalid[ref] = {
    at: new Date().toISOString(),
    status: 'invalid',
    message: String(failure?.message ?? '').slice(0, 500),
    code: failure?.code,
    httpStatus: failure?.status,
    workspacePath: ws.path,
  }
  saveState(state)
  log('marked invalid', ref, ws.title)
}

// ─────────────────────────── HTTP 处理 ───────────────────────────

function isTrusted(req) {
  const ip = req.socket?.remoteAddress
  if (!(ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) return false
  const host = req.headers?.host
  if (typeof host !== 'string' || host === '') return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  const origin = req.headers?.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function readJson(req) {
  const body = await readBody(req)
  if (body === '') return {}
  return JSON.parse(body)
}

async function snapshot(ctx, state) {
  const credentials = ctx.get('credentials')
  const defaultRefName = 'DEEPSEEK_API_KEY'
  const defaultInfo = await describeKey(ctx, defaultRefName)
  const defaultHit = await resolveKey(ctx, defaultRefName)
  const index = workspaceIndex(ctx)
  const workspaces = []
  for (const entity of safeList(ctx)) {
    let id, path, title
    try {
      id = entity?.id
      path = entity?.path
      title = entity?.title
    } catch {
      continue
    }
    if (typeof path !== 'string' || path === '') continue
    const ref = derivedRef(path)
    const configured = ref !== undefined && state.overrides[ref] !== undefined
    const desc = configured ? await describeKey(ctx, ref) : undefined
    const hit = configured ? await resolveKey(ctx, ref) : undefined
    workspaces.push({
      id,
      path,
      title: typeof title === 'string' && title !== '' ? title : basename(path) || path,
      kind: 'workspace',
      ref,
      configured,
      source: desc?.source,
      writable: desc?.writable !== false,
      keyMasked: maskKey(hit?.value),
      invalid: ref !== undefined ? state.invalid[ref] ?? null : null,
      exists: existsSync(path),
    })
  }
  // 有覆盖记录、但对应工作区已不在注册表里的（被删掉的工作区）也列出来，方便清理。
  const knownRefs = new Set(workspaces.map((ws) => ws.ref))
  for (const ref of Object.keys(state.overrides)) {
    if (knownRefs.has(ref)) continue
    const entry = state.overrides[ref]
    const desc = await describeKey(ctx, ref)
    const hit = await resolveKey(ctx, ref)
    workspaces.push({
      id: undefined,
      path: entry.path,
      title: entry.title ?? basename(entry.path ?? '') ?? ref,
      kind: 'orphan',
      ref,
      configured: true,
      source: desc?.source,
      writable: desc?.writable !== false,
      keyMasked: maskKey(hit?.value),
      invalid: state.invalid[ref] ?? null,
      exists: typeof entry.path === 'string' ? existsSync(entry.path) : false,
    })
  }
  return {
    ok: true,
    defaultRef: {
      ref: defaultRefName,
      configured: defaultInfo.configured === true,
      source: defaultInfo.source,
      writable: defaultInfo.writable !== false,
      keyMasked: maskKey(defaultHit?.value),
      error: defaultInfo.error,
    },
    interceptableRefs: [...interceptableRefs(ctx, state)],
    workspaceCount: index.size,
    credentialsAvailable: credentials !== undefined,
    statePath: stateFilePath(),
    workspaces,
  }
}

function safeList(ctx) {
  try {
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined || typeof registry.list !== 'function') return []
    return registry.list() ?? []
  } catch {
    return []
  }
}

async function handle(ctx, state, req, res) {
  if (!isTrusted(req)) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  let url
  try {
    url = new URL(req.url, 'http://localhost')
  } catch {
    res.writeHead(400)
    res.end('bad request')
    return
  }
  const pathname = url.pathname
  const method = req.method ?? 'GET'

  try {
    if (pathname === `${API_BASE}/state` && method === 'GET') {
      sendJson(res, 200, await snapshot(ctx, state))
      return
    }

    if (pathname === `${API_BASE}/resolve` && method === 'GET') {
      const cwd = activeCwd(ctx)
      const ws = locateWorkspace(ctx, cwd)
      const ref = ws !== undefined ? derivedRef(ws.path) : undefined
      sendJson(res, 200, {
        ok: true,
        activeCwd: cwd ?? null,
        workspace: ws ?? null,
        overrideRef: ref ?? null,
        overrideActive: ref !== undefined && state.overrides[ref] !== undefined,
        interceptableRefs: [...interceptableRefs(ctx, state)],
      })
      return
    }

    if (pathname === `${API_BASE}/set` && method === 'POST') {
      const body = await readJson(req)
      const dir = typeof body.path === 'string' ? body.path : undefined
      const title = typeof body.title === 'string' ? body.title : undefined
      const key = typeof body.key === 'string' ? body.key.trim() : ''
      if (dir === undefined || dir === '') {
        sendJson(res, 400, { ok: false, error: '缺少 path' })
        return
      }
      const ref = derivedRef(dir)
      if (ref === undefined) {
        sendJson(res, 400, { ok: false, error: '无法为该路径生成凭据引用' })
        return
      }
      if (body.useDefault === true || key === '') {
        await clearKey(ctx, ref)
        delete state.overrides[ref]
        delete state.invalid[ref]
        saveState(state)
        sendJson(res, 200, { ok: true, cleared: true, ...(await snapshot(ctx, state)) })
        return
      }
      await storeKey(ctx, ref, key)
      state.overrides[ref] = { path: dir, title, ref, at: new Date().toISOString() }
      delete state.invalid[ref]
      saveState(state)
      sendJson(res, 200, { ok: true, ...(await snapshot(ctx, state)) })
      return
    }

    if (pathname === `${API_BASE}/test` && method === 'POST') {
      const body = await readJson(req)
      const dir = typeof body.path === 'string' ? body.path : undefined
      let key = typeof body.key === 'string' && body.key.trim() !== '' ? body.key.trim() : undefined
      let sourceRef = typeof body.ref === 'string' && body.ref !== '' ? body.ref : undefined
      if (key === undefined) {
        let overrideRef = dir !== undefined && dir !== '' ? derivedRef(dir) : undefined
        if (overrideRef === undefined || state.overrides[overrideRef] === undefined) {
          overrideRef = sourceRef ?? 'DEEPSEEK_API_KEY'
        }
        sourceRef = overrideRef
        const hit = await resolveKey(ctx, sourceRef)
        key = hit?.value
      }
      if (typeof key !== 'string' || key === '') {
        sendJson(res, 400, { ok: false, error: `没有可测试的 key（ref=${sourceRef ?? '未知'}）` })
        return
      }
      const result = await probeKey(ctx, key)
      if (result.verdict === 'invalid') {
        const ref = sourceRef ?? (dir !== undefined ? derivedRef(dir) : undefined)
        if (ref !== undefined && state.overrides[ref] !== undefined) {
          state.invalid[ref] = {
            at: new Date().toISOString(),
            status: 'invalid',
            message: result.detail,
            workspacePath: dir,
          }
          saveState(state)
          result.marked = ref
        }
      }
      sendJson(res, 200, { ok: true, test: result, keyMasked: maskKey(key), keyTail: maskTail(key) })
      return
    }

    if (pathname === `${API_BASE}/clear-flag` && method === 'POST') {
      const body = await readJson(req)
      const dir = typeof body.path === 'string' ? body.path : undefined
      const ref = dir !== undefined && dir !== '' ? derivedRef(dir) : undefined
      if (ref !== undefined) {
        delete state.invalid[ref]
        saveState(state)
      }
      sendJson(res, 200, { ok: true, ...(await snapshot(ctx, state)) })
      return
    }

    res.writeHead(404)
    res.end('not found')
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err?.message ?? err) })
  }
}
