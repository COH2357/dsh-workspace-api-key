/**
 * 新版计费模型（宿主 >= 0.2.2-rc.2）下的面板渲染测试。
 *
 * 新版把网页搜索/获取交给官方设置页的「计费方式」，插件面板不再显示旧的
 * 搜索 key 卡片、同步开关和搜索层级说明，只保留一个跳到官方设置的入口。
 *
 * 运行：node test/client-billing.test.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

let checks = 0
let failures = 0
function check(name, cond, extra) {
  checks += 1
  if (cond) console.log(`  ok   ${name}`)
  else {
    failures += 1
    console.log(`  FAIL ${name}${extra === undefined ? '' : ` — ${extra}`}`)
  }
}

const BILLING_STATE = {
  pluginVersion: '0.3.0',
  storeVersion: 3,
  hostVersion: '0.2.2-rc.2',
  sessionProbe: { available: true, count: 0, shape: 'object', source: 'sessionController', withoutCwd: 0, subagents: 0, samples: [] },
  workspacePathSample: [],
  defaultRef: { ref: 'DEEPSEEK_API_KEY', configured: true, writable: true, keyMasked: 'sk-def…ault' },
  providers: ['deepseek-official'],
  workspaceCount: 1,
  credentialsAvailable: true,
  sessionListAvailable: true,
  sessionControllerAvailable: true,
  statePath: '/tmp/state.json',
  search: {
    mode: 'billing',
    billing: { search: 'auto', fetch: 'api-key' },
    unified: false,
    apiChannel: true,
    defaultRef: 'DEEPSEEK_API_KEY_SEARCH',
    defaultConfigured: false,
    officialRef: 'DEEPSEEK_API_KEY',
    officialShared: true,
    ownedConfigured: false,
    syncCount: 0,
    warnings: [],
  },
  hiddenBlankDirs: [],
  workspaces: [{
    id: 'ws-1', path: '/work/alpha', title: 'alpha', kind: 'workspace',
    ref: 'DEEPSEEK_API_KEY_WS_ABCDEF0123456789', configured: false, writable: true,
    keyMasked: undefined, invalid: null, exists: true, searchSync: false, searchKeyRef: 'DEEPSEEK_API_KEY',
    sessions: [],
  }],
  ungrouped: [],
}

const UNIFIED_STATE = {
  ...BILLING_STATE,
  search: { ...BILLING_STATE.search, unified: true, officialRef: 'DEEPSEEK_API_KEY_SEARCH' },
}

function load(state) {
  const registrations = []
  const slots = {
    inject: (name, callback) => callback(),
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  }
  const ctx = {
    get(name) {
      if (name === 'slots') return slots
      return undefined
    },
    effect(callback) { callback(); return () => {} },
  }

  let injected = false
  const React = {
    createElement: (type, props, ...children) => {
      const flat = []
      for (const child of children.flat(Infinity)) {
        if (child === null || child === undefined || child === false || child === true) continue
        flat.push(child)
      }
      const value = flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat
      return { type, props: { ...(props ?? {}), children: value } }
    },
    useState(initial) {
      if (initial === null && !injected) {
        injected = true
        return [state, () => {}]
      }
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect() {},
    useCallback: (fn) => fn,
    useRef: (initial) => ({ current: initial }),
  }

  const window = { __ModuleLoader__: { load(spec) { window.spec = spec } } }
  const requireShim = (name) => {
    if (name === 'react') return React
    throw new Error(`unstubbed require(${name})`)
  }
  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, dataset: {} }),
    head: { appendChild: () => {} },
  }
  globalThis.window = { dispatchEvent: () => {} }
  globalThis.KeyboardEvent = class {}
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })
  new Function('window', 'require', SOURCE)(window, requireShim)
  const client = window.spec.factory(requireShim)
  client.apply(ctx)
  return registrations
}

function stringsOf(node, out = new Set(), depth = 0) {
  if (node === null || node === undefined || typeof node === 'boolean' || depth > 40) return out
  if (typeof node === 'string') { out.add(node); return out }
  if (Array.isArray(node)) { for (const child of node) stringsOf(child, out, depth + 1); return out }
  if (typeof node === 'object') {
    if (node.props !== undefined && node.props !== null) {
      for (const [key, value] of Object.entries(node.props)) {
        if (key === 'className' || key === 'style' || key === 'type' || key === 'key') continue
        stringsOf(value, out, depth + 1)
      }
    }
    if (node.children !== undefined) stringsOf(node.children, out, depth + 1)
  }
  return out
}

function renderMain(state) {
  const rows = load(state)
  const page = rows.find((row) => row.options.name === 'main')
  return stringsOf(page.component({ back: () => {}, sessions: undefined }))
}

const billingText = renderMain(BILLING_STATE)
check('计费模式显示「搜索与获取」卡片', billingText.has('搜索与获取'))
check('计费模式给出官方设置入口', billingText.has('打开官方搜索设置'))
check('计费模式显示当前计费方式',
  [...billingText].some((text) => text.includes('当前计费方式')) &&
  [...billingText].some((text) => text.includes('自动')) &&
  [...billingText].some((text) => text.includes('DeepSeek API Key')))
check('计费模式不再显示旧「搜索默认 key」卡片',
  ![...billingText].some((text) => text === '搜索默认 key'))
check('计费模式不再显示「同步搜索 API」开关',
  ![...billingText].some((text) => text.includes('同步搜索 API')))
check('计费模式不再显示搜索生效 key 提示',
  ![...billingText].some((text) => text.includes('搜索生效 key')))
check('计费模式不再出现旧版搜索警告说明',
  ![...billingText].some((text) => text.includes('启用新版 Web 搜索 API')))

const unifiedText = renderMain(UNIFIED_STATE)
check('统一搜索 key 开启时给出提示',
  [...unifiedText].some((text) => text.includes('实验性「统一搜索 key」已开启')))

console.log(`\n${checks - failures}/${checks} passed`)
if (failures > 0) process.exit(1)
