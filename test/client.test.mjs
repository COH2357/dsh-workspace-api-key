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
let cursor = 0
let forceRender = null
let rendering = false

const React = {
  __current: [],
  createElement: h,
  useState(initial) {
    const array = React.__current
    const index = cursor++
    if (array.length <= index) array.push(initial)
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
      fn()
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

// ─────────────────────── 假 ctx + 插槽注册 ───────────────────────

const registrations = []
const registeredCtx = { injected: [], lastPanel: 'unset' }
const layout = { selectPanel: (id) => { registeredCtx.lastPanel = id } }

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
    if (name === 'layout') return layout
    return undefined
  },
  effect(fn) {
    fn()
    return () => {}
  },
}

client.apply(ctx)

console.log('\n[1] 插槽注册')
eq('注入了两个插槽', registeredCtx.injected.length, 2)
check('注入 sidebar.panellist 与 main',
  registeredCtx.injected.includes('sidebar.panellist') && registeredCtx.injected.includes('main'),
  JSON.stringify(registeredCtx.injected))
const row = registrations.find((r) => r.options.name === 'sidebar.panellist')
const page = registrations.find((r) => r.options.name === 'main')
eq('侧栏行 id', row?.options.id, 'workspace-api-key')
eq('侧栏行 order（1 = 紧跟宿主「插件」行 order 0）', row?.options.order, 1)
eq('侧栏行 label', typeof row?.options.label === 'function' ? row.options.label() : row?.options.label, 'API Key 分配')
eq('主区页面 key 必须等于侧栏行 id', page?.options.key, row?.options.id)
check('侧栏行有图标组件', typeof row.component === 'function')
check('主区页面有组件', typeof page.component === 'function')

// ─────────────────────── 宿主接口打桩 ───────────────────────

const WS_A = 'C:\\work\\alpha'
const WS_B = 'C:\\work\\beta'
const REF_A = 'DEEPSEEK_API_KEY_WS_ABCDEF0123456789'
const REF_B = 'DEEPSEEK_API_KEY_WS_0000000000000000'

let overrides = { [REF_A]: { path: WS_A, title: 'alpha', at: '2026-01-01T00:00:00.000Z' } }
let invalid = { [REF_A]: { at: '2026-01-02T00:00:00.000Z', status: 'invalid', message: 'Authentication Fails, invalid api key' } }
const defaultConfigured = true

function snapshot() {
  const workspaces = [
    { id: 'w-a', path: WS_A, title: 'alpha', kind: 'workspace', ref: REF_A,
      configured: overrides[REF_A] !== undefined,
      keyMasked: overrides[REF_A] !== undefined ? 'sk-alp…cret' : undefined,
      invalid: invalid[REF_A] ?? null, exists: true },
    { id: 'w-b', path: WS_B, title: 'beta', kind: 'workspace', ref: REF_B,
      configured: overrides[REF_B] !== undefined, invalid: null, exists: true },
  ]
  return {
    ok: true,
    defaultRef: { ref: 'DEEPSEEK_API_KEY', configured: defaultConfigured, source: 'file',
      writable: true, keyMasked: 'sk-def…ault' },
    workspaces,
    statePath: 'C:\\Users\\x\\.dsh\\storages\\dsh-workspace-api-key.json',
  }
}

const calls = []

globalThis.window.fetch = async (url, init) => {
  const path = String(url).replace('/wsk-api', '')
  const body = init?.body ? JSON.parse(init.body) : undefined
  calls.push({ path, method: init?.method ?? 'GET', body })

  let payload
  if (path === '/state') payload = snapshot()
  else if (path === '/set') {
    if (body.useDefault === true || body.key === undefined || body.key === '') {
      delete overrides[body.path === WS_A ? REF_A : REF_B]
      delete invalid[REF_A]
    } else {
      overrides[body.path === WS_A ? REF_A : REF_B] = { path: body.path, title: body.title, at: '2026-02-01T00:00:00.000Z' }
      delete invalid[body.path === WS_A ? REF_A : REF_B]
    }
    payload = snapshot()
  } else if (path === '/test') {
    // 宿主 /test 只返回测试结果（lib/index.js:803），界面靠随后再拉一次 /state 刷新。
    payload = { ok: true, test: { ok: true, verdict: 'ok', status: 200, latencyMs: 123, detail: '连接正常，key 可用' }, keyMasked: 'sk-new…alue' }
  } else if (path === '/clear-flag') {
    delete invalid[body.path === WS_A ? REF_A : REF_B]
    payload = snapshot()
  } else payload = { ok: false, error: `unknown ${path}` }

  return { ok: true, status: 200, async json() { return payload } }
}

// ─────────────────────────── 渲染面板 ───────────────────────────

/** 挂载（或重新挂载）面板组件，并等宿主 /state 的 promise 落地后自动重渲染。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

let tree = null

async function mount() {
  hookStates.clear()
  forceRender = () => { tree = render(h(page.component, { layout })) }
  forceRender()
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

console.log(`\n${checks - failures}/${checks} 通过`)
if (failures > 0) {
  process.exitCode = 1
  if (DEBUG) console.log('（DEBUG=1 有帮助时请附上上面的事件顺序）')
}
