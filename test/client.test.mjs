/**
 * dsh-workspace-api-key 浏览器半边离线测试。
 *
 * 不启动浏览器：给 lib/client.js 造一个最小的 React 运行时（函数组件 +
 * useState/useEffect/useCallback/useRef/useMemo），真的把面板渲染出来，再用
 * window.fetch 打桩模拟宿主 /wsk-api，断言：
 *   - 侧栏行注册（order 1 = 插件下方）与主区页面注册（key 必须等于行 id）
 *   - 面板能渲染出工作区列表、默认项、失效提示
 *   - 点「配置 → 保存」会发出正确的 /set 请求并刷新界面
 *   - 点「测试连接」会发出 /test 并显示结果
 *   - 「返回」调用 layout.selectPanel(null)
 *
 * 运行：node test/client.test.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

let checks = 0
let failures = 0
const DEBUG = process.env.DEBUG === '1'
globalThis.__WSK_TRACE__ = DEBUG

function check(name, cond, extra) {
  checks += 1
  if (cond) console.log(`  ok   ${name}`)
  else {
    failures += 1
    console.log(`  FAIL ${name}${extra === undefined ? '' : ` — ${extra}`}`)
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// ─────────────────────── 最小 React 运行时 ───────────────────────

const h = (type, props, ...children) => {
  const flat = []
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue
    flat.push(child)
  }
  const value = flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat
  return { type, props: { ...(props ?? {}), children: value } }
}

// 每个「组件类型」一套持久 hook 状态（真实 React 是每个实例一套；
// 组件都是单实例，所以按类型键控足够）。
const hookStates = new Map()
const pendingCleanups = []
let cursor = 0
let forceRender = null
let rendering = false

const React = {
  __current: [],
  createElement: h,
  useState(initial) {
    const array = React.__current
    const index = cursor++
    // 与 React 一致：函数初值视为惰性初始化（只算一次）。
    if (array.length <= index) array.push(typeof initial === 'function' ? initial() : initial)
    return [array[index], (value) => setAt(array, index, value)]
  },
  useRef(initial) {
    return useHook(() => ({ current: initial }))
  },
  /** 走与真实 React 相同的「按依赖数组记忆」语义：deps 变化才换新函数。 */
  useCallback(fn, deps) {
    const array = React.__current
    const index = cursor++
    if (array.length <= index) array.push({ fn, deps })
    const slot = array[index]
    if (!sameDeps(slot.deps, deps)) {
      slot.fn = fn
      slot.deps = deps
    }
    return slot.fn
  },
  useEffect(fn, deps) {
    const array = React.__current
    const index = cursor++
    const previous = array[index]
    if (previous === undefined || !sameDeps(previous.deps, deps)) {
      array[index] = { deps }
      const cleanup = fn()
      if (typeof cleanup === 'function') pendingCleanups.push(cleanup)
    }
    return undefined
  },
  useMemo(fn, deps) {
    const array = React.__current
    const index = cursor++
    if (array.length <= index) array.push({ value: fn(), deps })
    const slot = array[index]
    if (!sameDeps(slot.deps, deps)) {
      slot.value = fn()
      slot.deps = deps
    }
    return slot.value
  },
}

function useHook(init) {
  const array = React.__current
  const index = cursor++
  if (array.length <= index) array.push(init())
  return array[index]
}

function setAt(array, index, value) {
  array[index] = typeof value === 'function' ? value(array[index]) : value
  if (!rendering && typeof forceRender === 'function') forceRender()
}

function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false
  return true
}

/** 卸载当前挂载的所有组件：先跑它们登记的清理函数（bridge.refresh 会在这里被注销）。 */
function resetHooks() {
  for (const cleanup of pendingCleanups.splice(0)) {
    try { cleanup() } catch { /* 清理失败不影响测试 */ }
  }
  hookStates.clear()
}

// ─────────────────────────── 渲染器 ───────────────────────────

function render(node) {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) return node.map((child) => render(child)).filter(Boolean)
  if (typeof node.type === 'function') {
    const isComponent = /^[A-Z]/.test(node.type.name ?? '')
    if (isComponent) {
      let array = hookStates.get(node.type)
      if (array === undefined) {
        array = []
        hookStates.set(node.type, array)
      }
      const previous = React.__current
      React.__current = array
      cursor = 0
      rendering = true
      const child = node.type(node.props)
      rendering = false
      React.__current = previous
      return render(child)
    }
    return render(node.type(node.props))
  }
  return {
    type: node.type,
    props: node.props,
    children: render(node.props?.children),
  }
}

function flatten(node, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  if (typeof node !== 'object') return out
  out.push(node)
  flatten(node.children, out)
  return out
}

function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (Array.isArray(node)) return node.map((child) => textOf(child)).join(' ')
  if (typeof node !== 'object') return String(node)
  const own = []
  const children = node.props?.children
  const hasChildren = children !== undefined && children !== null
  if (!hasChildren) {
    // 叶子 host 元素或纯文本 props
    return typeof node.props?.children === 'string' ? node.props.children : ''
  }
  own.push(textOf(children))
  return own.filter((s) => s !== '').join(' ')
}

function byClass(node, className) {
  return flatten(node).filter((n) => typeof n.props?.className === 'string'
    && n.props.className.split(/\s+/).includes(className))
}

function byTag(node, type) {
  return flatten(node).filter((n) => n.type === type)
}

function buttons(node) {
  return flatten(node).filter((n) => n.type === 'button')
}

function findButton(node, label) {
  return buttons(node).find((b) => textOf(b).includes(label))
}

function click(node, arg) {
  if (node === undefined) throw new Error('click: 目标节点不存在')
  const handler = node.props.onClick
  if (typeof handler !== 'function') throw new Error(`click: ${node.type} 上不是函数（${typeof handler}）`)
  handler(arg ?? { target: { value: '' }, currentTarget: null, key: '' })
}

// ─────────────────────── 加载客户端模块 ───────────────────────

let loaded = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      loaded = spec
    },
  },
}

const requireShim = (name) => {
  if (name === 'react') return React
  throw new Error(`未打桩的 require(${name})`)
}

// client.js 是宿主侧加载的浏览器 bundle 源码（CJS 风格），这里直接 eval。
// eslint-disable-next-line no-new-func
new Function('window', 'require', SOURCE)(globalThis.window, requireShim)

check('文件是 window.__ModuleLoader__.load 包装', loaded !== null && typeof loaded.factory === 'function')
eq('模块 id 正确', loaded?.id, 'dsh-workspace-api-key')

const client = loaded.factory(requireShim)
check('导出 inject', Array.isArray(client.inject) && client.inject.includes('slots'), JSON.stringify(client.inject))
check('导出 apply(ctx)', typeof client.apply === 'function')
check('没有导出 name（宿主侧插件行由 cordis 认领）', client.name === undefined)
// 回归保护：apply 阶段若 layout 还没就绪，旧实现会把 undefined 永久缓存下来，
// 「返回」就变成静默空操作。所以必须声明 layout（宿主会等它就绪）＋点击时惰性取。
check('inject 声明了 layout（否则返回键会静默失效）', client.inject.includes('layout'), JSON.stringify(client.inject))

// ─────────────────────── 假 ctx + 插槽注册 ───────────────────────

const registrations = []
const registeredCtx = { injected: [], lastPanel: 'unset' }
const layout = { selectPanel: (id) => { registeredCtx.lastPanel = id } }

// 会话列表服务（客户端的 ctx.sessions）：byId[*].retainedBy.mainView 指向主视图里显示的会话。
// clientSessions=false 模拟「浏览器端也拿不到会话列表」；clientExtraSessions 注入
// 子代理会话 / displayTitle 等边界条目。
let clientSessions = true
let clientExtraSessions = []
/** 只暴露这些 id（模拟「浏览器端只认识一部分会话」）。 */
let clientOnlyIds = null
/** false = 客户端 sessions 服务尚未提供（apply 之后才由别的插件给出）。 */
let sessionsServiceReady = true
const sessionStore = {
  current: 'session-1',
  listeners: new Set(),
  snapshotCount: 0,
  getSnapshot() {
    this.snapshotCount += 1
    const main = (id) => (this.current === id ? 1 : 0)
    const byId = clientSessions
      ? {
          'session-1': { id: 'session-1', title: '会话一', cwd: WS_A, updatedAt: 9, retainedBy: { mainView: main('session-1') } },
          'session-2': { id: 'session-2', title: '会话二', cwd: WS_A, updatedAt: 8, retainedBy: { mainView: main('session-2') } },
          'session-3': { id: 'session-3', title: '会话三', cwd: DIR_U, updatedAt: 3, retainedBy: { mainView: main('session-3') } },
        }
      : {}
    for (const item of clientExtraSessions) byId[item.id] = item
    if (clientOnlyIds !== null) {
      for (const id of Object.keys(byId)) {
        if (!clientOnlyIds.includes(id)) delete byId[id]
      }
    }
    return { phase: 'ready', ids: Object.keys(byId), byId }
  },
  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  },
  emit() { for (const listener of [...this.listeners]) listener() },
}

let layoutAvailable = true

const ctx = {
  get(name) {
    if (name === 'slots') {
      return {
        inject(key, callback) {
          registeredCtx.injected.push(key)
          callback()
          return () => {}
        },
        register(options, component) {
          registrations.push({ options, component })
          return () => {}
        },
      }
    }
    if (name === 'layout') return layoutAvailable ? layout : undefined
    if (name === 'sessions') return sessionsServiceReady ? { list: sessionStore } : undefined
    return undefined
  },
  effect(fn) {
    fn()
    return () => {}
  },
}

client.apply(ctx)

console.log('\n[1] 插槽注册')
eq('注入了三个插槽', registeredCtx.injected.length, 3)
check('注入 sidebar.panellist / main / shell.overlay',
  registeredCtx.injected.includes('sidebar.panellist') && registeredCtx.injected.includes('main')
    && registeredCtx.injected.includes('shell.overlay'),
  JSON.stringify(registeredCtx.injected))
const row = registrations.find((r) => r.options.name === 'sidebar.panellist')
const page = registrations.find((r) => r.options.name === 'main')
const overlay = registrations.find((r) => r.options.name === 'shell.overlay')
eq('侧栏行 id', row?.options.id, 'workspace-api-key')
eq('侧栏行 order（1 = 紧跟宿主「插件」行 order 0）', row?.options.order, 1)
eq('侧栏行 label', typeof row?.options.label === 'function' ? row.options.label() : row?.options.label, 'API Key 分配')
eq('主区页面 key 必须等于侧栏行 id', page?.options.key, row?.options.id)
check('侧栏行有图标组件', typeof row.component === 'function')
check('主区页面有组件', typeof page.component === 'function')
check('覆盖层注册带 id（list 槽要求）', typeof overlay?.options.id === 'string' && overlay.options.id !== '', JSON.stringify(overlay?.options))
check('覆盖层有组件', typeof overlay?.component === 'function')

// ─────────────────────── 宿主接口打桩 ───────────────────────

const WS_A = 'C:\\work\\alpha'
const WS_B = 'C:\\work\\beta'
const DIR_U = 'C:\\work\\loose'
const REF_A = 'DEEPSEEK_API_KEY_WS_ABCDEF0123456789'
const REF_B = 'DEEPSEEK_API_KEY_WS_0000000000000000'
const REF_U = 'DEEPSEEK_API_KEY_WS_9999999999999999'
const REF_S1 = 'DEEPSEEK_API_KEY_SS_1111111111111111'

const MASK_WS_A = 'sk-alp…cret'
const MASK_S1 = 'sk-ses…ne-1'
const MASK_DEFAULT = 'sk-def…ault'

let overrides = {
  [REF_A]: { ref: REF_A, scope: 'workspace', path: WS_A, title: 'alpha', provider: 'deepseek-official', at: '2026-01-01T00:00:00.000Z' },
  [REF_S1]: { ref: REF_S1, scope: 'session', sessionId: 'session-1', path: WS_A, title: '会话一', provider: 'deepseek-official', at: '2026-01-03T00:00:00.000Z' },
}
let invalid = {
  [REF_A]: { at: '2026-01-02T00:00:00.000Z', status: 'invalid', level: 'workspace', message: 'Authentication Fails, invalid api key' },
}
const defaultConfigured = true
let sessionListAvailable = true
// 诊断相关开关：模拟「宿主半边是旧版本」、/state 的 sessionProbe 变体、
// 以及「拿到了会话但一个都对不上工作区」。
let staleHost = false
let probeOverride = null
let mapSessions = true

/** 会话行形状对齐 lib/index.js 的 sessionRow（字段名与层级语义一致）。 */
function mkSession(sessionId, title, provider, model, opts) {
  const ref = sessionId === 'session-1' ? REF_S1 : `DEEPSEEK_API_KEY_SS_${sessionId.toUpperCase()}`
  const hasOwn = overrides[ref] !== undefined
  const wsConfigured = opts.wsConfigured === true
  const level = hasOwn ? 'session' : wsConfigured ? 'workspace' : 'default'
  const effectiveRef = hasOwn ? ref : opts.wsRef
  const keyProvider = hasOwn ? overrides[ref].provider : opts.wsProvider
  return {
    sessionId,
    title,
    updatedAt: opts.updatedAt ?? 1,
    running: false,
    blank: false,
    parentSessionId: undefined,
    cwd: opts.cwd,
    provider,
    model,
    ref,
    configured: hasOwn,
    keyMasked: hasOwn ? 'sk-ses…ne-1' : undefined,
    overrideProvider: hasOwn ? overrides[ref].provider : undefined,
    overrideModel: undefined,
    level,
    effectiveRef,
    effectiveKeyMasked: hasOwn ? 'sk-ses…ne-1' : opts.wsKeyMasked,
    effectiveProvider: keyProvider,
    effectiveModel: undefined,
    effectiveTitle: hasOwn ? overrides[ref].title : undefined,
    invalid: invalid[effectiveRef] ?? null,
    mismatch: keyProvider !== undefined && provider !== keyProvider
      ? { keyProvider, sessionProvider: provider, keyModel: undefined, sessionModel: model }
      : null,
  }
}

function snapshot() {
  const aConfigured = overrides[REF_A] !== undefined
  const bConfigured = overrides[REF_B] !== undefined
  const workspace = (id, path, title, ref, configured, keyMasked, provider) => ({
    id, path, title, kind: 'workspace', ref, configured,
    keyMasked: configured ? keyMasked : undefined,
    source: configured ? 'file' : undefined,
    writable: true,
    invalid: invalid[ref] ?? null,
    exists: true,
    overrideProvider: configured ? provider : undefined,
    sessions: [],
  })
  const alpha = workspace('w-a', WS_A, 'alpha', REF_A, aConfigured, MASK_WS_A, 'deepseek-official')
  // 宿主拿不到会话服务时会话数组就是空的（界面据此降级）。
  alpha.sessions = sessionListAvailable && mapSessions ? [
    mkSession('session-1', '会话一', 'deepseek-official', 'deepseek-flash',
      { cwd: WS_A, updatedAt: 9, wsConfigured: aConfigured, wsRef: REF_A, wsProvider: 'deepseek-official', wsKeyMasked: MASK_WS_A }),
    mkSession('session-2', '会话二', 'other-provider', 'gpt-x',
      { cwd: WS_A, updatedAt: 8, wsConfigured: aConfigured, wsRef: REF_A, wsProvider: 'deepseek-official', wsKeyMasked: MASK_WS_A }),
  ] : []
  const out = {
    ok: true,
    pluginVersion: '0.2.1',
    storeVersion: 2,
    sessionProbe: sessionListAvailable
      ? { available: true, count: 4, withoutCwd: 1, samples: [WS_A, DIR_U] }
      : { available: false, count: 0, withoutCwd: 0, samples: [] },
    workspacePathSample: [WS_A, WS_B],
    defaultRef: { ref: 'DEEPSEEK_API_KEY', configured: defaultConfigured, source: 'file', writable: true, keyMasked: MASK_DEFAULT },
    providers: ['deepseek-official', 'other-provider'],
    sessionListAvailable,
    workspaces: [
      alpha,
      workspace('w-b', WS_B, 'beta', REF_B, bConfigured, 'sk-bet…cret', 'deepseek-official'),
    ],
    ungrouped: [
      { ...workspace(undefined, DIR_U, 'loose', REF_U, false, undefined, undefined), kind: 'directory',
        sessions: sessionListAvailable && mapSessions ? [ mkSession('session-3', '会话三', 'deepseek-official', 'deepseek-flash',
          { cwd: DIR_U, updatedAt: 3, wsConfigured: false, wsRef: REF_U }) ] : [] },
    ],
    sessionOverrides: overrides[REF_S1] !== undefined
      ? [{ ref: REF_S1, sessionId: 'session-1', title: '会话一', keyMasked: MASK_S1,
           provider: 'deepseek-official', visible: true, invalid: invalid[REF_S1] ?? null }]
      : [],
    statePath: 'C:\\Users\\x\\.dsh\\storages\\dsh-workspace-api-key.json',
  }
  if (staleHost) {
    // 0.1.0 的宿主只回这些字段：没有 storeVersion / pluginVersion / sessionProbe /
    // ungrouped，工作区行也没有 sessions。
    for (const key of ['storeVersion', 'pluginVersion', 'sessionProbe', 'sessionListAvailable', 'ungrouped', 'workspacePathSample']) {
      delete out[key]
    }
    for (const ws of out.workspaces) delete ws.sessions
  }
  if (probeOverride !== null) out.sessionProbe = probeOverride
  return out
}

/** /check 的响应形状对齐 lib/index.js 的 checkSession。 */
function checkPayload(sessionId) {
  if (sessionId === 'session-2') {
    return {
      ok: true, sessionId, title: '会话二', cwd: WS_A,
      provider: 'other-provider', model: 'gpt-x', level: 'workspace', ref: REF_A,
      overrideTitle: 'alpha', keyMasked: MASK_WS_A, keyConfigured: true,
      overrideProvider: 'deepseek-official', overrideModel: null, invalid: null,
      mismatch: { keyProvider: 'deepseek-official', sessionProvider: 'other-provider', keyModel: null, sessionModel: 'gpt-x' },
      needsAttention: true,
      sessionScope: { configured: false, ref: 'DEEPSEEK_API_KEY_SS_SESSION-2' },
      workspaceScope: { configured: true, ref: REF_A, path: WS_A, title: 'alpha' },
      defaultRef: { ref: 'DEEPSEEK_API_KEY', configured: true },
    }
  }
  if (sessionId === 'session-3') {
    return {
      ok: true, sessionId, title: '会话三', cwd: DIR_U,
      provider: 'deepseek-official', model: 'deepseek-flash', level: 'default', ref: 'DEEPSEEK_API_KEY',
      overrideTitle: null, keyMasked: MASK_DEFAULT, keyConfigured: true,
      overrideProvider: null, overrideModel: null,
      invalid: { at: '2026-04-01T00:00:00.000Z', status: 'invalid', message: 'Authentication Fails, invalid api key' },
      mismatch: null, needsAttention: true,
      sessionScope: { configured: false, ref: null },
      workspaceScope: { configured: false, ref: null, path: DIR_U, title: null },
      defaultRef: { ref: 'DEEPSEEK_API_KEY', configured: true },
    }
  }
  return {
    ok: true, sessionId, title: '会话一', cwd: WS_A,
    provider: 'deepseek-official', model: 'deepseek-flash', level: 'session', ref: REF_S1,
    overrideTitle: '会话一', keyMasked: MASK_S1, keyConfigured: true,
    overrideProvider: 'deepseek-official', overrideModel: null, invalid: null,
    mismatch: null, needsAttention: false,
    sessionScope: { configured: true, ref: REF_S1 },
    workspaceScope: { configured: true, ref: REF_A, path: WS_A, title: 'alpha' },
    defaultRef: { ref: 'DEEPSEEK_API_KEY', configured: true },
  }
}

const calls = []

globalThis.window.fetch = async (url, init) => {
  const path = String(url).replace('/wsk-api', '')
  const body = init?.body ? JSON.parse(init.body) : undefined
  calls.push({ path, method: init?.method ?? 'GET', body })

  let payload
  if (path === '/state') payload = snapshot()
  else if (path.startsWith('/check')) {
    const query = String(path).slice(String(path).indexOf('?') + 1)
    payload = checkPayload(new URLSearchParams(query).get('sessionId'))
  } else if (path === '/set') {
    const ref = body.scope === 'session'
      ? (body.sessionId === 'session-1' ? REF_S1 : `DEEPSEEK_API_KEY_SS_${String(body.sessionId).toUpperCase()}`)
      : body.path === WS_A ? REF_A : body.path === WS_B ? REF_B : REF_U
    if (body.useDefault === true || body.key === undefined || body.key === '') {
      delete overrides[ref]
      delete invalid[ref]
    } else {
      overrides[ref] = {
        ref, scope: body.scope ?? 'workspace', sessionId: body.sessionId, path: body.path,
        title: body.title, provider: body.provider, at: '2026-02-01T00:00:00.000Z',
      }
      delete invalid[ref]
    }
    payload = snapshot()
  } else if (path === '/test') {
    // 宿主 /test 只返回测试结果（lib/index.js:803），界面靠随后再拉一次 /state 刷新。
    payload = { ok: true, test: { ok: true, verdict: 'ok', status: 200, latencyMs: 123, detail: '连接正常，key 可用' }, keyMasked: 'sk-new…alue' }
  } else if (path === '/clear-flag') {
    const ref = body.ref ?? (body.scope === 'session'
      ? REF_S1
      : body.path === WS_A ? REF_A : body.path === WS_B ? REF_B : REF_U)
    delete invalid[ref]
    payload = snapshot()
  } else payload = { ok: false, error: `unknown ${path}` }

  return { ok: true, status: 200, async json() { return payload } }
}

// ─────────────────────────── 渲染面板 ───────────────────────────

/** 挂载（或重新挂载）组件，并等宿主 /state 的 promise 落地后自动重渲染。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

let tree = null
let overlayTree = null
let activePage = page
let activeOverlay = null
let pageProps = {}
let overlayProps = {}

function rerenderAll() {
  try {
    if (activePage !== null) tree = render(h(activePage.component, pageProps))
    if (activeOverlay !== null) overlayTree = render(h(activeOverlay.component, overlayProps))
  } catch (err) {
    if (DEBUG) console.log('RENDER ERROR', err)
    throw err
  }
}

/** 挂载主区面板（faithful 地走注册时的 inject()，返回什么就传什么）。 */
async function mount(target = page) {
  resetHooks()
  activeOverlay = null
  overlayTree = null
  activePage = target
  pageProps = typeof target.options.inject === 'function' ? target.options.inject() : {}
  forceRender = rerenderAll
  rerenderAll()
  await settle()
}

/** 卸载面板（跑清理 → 注销 bridge.refresh），模拟「离开面板」。 */
function unmount() {
  resetHooks()
  activePage = null
  tree = null
}

/** 挂载「进入会话时提醒」的覆盖层组件。 */
async function mountOverlay(target = overlay) {
  resetHooks()
  activePage = null
  tree = null
  activeOverlay = target
  overlayProps = typeof target.options.inject === 'function' ? target.options.inject() : {}
  forceRender = rerenderAll
  rerenderAll()
  await settle()
}

console.log('\n[2] 首次渲染')
await mount()
check('渲染出了面板根节点', tree !== null && tree.props?.className?.includes('wsk'), tree?.props?.className)
eq('/state 被调用一次', calls.filter((c) => c.path === '/state').length, 1)
check('列出工作区 alpha', textOf(tree).includes('alpha'), textOf(tree).slice(0, 300))
check('列出工作区 beta', textOf(tree).includes('beta'), textOf(tree).slice(0, 300))
check('显示默认 ref 名', textOf(tree).includes('DEEPSEEK_API_KEY'))
// alpha 同时「已配置 + 已失效」：失效优先，这是刻意的（先提醒换 key），
// 「专属 key」徽标本身在第 5 步保存后验证。
check('beta 显示「系统默认」', textOf(tree).includes('系统默认'))
check('alpha 显示失效徽标', textOf(tree).includes('key 已失效'))
check('标题正确', textOf(tree).includes('API Key 分配'))
check('清除了失效标记按钮存在', findButton(tree, '清除标记') !== undefined)

console.log('\n[3] 失效提醒弹窗（进面板时自动弹出，且只弹一次）')
const dialogs = byClass(tree, 'wsk-overlay')
eq('渲染出一个弹窗', dialogs.length, 1)
check('弹窗标题带工作区名', textOf(dialogs[0]).includes('alpha') && textOf(dialogs[0]).includes('已失效'))
check('弹窗给出三个选项',
  textOf(dialogs[0]).includes('重新配置') && textOf(dialogs[0]).includes('改用系统设置') && textOf(dialogs[0]).includes('稍后'))

console.log('\n[4] 「稍后」关闭弹窗')
click(findButton(dialogs[0], '稍后'))
eq('弹窗已关闭', byClass(tree, 'wsk-overlay').length, 0)

console.log('\n[5] 「配置」展开编辑器并保存专属 key')
click(findButton(tree, '配置'))
const inputs = byTag(tree, 'input')
eq('出现一个 key 输入框', inputs.length, 1)
eq('输入框类型', inputs[0].props.type, 'text')
inputs[0].props.onChange({ target: { value: 'sk-new-secret-value' } })
const saveBtn = findButton(tree, '保存')
check('保存按钮存在', saveBtn !== undefined)
calls.length = 0
click(saveBtn)
await settle()
const setCall = calls.find((c) => c.path === '/set')
check('发出了 /set', setCall !== undefined, JSON.stringify(calls.map((c) => c.path)))
eq('/set 带上了工作区路径', setCall?.body?.path, WS_A)
eq('/set 带上了新 key', setCall?.body?.key, 'sk-new-secret-value')
check('保存后提示成功', textOf(tree).includes('已保存专属 key'), textOf(tree).slice(0, 200))
eq('编辑器已收起', byTag(tree, 'input').length, 0)
check('保存后失效标记被清除', !textOf(tree).includes('key 已失效'))
check('保存后 alpha 显示「专属 key」徽标', textOf(tree).includes('专属 key'), textOf(tree).slice(0, 200))

console.log('\n[6] 「测试连接」发出 /test 并显示结果')
calls.length = 0
const alphaRow = flatten(tree).find((n) => n.props?.className === 'wsk-row' && textOf(n).includes('alpha'))
const testBtn = buttons(alphaRow).find((b) => textOf(b).includes('测试连接'))
check('alpha 行有测试连接按钮', testBtn !== undefined)
click(testBtn)
await settle()
const testCall = calls.find((c) => c.path === '/test')
check('发出了 /test', testCall !== undefined, JSON.stringify(calls.map((c) => c.path)))
eq('/test 带上了工作区路径', testCall?.body?.path, WS_A)
check('界面显示测试结果', textOf(tree).includes('连接正常'), textOf(tree).slice(0, 200))

console.log('\n[7] 「清除标记」清掉失效提示')
// 上面的保存已经把标记清掉了，这里重新注入一个失效标记再挂载，
// 专门验证「清除标记」这条独立路径。
invalid = { [REF_A]: { at: '2026-03-01T00:00:00.000Z', status: 'invalid', message: 'Authentication Fails, invalid api key' } }
await mount()
check('重新注入后 alpha 又显示失效徽标', textOf(tree).includes('key 已失效'))
calls.length = 0
const clearBtn = findButton(tree, '清除标记')
check('清除标记按钮存在', clearBtn !== undefined)
click(clearBtn)
await settle()
check('发出了 /clear-flag', calls.some((c) => c.path === '/clear-flag'), JSON.stringify(calls.map((c) => c.path)))
check('失效徽标消失', !textOf(tree).includes('key 已失效'))

console.log('\n[8] 「返回」把主区还给会话面板')
click(findButton(tree, '返回'))
eq('调用了 layout.selectPanel(null)', registeredCtx.lastPanel, null)

console.log('\n[9] 系统默认设置卡片')
check('显示「已配置 · file」徽标', textOf(tree).includes('已配置 · file'), textOf(tree).slice(-260))
check('显示当前 key 掩码', textOf(tree).includes('sk-def…ault'))
check('默认项有测试连接按钮', findButton(tree, '测试连接') !== undefined)

console.log('\n[10] 返回键惰性回归（apply 时 layout 尚未就绪）')
// 旧实现在 apply 阶段就把 ctx.get('layout') 的结果缓存进闭包，那时若服务还没就绪，
// 「返回」就成了静默空操作。这里刻意让 layout 晚到，验证点击时惰性取。
layoutAvailable = false
const beforeApply = registrations.length
client.apply(ctx)
const latePage = registrations.slice(beforeApply).find((r) => r.options.name === 'main')
check('第二次 apply 注册了主区页面', latePage !== undefined)
layoutAvailable = true
registeredCtx.lastPanel = 'unset'
await mount(latePage)
click(findButton(tree, '返回'))
eq('layout 晚到也能返回会话', registeredCtx.lastPanel, null)

console.log('\n[11] 工作区下的会话列表：默认折叠 / 展开 / 徽标')
await mount(page)
check('默认折叠：看不到会话标题', !textOf(tree).includes('会话一'), textOf(tree).slice(0, 260))
const toggle = findButton(tree, '会话 2')
check('alpha 行有「会话 2」展开开关', toggle !== undefined)
click(toggle)
check('展开后显示会话标题', textOf(tree).includes('会话一') && textOf(tree).includes('会话二'), textOf(tree).slice(0, 400))
check('会话层级徽标：本会话专属', textOf(tree).includes('本会话专属'))
check('会话层级徽标：工作区专属', textOf(tree).includes('工作区专属'))
check('服务商不匹配的会话有提醒徽标', textOf(tree).includes('服务商不匹配'))
check('会话行显示生效 key 掩码', textOf(tree).includes('生效 key'))

console.log('\n[12] 会话级：配置并保存专属 key')
const s1Row = () => flatten(tree).find((n) => n.props?.className === 'wsk-sess' && textOf(n).includes('会话一'))
click(findButton(s1Row(), '配置'))
const s1Inputs = byTag(tree, 'input')
eq('会话编辑器只出现一个输入框', s1Inputs.length, 1)
check('编辑器说明当前生效层级', textOf(tree).includes('当前生效：'), textOf(tree).slice(-260))
s1Inputs[0].props.onChange({ target: { value: 'sk-session-secret' } })
calls.length = 0
click(findButton(tree, '保存'))
await settle()
const sessionSet = calls.find((c) => c.path === '/set')
check('会话保存发出了 /set', sessionSet !== undefined, JSON.stringify(calls.map((c) => c.path)))
eq('会话 /set 带 scope=session', sessionSet?.body?.scope, 'session')
eq('会话 /set 带 sessionId', sessionSet?.body?.sessionId, 'session-1')
eq('会话 /set 带新 key', sessionSet?.body?.key, 'sk-session-secret')
check('提示写明是本会话专属 key', textOf(tree).includes('已保存本会话专属 key'), textOf(tree).slice(0, 200))

console.log('\n[13] 会话级「测试连接」')
calls.length = 0
click(findButton(s1Row(), '测试连接'))
await settle()
const sessionTest = calls.find((c) => c.path === '/test')
check('会话测试发出了 /test', sessionTest !== undefined, JSON.stringify(calls.map((c) => c.path)))
eq('/test 带 scope=session', sessionTest?.body?.scope, 'session')
eq('/test 带 sessionId', sessionTest?.body?.sessionId, 'session-1')
check('测试结果显示在界面上', textOf(tree).includes('连接正常'), textOf(tree).slice(-300))

console.log('\n[14] 未分组目录')
check('显示未分组目录卡片', textOf(tree).includes('未分组目录（1）'), textOf(tree).slice(-400))
check('未分组目录里的会话也在列表里', textOf(tree).includes('loose'))

console.log('\n[15] 进入会话时的提醒：服务商不匹配')
sessionStore.current = 'session-2'
calls.length = 0
await mountOverlay()
const mismatchDialog = byClass(overlayTree, 'wsk-overlay')[0]
check('覆盖层弹出了提醒', mismatchDialog !== undefined)
check('标题是「可能不匹配」', mismatchDialog !== undefined && textOf(mismatchDialog).includes('可能不匹配'),
  mismatchDialog === undefined ? '' : textOf(mismatchDialog).slice(0, 200))
check('正文写明不会自动换 key', textOf(mismatchDialog ?? {}).includes('不会自动更换 key'))
check('给出「去配置」', findButton(mismatchDialog, '去配置') !== undefined)
check('不匹配时给「继续用当前 key」而不是稍后', findButton(mismatchDialog, '继续用当前 key') !== undefined)
eq('只为当前会话请求一次 /check', calls.filter((c) => c.path.startsWith('/check')).length, 1)
check('/check 带上了 sessionId', calls.find((c) => c.path.startsWith('/check'))?.path.includes('session-2'))
check('/check 也带上 cwd（宿主据此定位工作区）', calls.find((c) => c.path.startsWith('/check'))?.path.includes('path='),
  calls.find((c) => c.path.startsWith('/check'))?.path)
calls.length = 0
sessionStore.emit()
await settle()
eq('同一个会话不重复打扰', calls.filter((c) => c.path.startsWith('/check')).length, 0)

console.log('\n[16] 「去配置」把焦点交给面板（不自动改 key）')
registeredCtx.lastPanel = 'unset'
click(findButton(mismatchDialog, '去配置'))
eq('主区切到本插件面板', registeredCtx.lastPanel, 'workspace-api-key')
await mount(page)
check('面板直接打开了该会话的编辑器', byTag(tree, 'input').length === 1, String(byTag(tree, 'input').length))
check('编辑器里是该会话的凭据引用', textOf(tree).includes('DEEPSEEK_API_KEY_SS_SESSION-2'), textOf(tree).slice(-320))

console.log('\n[17] 进入会话时的提醒：key 已失效')
sessionStore.current = 'session-3'
calls.length = 0
await mountOverlay()
const invalidDialog = byClass(overlayTree, 'wsk-overlay')[0]
check('覆盖层弹出了失效提醒', invalidDialog !== undefined)
check('标题是「已失效」', invalidDialog !== undefined && textOf(invalidDialog).includes('已失效'),
  invalidDialog === undefined ? '' : textOf(invalidDialog).slice(0, 200))
check('正文带上失效原因', textOf(invalidDialog ?? {}).includes('Authentication Fails'), textOf(invalidDialog ?? {}).slice(0, 300))
check('失效时给「改用系统默认」', findButton(invalidDialog, '改用系统默认') !== undefined)
calls.length = 0
click(findButton(invalidDialog, '改用系统默认'))
await settle()
const upper = calls.find((c) => c.path === '/set')
check('改用上层设置发出了 /set', upper !== undefined, JSON.stringify(calls.map((c) => c.path)))
eq('默认层级按工作区口径回退', upper?.body?.scope, 'workspace')
eq('回退到该会话所在目录', upper?.body?.path, DIR_U)
eq('回退请求带 useDefault', upper?.body?.useDefault, true)

console.log('\n[18] 宿主没有会话列表服务时优雅降级')
sessionListAvailable = false
clientSessions = false
await mount(page)
check('提示只能按工作区配置', textOf(tree).includes('只能按工作区配置 key'), textOf(tree).slice(0, 400))
check('没有会话开关按钮', findButton(tree, '会话 2') === undefined)
sessionListAvailable = true
clientSessions = true

console.log('\n[19] 宿主半边是旧版本时给出明确提示')
staleHost = true
await mount(page)
check('提示宿主插件是旧版本', textOf(tree).includes('宿主端插件还是旧版本'), textOf(tree).slice(0, 400))
check('提示要完全退出应用（不是刷新页面）', textOf(tree).includes('完全退出'), textOf(tree).slice(0, 400))
check('诊断行写明宿主是旧版', textOf(tree).includes('旧版（未重启应用）'), textOf(tree).slice(-400))
check('旧版宿主下仍然列出工作区', textOf(tree).includes('alpha'))
staleHost = false

console.log('\n[20] 宿主报告 0 个会话 / list() 报错时的诊断')
probeOverride = { available: true, count: 0, withoutCwd: 0, samples: [] }
mapSessions = false
clientSessions = false
await mount(page)
check('提示 0 个会话', textOf(tree).includes('宿主报告 0 个会话'), textOf(tree).slice(0, 400))
check('诊断行显示宿主会话列表 0 个', textOf(tree).includes('宿主会话列表：0 个'), textOf(tree).slice(-400))
probeOverride = { available: true, count: 0, withoutCwd: 0, samples: [], error: 'sessionController.list is not a function' }
await mount(page)
check('list() 报错显示在诊断行', textOf(tree).includes('sessionController.list is not a function'), textOf(tree).slice(-400))

console.log('\n[21] 拿到了会话但一个都对不上工作区')
probeOverride = null
mapSessions = false
clientSessions = false
await mount(page)
check('提示路径对不上', textOf(tree).includes('没有一个能对上工作区'), textOf(tree).slice(0, 400))
check('给出会话 cwd 样本', textOf(tree).includes('会话 cwd 样本'), textOf(tree).slice(0, 600))
check('给出工作区路径样本', textOf(tree).includes('工作区路径样本'), textOf(tree).slice(0, 600))
mapSessions = true
clientSessions = true
await mount(page)
check('恢复后不再显示诊断横幅', !textOf(tree).includes('没有一个能对上工作区'), textOf(tree).slice(0, 400))
check('底部诊断行始终显示版本', textOf(tree).includes('插件 v0.2.1'), textOf(tree).slice(-400))

console.log('\n[22] 浏览器端会话列表兜底：宿主给不出会话行也能列出会话（0.2.2 真机 bug）')
clientExtraSessions = []
sessionListAvailable = false
mapSessions = false
clientSessions = true
await mount(page)
check('不显示「只能按工作区配置」降级提示', !textOf(tree).includes('只能按工作区配置 key'), textOf(tree).slice(0, 400))
check('不显示「宿主报告 0 个会话」诊断', !textOf(tree).includes('宿主报告 0 个会话'), textOf(tree).slice(0, 400))
check('alpha 仍然有「会话 2」展开开关', findButton(tree, '会话 2') !== undefined, textOf(tree).slice(0, 600))
check('未分组目录仍然有「会话 1」展开开关', findButton(tree, '会话 1') !== undefined, textOf(tree).slice(0, 600))
const hostEmptyToggle = findButton(tree, '会话 2')
click(hostEmptyToggle)
check('展开后列出浏览器端的会话标题', textOf(tree).includes('会话一') && textOf(tree).includes('会话二'), textOf(tree).slice(0, 600))
check('补出的会话行带层级徽标（本会话专属）', textOf(tree).includes('本会话专属'), textOf(tree).slice(0, 900))
check('补出的会话行带层级徽标（工作区专属）', textOf(tree).includes('工作区专属'), textOf(tree).slice(0, 900))
check('诊断行分别报告宿主/浏览器会话数',
  textOf(tree).includes('宿主会话列表：不可用') && textOf(tree).includes('浏览器会话列表：3 个'),
  textOf(tree).slice(-400))

console.log('\n[23] 浏览器端兜底：displayTitle 优先 / 子代理会话不列出 / 未知 cwd 进未分组')
clientExtraSessions = [
  { id: 'sub-1', title: '子代理会话', cwd: WS_A, origin: 'subagent', parentId: 'session-1' },
  { id: 'session-4', title: '原标题', displayTitle: '显示标题优先', cwd: WS_B, updatedAt: 5 },
  { id: 'session-5', title: '别的目录会话', cwd: 'C:\\work\\other', updatedAt: 4 },
]
await mount(page)
check('子代理会话不列出', !textOf(tree).includes('子代理会话'), textOf(tree).slice(0, 700))
check('alpha 的会话数没被子代理会话撑大', findButton(tree, '会话 2') !== undefined, textOf(tree).slice(0, 700))
check('未知 cwd 进未分组目录（2 个）', textOf(tree).includes('未分组目录（2）'), textOf(tree).slice(-600))
const betaRow = flatten(tree).find((n) => n.props?.className === 'wsk-row' && textOf(n).includes('C:\\work\\beta'))
check('找到 beta 卡片', betaRow !== undefined)
const betaToggle = buttons(betaRow).find((b) => textOf(b).includes('会话 1'))
check('beta 出现「会话 1」开关', betaToggle !== undefined, textOf(betaRow ?? {}).slice(0, 300))
click(betaToggle)
check('displayTitle 优先于 title', textOf(tree).includes('显示标题优先') && !textOf(tree).includes('原标题'), textOf(tree).slice(0, 900))
clientExtraSessions = []
sessionListAvailable = true
clientSessions = true
clientOnlyIds = null
await mount(page)

console.log('\n[24] 浏览器端只认识一部分会话 → 宿主行不会被挤掉')
sessionListAvailable = true
mapSessions = true
clientSessions = true
clientOnlyIds = ['session-2']
await mount(page)
check('宿主列出的 session-1 仍在（浏览器端不认识它）', textOf(tree).includes('会话 2'), textOf(tree).slice(0, 700))
const alphaRowRetained = flatten(tree).find((n) => n.props?.className === 'wsk-row' && textOf(n).includes('C:\\work\\alpha'))
check('alpha 会话数仍是宿主给出的 2 个', findButton(alphaRowRetained ?? {}, '会话 2') !== undefined, textOf(alphaRowRetained ?? {}).slice(0, 300))
click(findButton(alphaRowRetained ?? {}, '会话 2'))
check('展开后既有宿主的「会话一」也有浏览器端的「会话二」',
  textOf(tree).includes('会话一') && textOf(tree).includes('会话二'), textOf(tree).slice(0, 900))
clientOnlyIds = null
await mount(page)

console.log('\n[25] 会话列表服务晚于插件提供 → 面板重试直到拿到')
sessionsServiceReady = false
clientOnlyIds = null
sessionListAvailable = true
await mount(page)
check('服务缺失时诊断行报告浏览器端 0 个会话', textOf(tree).includes('浏览器会话列表：0 个'), textOf(tree).slice(-300))
sessionsServiceReady = true
await new Promise((resolve) => setTimeout(resolve, 700))
check('重试后浏览器端会话进入诊断行', textOf(tree).includes('浏览器会话列表：3 个'), textOf(tree).slice(-300))
click(findButton(tree, '会话 2'))
check('重试后展开能看到浏览器端标题（会话一）', textOf(tree).includes('会话一'), textOf(tree).slice(0, 900))

console.log('\n[26] 覆盖层晚于插件提供：重试后仍会提醒')
sessionsServiceReady = false
sessionStore.current = 'session-2'
await mountOverlay(overlay)
check('服务缺失时不弹提醒（也不报错）', textOf(overlayTree) === '', textOf(overlayTree))
const checksBeforeRetry = calls.filter((c) => c.path.startsWith('/check')).length
sessionsServiceReady = true
await new Promise((resolve) => setTimeout(resolve, 700))
check('重试后弹出「进入会话」提醒', textOf(overlayTree).includes('可能不匹配'), textOf(overlayTree).slice(0, 400))
check('重试后确实发出了新的 /check',
  calls.filter((c) => c.path.startsWith('/check')).length > checksBeforeRetry, String(checksBeforeRetry))

console.log(`\n${checks - failures}/${checks} 通过`)
if (failures > 0) {
  process.exitCode = 1
  if (DEBUG) console.log('（DEBUG=1 有帮助时请附上上面的事件顺序）')
}
