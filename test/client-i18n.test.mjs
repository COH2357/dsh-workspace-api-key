/**
 * English localization test for the browser half.
 *
 * The panel follows the web GUI language from @deepseek-ai/dsh-client-locale.
 * With an active English locale the built-in Chinese copy is translated; with
 * no locale service (older hosts, the other test suite) the original Chinese is
 * kept verbatim. This test loads the bundle twice with two different locale
 * services and checks both sides.
 *
 * Run: node test/client-i18n.test.mjs
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

const STATE = {
  pluginVersion: '0.2.16',
  storeVersion: 3,
  sessionProbe: { available: true, count: 1, shape: 'object', source: 'sessionController', withoutCwd: 0, subagents: 0, samples: [] },
  workspacePathSample: [],
  defaultRef: { ref: 'DEEPSEEK_API_KEY', configured: false, writable: true },
  providers: ['deepseek-official'],
  workspaceCount: 1,
  credentialsAvailable: true,
  sessionListAvailable: true,
  sessionControllerAvailable: true,
  statePath: '/tmp/state.json',
  search: { apiChannel: false, defaultRef: 'DEEPSEEK_API_KEY_SEARCH', defaultConfigured: false, officialRef: 'DEEPSEEK_API_KEY', officialShared: true, ownedConfigured: false, syncCount: 0 },
  hiddenBlankDirs: [],
  workspaces: [{
    id: 'ws-1', path: '/work/alpha', title: 'alpha', kind: 'workspace',
    ref: 'DEEPSEEK_API_KEY_WS_ABCDEF0123456789', configured: false, writable: true,
    keyMasked: undefined, invalid: null, exists: true, searchSync: false, searchKeyRef: 'DEEPSEEK_API_KEY',
    sessions: [],
  }],
  ungrouped: [],
}

function load(locale) {
  const registrations = []
  const slots = {
    inject: (name, callback) => callback(),
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  }
  const ctx = {
    get(name) {
      if (name === 'slots') return slots
      if (name === 'locale') return locale
      return undefined
    },
    effect(callback) { callback(); return () => {} },
  }

  let injected = false
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      if (initial === null && !injected) {
        injected = true
        return [STATE, () => {}]
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
    createElement: () => ({ style: {}, dataset: {} }),
    head: { appendChild: () => {} },
  }
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

const enLocale = { getSnapshot: () => ({ active: 'en', revision: 1 }), subscribe: () => () => {} }
const enRows = load(enLocale)
const enRow = enRows.find((row) => row.options.name === 'sidebar.panellist')
const enPage = enRows.find((row) => row.options.name === 'main')
check('English sidebar label', typeof enRow.options.label === 'function' ? enRow.options.label() === 'API Keys' : enRow.options.label === 'API Keys')
const enText = stringsOf(enPage.component({ back: () => {}, sessions: undefined }))
check('English system-default card', enText.has('System default'), JSON.stringify([...enText].slice(0, 8)))
check('English test button', enText.has('Test connection'))
check('English billing subtitle', enText.has('Per-workspace and per-session billing'))
check('English copy has no Chinese', ![...enText].some((text) => /[\u4e00-\u9fff]/.test(text)), [...enText].filter((text) => /[\u4e00-\u9fff]/.test(text)).slice(0, 5))

const zhRows = load(null)
const zhRow = zhRows.find((row) => row.options.name === 'sidebar.panellist')
const zhPage = zhRows.find((row) => row.options.name === 'main')
check('Chinese label without a locale service', typeof zhRow.options.label === 'function' ? zhRow.options.label() === 'API Key 分配' : zhRow.options.label === 'API Key 分配')
const zhText = stringsOf(zhPage.component({ back: () => {}, sessions: undefined }))
check('Chinese copy is kept', zhText.has('系统默认设置'), JSON.stringify([...zhText].slice(0, 8)))

console.log(`\n${checks - failures}/${checks} passed`)
if (failures > 0) process.exit(1)
