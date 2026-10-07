/**
 * dsh-workspace-api-key — host half 离线单元测试。
 *
 * 不启动 DSH：用假 ctx 模拟 credentials / agents / workspaceRegistry /
 * webServer / llm 服务，断言「按工作区切换 key」的核心语义。
 *
 * 运行：node test/host.test.mjs
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 必须在 import 插件之前设好：状态文件位置在模块加载后按 env 解析。
const TMP = mkdtempSync(join(tmpdir(), 'wsk-test-'))
process.env.DSH_HOME = TMP
process.env.WSK_DEBUG = '0'

const { apply } = await import('../lib/index.js')

let failures = 0
let checks = 0

function check(name, cond, extra) {
  checks += 1
  if (cond) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name}${extra === undefined ? '' : ` — ${extra}`}`)
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// ───────────────────────────── 假宿主 ─────────────────────────────

const WS_A = 'C:\\work\\alpha'
const WS_B = 'C:\\work\\beta'
const WS_C = 'C:\\work\\gamma' // 没有专属 key 的工作区
const DIR_ONLY = 'C:\\work\\loose' // 不是注册工作区，只是目录

const creds = new Map([
  ['DEEPSEEK_API_KEY', 'sk-default'],
  ['DEEPSEEK_API_KEY_EXTRA', 'sk-extra'],
])

const resolveCalls = []
const credentials = {
  async resolve(ref) {
    resolveCalls.push(ref)
    const value = creds.get(ref)
    return value === undefined ? undefined : { value, source: 'file' }
  },
  async describe(ref) {
    return { configured: creds.has(ref), source: creds.has(ref) ? 'file' : undefined, writable: true }
  },
  async set(ref, value) {
    creds.set(ref, value)
  },
  async unset(ref) {
    creds.delete(ref)
  },
}

let currentCwd
const agents = {
  currentInitiator() {
    return currentCwd === undefined ? undefined : { session: { header: { cwd: currentCwd } } }
  },
}

const workspaceRegistry = {
  list() {
    return [
      { id: 'w-a', path: WS_A, title: 'alpha' },
      { id: 'w-b', path: WS_B, title: 'beta' },
      { id: 'w-c', path: WS_C, title: 'gamma' },
    ]
  },
}

const routes = []
const webServer = {
  register(route) {
    routes.push(route)
    return () => {}
  },
}

const errorListeners = []
const llm = {
  adapters: new Map([
    [
      'deepseek-official',
      {
        adapter: {
          dependencies: {
            // 真实形状：baseURL 是**未加 /v1 的根**（DeepSeekAdapter 构造器才补 /v1），
            // models 是模型名数组（discoverModels 用它建目录）。
            options: () => ({
              apiKeyEnv: 'DEEPSEEK_API_KEY',
              baseURL: 'https://api.deepseek.com/anthropic',
              models: ['deepseek-flash', 'deepseek-chat'],
            }),
          },
        },
      },
    ],
    ['extra-route', { adapter: { dependencies: { options: () => ({ apiKeyEnv: 'DEEPSEEK_API_KEY_EXTRA' }) } } }],
  ]),
}

const settings = {
  get(section) {
    // 故意给一个**错的** baseURL：适配器 options() 才是权威来源，测试要证明它优先。
    if (section === 'llm-deepseek') return { baseURL: 'https://api.deepseek.com' }
    if (section === 'agent-default-model') return { model: 'deepseek-flash' }
    return undefined
  },
}

const effects = []
const ctx = {
  get(name) {
    switch (name) {
      case 'credentials': return credentials
      case 'agents': return agents
      case 'workspaceRegistry': return workspaceRegistry
      case 'webServer': return webServer
      case 'llm': return llm
      case 'settings': return settings
      default: return undefined
    }
  },
  effect(fn, label) {
    const dispose = fn()
    effects.push({ dispose, label })
    return dispose
  },
  on(event, handler) {
    if (event === 'agent/request-error') errorListeners.push(handler)
    return () => {}
  },
}

// ───────────────────────────── 记录原始 resolve ─────────────────────────────

const pristineResolve = credentials.resolve

// ───────────────────────────── 执行 ─────────────────────────────

console.log('apply(ctx)')
apply(ctx)

console.log('\n[1] 未安装 wrapper 前（基线：原始 resolve 行为）')
eq('原始 resolve 拿默认 key', (await pristineResolve('DEEPSEEK_API_KEY'))?.value, 'sk-default')

console.log('\n[2] wrapper 安装形态')
check('credentials.resolve 已被替换', credentials.resolve !== pristineResolve)
check('webServer 收到一条 prefix 路由', routes.length === 1 && routes[0].path === '/wsk-api',
  JSON.stringify(routes.map((r) => r.path)))
check('监听了一个 agent/request-error', errorListeners.length === 1)

console.log('\n[3] 没有活动 agent（后台请求）→ 直通')
currentCwd = undefined
resolveCalls.length = 0
eq('无 agent 时仍拿默认 key', (await credentials.resolve('DEEPSEEK_API_KEY'))?.value, 'sk-default')

console.log('\n[4] 未配置 override 的 ref → 直通（不做任何映射）')
currentCwd = WS_B
resolveCalls.length = 0
eq('未覆盖的 ref 直通', (await credentials.resolve('DEEPSEEK_API_KEY_EXTRA'))?.value, 'sk-extra')
eq('未知 ref 仍是 undefined', (await credentials.resolve('SOME_OTHER_KEY')), undefined)
eq('resolve 调用参数原样透传', resolveCalls[0], 'DEEPSEEK_API_KEY_EXTRA')

console.log('\n[5] 未配置专属 key 的工作区 → 用系统默认')
currentCwd = WS_A
eq('alpha 未配置时用默认', (await credentials.resolve('DEEPSEEK_API_KEY'))?.value, 'sk-default')
currentCwd = WS_C
eq('gamma 未配置时用默认', (await credentials.resolve('DEEPSEEK_API_KEY'))?.value, 'sk-default')

console.log('\n[6] 写入 alpha 的专属 key（走 REST /set）')
const route = routes[0]
async function callRoute(apiPath, method, body) {
  const chunks = method === 'POST' ? [Buffer.from(JSON.stringify(body ?? {}))] : []
  const req = {
    url: `/wsk-api${apiPath}`,
    method,
    headers: { host: '127.0.0.1:43120' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, fn) {
      if (event === 'data') for (const c of chunks) fn(c)
      if (event === 'end') fn()
      return req
    },
    destroy() {},
  }
  let status = 0
  let payload = ''
  const res = {
    writeHead(code) { status = code; return res },
    end(text) { payload += text ?? ''; return res },
  }
  await route.handler(req, res)
  let parsed
  try { parsed = JSON.parse(payload) } catch { parsed = payload }
  return { status, body: parsed }
}

const setRes = await callRoute('/set', 'POST', { path: WS_A, title: 'alpha', key: 'sk-alpha-secret' })
eq('/set 返回 200', setRes.status, 200)
const alphaEntry = (setRes.body.workspaces ?? []).find((ws) => ws.path === WS_A)
check('/set 后 alpha 标记为已配置', alphaEntry?.configured === true, JSON.stringify(alphaEntry))
check('/set 后 alpha 有脱敏值', typeof alphaEntry?.keyMasked === 'string' && alphaEntry.keyMasked.includes('…'),
  String(alphaEntry?.keyMasked))
check('/set 返回里没有明文 key', JSON.stringify(setRes.body).includes('sk-alpha-secret') === false)
const alphaRef = alphaEntry?.ref
check('alpha 的 ref 形如 DEEPSEEK_API_KEY_WS_*', /^DEEPSEEK_API_KEY_WS_[0-9A-F]{16}$/.test(alphaRef ?? ''), String(alphaRef))

console.log('\n[7] 核心语义：alpha 解析到专属 key，其它工作区不受影响')
currentCwd = WS_A
const a = await credentials.resolve('DEEPSEEK_API_KEY')
eq('alpha → 专属 key', a?.value, 'sk-alpha-secret')
currentCwd = WS_B
const b = await credentials.resolve('DEEPSEEK_API_KEY')
eq('beta（未配置）→ 默认 key', b?.value, 'sk-default')
currentCwd = WS_C
eq('gamma（未配置）→ 默认 key', (await credentials.resolve('DEEPSEEK_API_KEY'))?.value, 'sk-default')

console.log('\n[8] 每个 provider 路由的 apiKeyEnv 都被拦')
currentCwd = WS_A
eq('DEEPSEEK_API_KEY_EXTRA 也被重定向到 alpha 的 key',
  (await credentials.resolve('DEEPSEEK_API_KEY_EXTRA'))?.value, 'sk-alpha-secret')

console.log('\n[9] 大小写/分隔符不敏感')
currentCwd = 'c:/WORK/Alpha/'
eq('c:/WORK/Alpha/ 视作同一工作区', (await credentials.resolve('DEEPSEEK_API_KEY'))?.value, 'sk-alpha-secret')

console.log('\n[10] 非工作区目录也可单独配置（未分组会话）')
const looseSet = await callRoute('/set', 'POST', { path: DIR_ONLY, title: 'loose', key: 'sk-loose' })
eq('/set 未注册目录返回 200', looseSet.status, 200)
const looseEntry = (looseSet.body.workspaces ?? []).find((ws) => ws.path === DIR_ONLY)
eq('未注册目录被标成 orphan', looseEntry?.kind, 'orphan')
currentCwd = DIR_ONLY
eq('loose → 自己的 key', (await credentials.resolve('DEEPSEEK_API_KEY'))?.value, 'sk-loose')
currentCwd = WS_A
eq('alpha 仍然是自己的 key', (await credentials.resolve('DEEPSEEK_API_KEY'))?.value, 'sk-alpha-secret')

console.log('\n[11] 清空 = 回到系统默认')
const clearRes = await callRoute('/set', 'POST', { path: WS_A, useDefault: true })
eq('清除返回 200', clearRes.status, 200)
const alphaAfter = (clearRes.body.workspaces ?? []).find((ws) => ws.path === WS_A)
eq('alpha 恢复为未配置', alphaAfter?.configured, false)
currentCwd = WS_A
eq('alpha 回到默认 key', (await credentials.resolve('DEEPSEEK_API_KEY'))?.value, 'sk-default')
eq('专属 ref 已从凭据库删除', creds.has(alphaRef), false)

console.log('\n[12] 失效检测：agent/request-error → 标记 + 状态接口可见')
await callRoute('/set', 'POST', { path: WS_B, title: 'beta', key: 'sk-beta-secret' })
currentCwd = WS_B
await errorListeners[0](
  { agent: { session: { header: { cwd: WS_B } } }, failure: { status: 401, message: 'Authentication Fails, invalid api key' } },
  async () => ({ kind: 'continue' }),
)
const stateRes = await callRoute('/state', 'GET')
const betaEntry = (stateRes.body.workspaces ?? []).find((ws) => ws.path === WS_B)
eq('beta 被标记 invalid', betaEntry?.invalid?.status, 'invalid')
check('失效原因可见', typeof betaEntry?.invalid?.message === 'string' && betaEntry.invalid.message.includes('Authentication'))

console.log('\n[13] 429 / 配额 / 其它错误不误判')
currentCwd = WS_B
await errorListeners[0](
  { agent: { session: { header: { cwd: WS_B } } }, failure: { status: 429, message: 'rate limit' } },
  async () => ({}),
)
const stateRes2 = await callRoute('/clear-flag', 'POST', { path: WS_B })
const betaAfter = (stateRes2.body.workspaces ?? []).find((ws) => ws.path === WS_B)
eq('clear-flag 后标记消失', betaAfter?.invalid, null)
currentCwd = WS_C
await errorListeners[0](
  { agent: { session: { header: { cwd: WS_C } } }, failure: { status: 500, message: 'boom' } },
  async () => ({}),
)
const stateRes3 = await callRoute('/state', 'GET')
const gammaEntry = (stateRes3.body.workspaces ?? []).find((ws) => ws.path === WS_C)
eq('500 不被当作失效', gammaEntry?.invalid, null)

console.log('\n[14] 非 loopback 请求被拒')
const evil = await (async () => {
  const req = {
    url: '/wsk-api/state', method: 'GET',
    headers: { host: '127.0.0.1:43120' },
    socket: { remoteAddress: '10.0.0.5' },
    on() { return req }, destroy() {},
  }
  let status = 0
  const res = { writeHead(c) { status = c; return res }, end() { return res } }
  await routes[0].handler(req, res)
  return status
})()
eq('外网地址 403', evil, 403)

console.log('\n[15] rx: 跨源请求被拒（origin host 不匹配）')
const crossOrigin = await (async () => {
  const req = {
    url: '/wsk-api/state', method: 'GET',
    headers: { host: '127.0.0.1:43120', origin: 'http://evil.example' },
    socket: { remoteAddress: '127.0.0.1' },
    on() { return req }, destroy() {},
  }
  let status = 0
  const res = { writeHead(c) { status = c; return res }, end() { return res } }
  await routes[0].handler(req, res)
  return status
})()
eq('跨源 403', crossOrigin, 403)

console.log('\n[16] 状态文件已落盘')
const statePath = stateRes.body.statePath
check('statePath 指向 DSH_HOME/storages', statePath === join(TMP, 'storages', 'dsh-workspace-api-key.json'), statePath)
check('状态文件存在', existsSync(statePath))

console.log('\n[17] 幂等：再次 apply 不会套娃')
const before = credentials.resolve
apply(ctx)
eq('resolve 未被再次包装', credentials.resolve, before)

console.log('\n[18] 诊断接口 /resolve')
currentCwd = WS_B
const diag = await callRoute('/resolve', 'GET')
eq('诊断回报 activeCwd', diag.body.activeCwd, WS_B)
eq('诊断回报命中工作区', diag.body.workspace?.title, 'beta')
eq('诊断回报 override 生效', diag.body.overrideActive, true)

console.log('\n[19] 测试连接：端点形状与各状态码')

// 给 alpha 配一把专属 key（前面的用例可能已把它清掉）
await callRoute('/set', 'POST', { path: WS_A, key: 'sk-alpha-1234567890' })

const realFetch = globalThis.fetch
const fetchCalls = []
function stubFetch(handler) {
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init })
    return handler(String(url), init)
  }
}
function fakeRes(status, body) {
  return { ok: status >= 200 && status < 300, status, statusText: String(status), text: async () => body ?? '' }
}
const lastCall = () => fetchCalls[fetchCalls.length - 1]

stubFetch(() => fakeRes(200, '{"ok":true}'))
const okTest = await callRoute('/test', 'POST', { path: WS_A })
eq('探针命中真实端点（补了 /v1）', lastCall().url, 'https://api.deepseek.com/anthropic/v1/messages')
eq('探针带 x-api-key', lastCall().init.headers['x-api-key'], 'sk-alpha-1234567890')
eq('探针请求体带模型名', JSON.parse(lastCall().init.body).model, 'deepseek-flash')
eq('200 → ok', okTest.body.test?.verdict, 'ok')
check('测试响应不含明文 key', !JSON.stringify(okTest.body).includes('sk-alpha-1234567890'))

stubFetch(() => fakeRes(401, '{"error":{"message":"Authentication Fails, invalid api key"}}'))
const badTest = await callRoute('/test', 'POST', { path: WS_A })
eq('401 → invalid', badTest.body.test?.verdict, 'invalid')
check('失效记到该工作区的 ref', /^DEEPSEEK_API_KEY_WS_[0-9A-F]{16}$/.test(String(badTest.body.test?.marked)), badTest.body.test?.marked)

stubFetch(() => fakeRes(429, '{"error":{"message":"rate limited"}}'))
eq('429 → rate-limit', (await callRoute('/test', 'POST', { path: WS_A })).body.test?.verdict, 'rate-limit')

stubFetch(() => fakeRes(402, '{"error":{"message":"insufficient balance"}}'))
eq('402 → quota', (await callRoute('/test', 'POST', { path: WS_A })).body.test?.verdict, 'quota')

stubFetch(() => fakeRes(404, ''))
const notFound = (await callRoute('/test', 'POST', { path: WS_A })).body.test
eq('404 → error（不再伪装成连不上）', notFound?.verdict, 'error')
check('404 提示里带端点', String(notFound?.detail).includes('404') && String(notFound?.detail).includes('/messages'), notFound?.detail)

stubFetch(() => {
  throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { name: 'TypeError' })
})
const dead = (await callRoute('/test', 'POST', { path: WS_A })).body.test
eq('网络失败 → unreachable', dead?.verdict, 'unreachable')
eq('网络失败 status 0', dead?.status, 0)

stubFetch(() => fakeRes(200, '{}'))
currentCwd = undefined
const defaultTest = await callRoute('/test', 'POST', {})
eq('默认卡片测的是默认 ref', defaultTest.body.keyTail, 'ault')
eq('默认卡片也是真实端点', lastCall().url, 'https://api.deepseek.com/anthropic/v1/messages')
globalThis.fetch = realFetch

// ───────────────────────────── 收尾 ─────────────────────────────

rmSync(TMP, { recursive: true, force: true })

console.log(`\n${checks - failures}/${checks} 通过`)
if (failures > 0) {
  console.log(`${failures} 个断言失败`)
  process.exit(1)
}
console.log('全部通过')
