window.__ModuleLoader__.load({
  id: 'dsh-workspace-api-key',
  factory: (require) => {
    const exports = {}
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const API_BASE = '/wsk-api'
    const STYLE_ID = 'wsk-styles'
    const PANEL_ID = 'workspace-api-key'
    const OVERLAY_ID = 'workspace-api-key-watch'
    const DEFAULT_KEY = '__default__'
    const DEFAULT_REF = 'DEEPSEEK_API_KEY'

    // 覆盖层（提醒）与主面板之间的桥：同一个模块实例里的两个组件。
    //   focus   —— 覆盖层点「去配置」时，把要编辑的会话交给面板
    //   refresh —— 面板挂载后在这里登记自己的刷新函数
    const bridge = { focus: null, refresh: null }

    // ─────────────────────────────── 样式 ───────────────────────────────

    const CSS = `
.wsk { --wsk-border: color-mix(in srgb, currentColor 16%, transparent);
  --wsk-dim: color-mix(in srgb, currentColor 58%, transparent);
  --wsk-faint: color-mix(in srgb, currentColor 42%, transparent);
  --wsk-bg: color-mix(in srgb, currentColor 5%, transparent);
  --wsk-ok: #16a34a; --wsk-warn: #d97706; --wsk-bad: #dc2626;
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  font-size: 13px; color: inherit; }
.wsk * { box-sizing: border-box; }
.wsk-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  border-bottom: 1px solid var(--wsk-border); flex-wrap: wrap; }
.wsk-back { display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent;
  color: inherit; cursor: pointer; padding: 4px 8px; border-radius: 6px; font: inherit; }
.wsk-back:hover { background: var(--wsk-bg); }
.wsk-title { font-weight: 600; font-size: 14px; }
.wsk-sub { color: var(--wsk-dim); font-size: 12px; }
.wsk-spacer { flex: 1 1 auto; }
.wsk-btn { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--wsk-border);
  background: transparent; color: inherit; cursor: pointer; padding: 4px 10px;
  border-radius: 6px; font: inherit; font-size: 12px; white-space: nowrap; }
.wsk-btn:hover:not(:disabled) { background: var(--wsk-bg); }
.wsk-btn:disabled { opacity: .45; cursor: default; }
.wsk-btn.primary { border-color: transparent; background: #2563eb; color: #fff; }
.wsk-btn.primary:hover:not(:disabled) { background: #1d4ed8; }
.wsk-btn.danger { color: var(--wsk-bad); }
.wsk-body { flex: 1 1 auto; overflow: auto; padding: 14px; max-width: 980px; width: 100%; }
.wsk-card { border: 1px solid var(--wsk-border); border-radius: 10px; padding: 12px 14px;
  margin-bottom: 14px; background: var(--wsk-bg); }
.wsk-card h4 { margin: 0 0 8px; font-size: 13px; font-weight: 600; }
.wsk-row { display: flex; align-items: center; gap: 10px; padding: 10px 4px; }
.wsk-list .wsk-row + .wsk-row { border-top: 1px solid var(--wsk-border); }
.wsk-row-main { flex: 1 1 auto; min-width: 0; }
.wsk-name { font-weight: 500; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.wsk-path { color: var(--wsk-faint); font-size: 11px; margin-top: 2px; word-break: break-all; }
.wsk-badge { display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px; border-radius: 999px;
  font-size: 11px; border: 1px solid var(--wsk-border); color: var(--wsk-dim); white-space: nowrap; }
.wsk-badge.ok { color: var(--wsk-ok); border-color: color-mix(in srgb, var(--wsk-ok) 40%, transparent); }
.wsk-badge.bad { color: var(--wsk-bad); border-color: color-mix(in srgb, var(--wsk-bad) 40%, transparent); }
.wsk-badge.warn { color: var(--wsk-warn); border-color: color-mix(in srgb, var(--wsk-warn) 40%, transparent); }
.wsk-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.wsk-editor { padding: 10px 12px; border: 1px solid var(--wsk-border); border-radius: 8px;
  margin: 4px 0 10px; display: flex; flex-direction: column; gap: 8px; }
.wsk-input { width: 100%; padding: 7px 9px; border: 1px solid var(--wsk-border); border-radius: 6px;
  background: transparent; color: inherit; font: inherit; font-size: 12px; }
.wsk-input:focus { outline: 2px solid color-mix(in srgb, #2563eb 45%, transparent); outline-offset: -1px; }
.wsk-hint { color: var(--wsk-dim); font-size: 11px; line-height: 1.6; }
.wsk-msg { padding: 7px 10px; border-radius: 6px; font-size: 12px; line-height: 1.5; }
.wsk-msg.ok { background: color-mix(in srgb, var(--wsk-ok) 12%, transparent); color: var(--wsk-ok); }
.wsk-msg.bad { background: color-mix(in srgb, var(--wsk-bad) 12%, transparent); color: var(--wsk-bad); }
.wsk-msg.warn { background: color-mix(in srgb, var(--wsk-warn) 14%, transparent); color: var(--wsk-warn); }
.wsk-msg.info { background: var(--wsk-bg); color: var(--wsk-dim); }
.wsk-dialog-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.wsk-toggle { display: inline-flex; align-items: center; gap: 3px; border: 0; background: transparent;
  color: var(--wsk-dim); cursor: pointer; padding: 2px 5px; border-radius: 5px; font: inherit; font-size: 11px; }
.wsk-toggle:hover { background: var(--wsk-bg); }
.wsk-sessions { margin: 0 0 8px 10px; padding-left: 10px; border-left: 1px solid var(--wsk-border);
  display: flex; flex-direction: column; }
.wsk-sess { display: flex; align-items: center; gap: 8px; padding: 7px 2px; }
.wsk-sess + .wsk-sess { border-top: 1px solid color-mix(in srgb, currentColor 8%, transparent); }
.wsk-sess-main { flex: 1 1 auto; min-width: 0; }
.wsk-sess-title { font-size: 12px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.wsk-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
.wsk-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex;
  align-items: center; justify-content: center; z-index: 9999; }
.wsk-dialog { width: min(560px, calc(100vw - 40px)); border-radius: 12px; padding: 18px 20px;
  background: var(--wsk-dialog-bg, #ffffff); color: var(--wsk-dialog-fg, #111111);
  box-shadow: 0 18px 50px rgba(0,0,0,.35); display: flex; flex-direction: column; gap: 12px;
  font-size: 13px; }
.wsk-dialog h3 { margin: 0; font-size: 15px; }
.wsk-dialog .wsk-hint { color: color-mix(in srgb, currentColor 65%, transparent); }
.wsk-dialog .wsk-btn { border-color: color-mix(in srgb, currentColor 25%, transparent); }
.wsk-dialog .wsk-btn:hover:not(:disabled) { background: color-mix(in srgb, currentColor 8%, transparent); }
.wsk-kv { display: flex; gap: 6px; font-size: 12px; line-height: 1.7; }
.wsk-kv-key { color: color-mix(in srgb, currentColor 60%, transparent); flex: 0 0 auto; min-width: 74px; }
@media (prefers-color-scheme: dark) {
  .wsk-dialog { --wsk-dialog-bg: #1f2124; --wsk-dialog-fg: #f2f2f2; }
}
`

    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // ─────────────────────────────── 工具 ───────────────────────────────

    async function api(path, options) {
      const init = { headers: { 'content-type': 'application/json' }, ...options }
      let res
      try {
        res = await window.fetch(`${API_BASE}${path}`, init)
      } catch (err) {
        throw new Error(`无法访问插件宿主接口（${String(err?.message ?? err)}）`)
      }
      let body = null
      try {
        body = await res.json()
      } catch {
        throw new Error(`宿主接口返回了非 JSON 响应（HTTP ${res.status}）`)
      }
      if (body === null || body === undefined) throw new Error(`宿主接口返回空响应（HTTP ${res.status}）`)
      if (res.ok !== true || body.ok === false) throw new Error(body.error ?? `HTTP ${res.status}`)
      return body
    }

    function prettyPath(p) {
      if (typeof p !== 'string' || p === '') return ''
      return p.replace(/^[A-Za-z]:\\Users\\[^\\]+\\/i, '~\\')
    }

    function verdictText(verdict) {
      switch (verdict) {
        case 'ok': return '连接正常'
        case 'invalid': return 'key 无效'
        case 'quota': return '余额不足'
        case 'rate-limit': return '被限流'
        case 'unreachable': return '无法连接'
        default: return '测试失败'
      }
    }

    function invalidReason(flag) {
      if (flag === null || flag === undefined) return undefined
      if (flag.status !== 'invalid') return undefined
      return flag.message ?? '鉴权失败'
    }

    // 生效层级：会话级 > 工作区级 > 系统默认
    function levelText(level) {
      switch (level) {
        case 'session': return '本会话专属'
        case 'workspace': return '工作区专属'
        default: return '系统默认'
      }
    }

    function levelClass(level) {
      return level === 'session' || level === 'workspace' ? 'wsk-badge ok' : 'wsk-badge'
    }

    function mismatchText(mismatch) {
      if (mismatch === null || mismatch === undefined) return undefined
      const key = mismatch.keyProvider ?? '未记录服务商'
      const session = mismatch.sessionProvider ?? '未知'
      return `这把 key 是为「${key}」准备的，当前会话用的是「${session}」`
    }

    function sessionLabel(session) {
      const title = typeof session.title === 'string' && session.title !== '' ? session.title : undefined
      return title ?? (session.blank === true ? '（空会话）' : String(session.sessionId).slice(0, 12))
    }

    function modelText(session) {
      if (typeof session.provider !== 'string' || session.provider === '') return '模型未知'
      return `${session.provider} / ${session.model ?? '默认模型'}`
    }

    // ─────────────────────────────── 图标 ───────────────────────────────

    function keySvg(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      },
        h('circle', { key: 'c', cx: 8, cy: 12, r: 3.4 }),
        h('path', { key: 'a', d: 'M11.4 12H20.5' }),
        h('path', { key: 'b', d: 'M17.8 12v3' }),
        h('path', { key: 'd', d: 'M14.8 12v2.2' }))
    }

    function KeyIcon(props) { return keySvg(props?.size ?? 16) }

    function chevronSvg(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      }, h('path', { d: 'M10 3.5 5.5 8l4.5 4.5' }))
    }

    function refreshSvg(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      }, h('path', { key: 'a', d: 'M21 12a9 9 0 1 1-2.64-6.36' }), h('path', { key: 'b', d: 'M21 4v5h-5' }))
    }

    function caretSvg(size, open) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      }, open ? h('path', { d: 'M3.5 6 8 10.5 12.5 6' }) : h('path', { d: 'M6 3.5 10.5 8 6 12.5' }))
    }

    // ─────────────────────────────── 弹窗 ───────────────────────────────

    function Dialog(props) {
      return h('div', {
        className: 'wsk-overlay',
        onClick: (ev) => { if (ev.target === ev.currentTarget) props.onDismiss?.() },
      },
        h('div', { className: 'wsk-dialog', role: 'dialog', 'aria-modal': 'true' },
          h('h3', null, props.title),
          typeof props.body === 'string'
            ? h('div', { className: 'wsk-hint' }, props.body)
            : props.body,
          h('div', { className: 'wsk-dialog-actions' },
            (props.actions ?? []).map((action, index) =>
              h('button', {
                key: index,
                type: 'button',
                className: `wsk-btn${action.primary === true ? ' primary' : ''}`,
                onClick: action.onClick,
              }, action.label)))))
    }

    function kv(key, value) {
      return h('div', { className: 'wsk-kv', key },
        h('span', { className: 'wsk-kv-key' }, key),
        h('span', null, value))
    }

    // ─────────────────────────────── 主页面 ───────────────────────────────

    function WorkspaceKeyPage(props) {
      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [editing, setEditing] = useState(null)
      const [testing, setTesting] = useState(null)
      const [tests, setTests] = useState({})
      const [notice, setNotice] = useState(null)
      const [prompt, setPrompt] = useState(null)
      const [expanded, setExpanded] = useState(() => new Set())

      const alive = useRef(true)
      const prompted = useRef(false)

      useEffect(() => {
        ensureStyles()
        alive.current = true
        return () => { alive.current = false }
      }, [])

      const refresh = useCallback(async () => {
        setBusy(true)
        try {
          const next = await api('/state')
          if (typeof globalThis !== 'undefined' && globalThis.__WSK_TRACE__ === true) {
            console.log('[wsk] got /state alive=' + alive.current + ' workspaces=' + (next.workspaces ?? []).length)
          }
          if (!alive.current) return
          setState(next)
          setError(null)
          // 覆盖层点「去配置」时留下的焦点：展开对应工作区并直接打开会话编辑器。
          if (bridge.focus !== null) {
            const focus = bridge.focus
            bridge.focus = null
            if (typeof focus.path === 'string' && focus.path !== '') {
              setExpanded((prev) => new Set(prev).add(focus.path))
            }
            setEditing({
              kind: 'session',
              path: focus.path,
              sessionId: focus.sessionId,
              title: focus.title,
              provider: focus.provider,
              model: focus.model,
              ref: focus.ref,
              key: '',
            })
          }
          if (!prompted.current) {
            const stale = (next.workspaces ?? []).find(
              (ws) => ws.configured === true && invalidReason(ws.invalid) !== undefined)
            if (stale !== undefined) {
              prompted.current = true
              setPrompt({ kind: 'stale', ws: stale })
            } else if (next.defaultRef?.configured !== true) {
              prompted.current = true
              setPrompt({ kind: 'no-default' })
            }
          }
        } catch (err) {
          if (alive.current) setError(String(err?.message ?? err))
        } finally {
          if (alive.current) setBusy(false)
        }
      }, [])

      useEffect(() => { refresh() }, [refresh])

      // 让覆盖层能立刻刷新面板（点「去配置」时面板可能已经挂载着）。
      useEffect(() => {
        bridge.refresh = refresh
        return () => { if (bridge.refresh === refresh) bridge.refresh = null }
      }, [refresh])

      // 「返回」：惰性取 layout，避免在 apply 阶段就把 undefined 缓存下来。
      const close = () => { props?.back?.() }

      const applyState = (next) => { if (alive.current) setState(next) }

      const toggle = (key) => setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })

      const save = async (target, key, { quiet = false } = {}) => {
        const trimmed = typeof key === 'string' ? key.trim() : ''
        const scope = target.kind === 'session' ? 'session' : 'workspace'
        const wasCleared = target.kind === 'session' ? false : target.configured !== true
        setBusy(true)
        try {
          const body = {
            scope,
            title: target.title,
          }
          if (scope === 'session') body.sessionId = target.sessionId
          else body.path = target.path
          if (typeof target.provider === 'string' && target.provider !== '') body.provider = target.provider
          if (typeof target.model === 'string' && target.model !== '') body.model = target.model
          if (trimmed === '') body.useDefault = true
          else body.key = trimmed
          const next = await api('/set', { method: 'POST', body: JSON.stringify(body) })
          applyState(next)
          setEditing(null)
          if (!quiet) {
            setNotice({
              kind: 'ok',
              text: trimmed === ''
                ? `${target.title}：已改用${scope === 'session' ? '上层' : '系统默认'}设置`
                : target.kind === 'session'
                  ? `${target.title}：已保存本会话专属 key`
                  : wasCleared
                    ? `${target.title}：已改用系统默认设置`
                    : `${target.title}：已保存专属 key`,
            })
          }
          return true
        } catch (err) {
          if (alive.current) setNotice({ kind: 'bad', text: String(err?.message ?? err) })
          return false
        } finally {
          if (alive.current) setBusy(false)
        }
      }

      const runTest = async (id, title, body, key) => {
        setTesting(id)
        setNotice(null)
        try {
          const payload = { ...body }
          if (typeof key === 'string' && key.trim() !== '') payload.key = key.trim()
          const res = await api('/test', { method: 'POST', body: JSON.stringify(payload) })
          if (!alive.current) return
          setTests((prev) => ({ ...prev, [id]: res.test }))
          setNotice({
            kind: res.test?.ok === true ? 'ok' : 'bad',
            text: `${title}：${verdictText(res.test?.verdict)}` +
              (res.test?.detail ? ` — ${res.test.detail}` : '') +
              (res.test?.latencyMs ? `（${res.test.latencyMs}ms）` : ''),
          })
          applyState(await api('/state'))
        } catch (err) {
          if (alive.current) setNotice({ kind: 'bad', text: String(err?.message ?? err) })
        } finally {
          if (alive.current) setTesting(null)
        }
      }

      const clearFlag = async (id, body, title) => {
        setBusy(true)
        try {
          applyState(await api('/clear-flag', { method: 'POST', body: JSON.stringify(body) }))
          if (alive.current) {
            setTests((prev) => ({ ...prev, [id]: undefined }))
            setNotice({ kind: 'info', text: `${title}：已清除失效标记` })
          }
        } catch (err) {
          if (alive.current) setNotice({ kind: 'bad', text: String(err?.message ?? err) })
        } finally {
          if (alive.current) setBusy(false)
        }
      }

      const workspaces = state?.workspaces ?? []
      const grouped = workspaces.filter((ws) => ws.kind === 'workspace')
      const orphans = workspaces.filter((ws) => ws.kind !== 'workspace')
      const ungrouped = state?.ungrouped ?? []
      const defaultRef = state?.defaultRef
      const providers = state?.providers ?? []

      const providerOptions = (current, fallback) => {
        const list = [...providers]
        for (const candidate of [current, fallback]) {
          if (typeof candidate === 'string' && candidate !== '' && !list.includes(candidate)) list.push(candidate)
        }
        return [h('option', { key: '__none', value: '' }, '（不指定）')].concat(
          list.map((name) => h('option', { key: name, value: name }, name)))
      }

      const renderEditor = (target) => {
        const isSession = target.kind === 'session'
        const current = isSession ? target.level : target.configured === true ? 'workspace' : 'default'
        const fallbackLabel = isSession
          ? `清除本会话配置（改回${target.workspaceConfigured === true ? '工作区' : '系统默认'}）`
          : '改用系统默认'
        return h('div', { className: 'wsk-editor' },
          h('div', { className: 'wsk-hint' },
            isSession
              ? `当前生效：${levelText(current)}${target.keyMasked ? `（${target.keyMasked}）` : ''}。`
              : target.configured === true
                ? `该工作区当前使用专属 key${target.keyMasked ? `（${target.keyMasked}）` : ''}。留空并保存即恢复使用系统默认。`
                : '为该工作区指定一把专属 key；留空并保存即继续使用系统默认。'),
          h('input', {
            className: 'wsk-input',
            type: 'text',
            autoComplete: 'off',
            spellCheck: false,
            placeholder: 'sk-…（留空 = 使用上层设置）',
            value: target.key,
            onChange: (ev) => setEditing({ ...target, key: ev.target.value }),
            onKeyDown: (ev) => { if (ev.key === 'Enter') save(target, target.key) },
          }),
          h('div', null,
            h('div', { className: 'wsk-hint' }, '这把 key 属于哪个服务商（用于进入会话时判断是否匹配）'),
            h('select', {
              className: 'wsk-input',
              value: typeof target.provider === 'string' ? target.provider : '',
              onChange: (ev) => setEditing({ ...target, provider: ev.target.value }),
            }, providerOptions(target.provider, isSession ? target.sessionProvider : undefined))),
          h('div', { className: 'wsk-dialog-actions' },
            h('button', {
              type: 'button', className: 'wsk-btn primary', disabled: busy,
              onClick: () => save(target, target.key),
            }, busy ? '保存中…' : '保存'),
            h('button', {
              type: 'button', className: 'wsk-btn', disabled: busy || target.key.trim() === '',
              onClick: () => runTest(target.id, target.title, target.testBody, target.key),
            }, '用这把 key 测试'),
            target.configured === true || (isSession && target.level !== 'default')
              ? h('button', {
                  type: 'button', className: 'wsk-btn', disabled: busy,
                  onClick: () => save({ ...target, key: '' }, ''),
                }, fallbackLabel)
              : null,
            h('button', {
              type: 'button', className: 'wsk-btn',
              onClick: () => setEditing(null),
            }, '取消')),
          h('div', { className: 'wsk-hint' }, `凭据引用：${target.ref ?? '—'}`))
      }

      const renderSession = (ws, session) => {
        const id = `ss:${session.sessionId}`
        const reason = invalidReason(session.invalid)
        const mismatch = mismatchText(session.mismatch)
        const lastTest = tests[id]
        const isEditing = editing !== null && editing.kind === 'session' && editing.sessionId === session.sessionId
        const isTesting = testing === id
        const hasOwn = session.configured === true
        return h('div', { key: id },
          h('div', { className: 'wsk-sess' },
            h('div', { className: 'wsk-sess-main' },
              h('div', { className: 'wsk-sess-title' },
                h('span', { key: 't' }, sessionLabel(session)),
                h('span', { key: 'l', className: levelClass(session.level) }, levelText(session.level)),
                reason !== undefined
                  ? h('span', { key: 'i', className: 'wsk-badge bad', title: reason }, 'key 已失效')
                  : null,
                session.mismatch !== null && session.mismatch !== undefined
                  ? h('span', { key: 'm', className: 'wsk-badge warn', title: mismatch }, '服务商不匹配')
                  : null,
                lastTest !== undefined && lastTest !== null
                  ? h('span', {
                      key: 'tt',
                      className: `wsk-badge ${lastTest.ok === true ? 'ok' : 'bad'}`,
                    }, verdictText(lastTest.verdict))
                  : null),
              h('div', { className: 'wsk-path' },
                `${modelText(session)}` +
                (session.effectiveKeyMasked ? ` · 生效 key ${session.effectiveKeyMasked}` : ' · 未配置 key') +
                (hasOwn && session.keyMasked ? ` · 本会话 ${session.keyMasked}` : '')),
              reason !== undefined
                ? h('div', { className: 'wsk-hint', style: { color: 'var(--wsk-bad)', marginTop: 3 } }, reason)
                : null,
              mismatch !== undefined
                ? h('div', { className: 'wsk-hint', style: { color: 'var(--wsk-warn)', marginTop: 3 } }, mismatch)
                : null),
            h('div', { className: 'wsk-actions' },
              reason !== undefined
                ? h('button', {
                    key: 'clear', type: 'button', className: 'wsk-btn', disabled: busy,
                    onClick: () => clearFlag(id, { ref: session.effectiveRef }, sessionLabel(session)),
                  }, '清除标记')
                : null,
              h('button', {
                key: 'test', type: 'button', className: 'wsk-btn', disabled: isTesting || busy,
                onClick: () => runTest(id, sessionLabel(session), { scope: 'session', sessionId: session.sessionId }),
              }, isTesting ? '测试中…' : '测试连接'),
              h('button', {
                key: 'cfg', type: 'button', className: 'wsk-btn',
                onClick: () => setEditing(isEditing ? null : {
                  kind: 'session',
                  id,
                  path: ws.path,
                  sessionId: session.sessionId,
                  title: sessionLabel(session),
                  ref: session.ref,
                  key: '',
                  provider: session.overrideProvider ?? session.provider ?? '',
                  sessionProvider: session.provider,
                  model: session.overrideModel ?? session.model,
                  level: session.level,
                  keyMasked: session.effectiveKeyMasked,
                  configured: hasOwn,
                  workspaceConfigured: ws.configured === true,
                  testBody: { scope: 'session', sessionId: session.sessionId },
                }),
              }, isEditing ? '收起' : '配置'))),
          isEditing ? renderEditor(editing) : null)
      }

      const renderWorkspace = (ws, options = {}) => {
        const reason = invalidReason(ws.invalid)
        const id = `ws:${ws.path}`
        const lastTest = tests[id]
        const sessions = Array.isArray(ws.sessions) ? ws.sessions : []
        const open = expanded.has(ws.path)
        const isEditing = editing !== null && editing.kind === 'workspace' && editing.path === ws.path
        const isTesting = testing === id
        const title = ws.title
        return h('div', { key: `${ws.kind ?? 'ws'}:${id}` },
          h('div', { className: 'wsk-row' },
            h('div', { className: 'wsk-row-main' },
              h('div', { className: 'wsk-name' },
                sessions.length > 0
                  ? h('button', {
                      key: 'tgl', type: 'button', className: 'wsk-toggle',
                      title: open ? '折叠会话' : '展开会话',
                      onClick: () => toggle(ws.path),
                    }, caretSvg(12, open), h('span', null, `会话 ${sessions.length}`))
                  : null,
                h('span', { key: 'n' }, title),
                reason !== undefined
                  ? h('span', { key: 's', className: 'wsk-badge bad', title: reason }, 'key 已失效')
                  : ws.configured === true
                    ? h('span', { key: 's', className: 'wsk-badge ok' }, '专属 key')
                    : h('span', { key: 's', className: 'wsk-badge' }, '系统默认'),
                ws.kind !== 'workspace'
                  ? h('span', { key: 'o', className: 'wsk-badge warn' },
                      ws.kind === 'directory' ? '未分组目录' : '目录已不存在')
                  : null,
                lastTest !== undefined && lastTest !== null
                  ? h('span', {
                      key: 'tt',
                      className: `wsk-badge ${lastTest.ok === true ? 'ok' : 'bad'}`,
                    }, verdictText(lastTest.verdict))
                  : null),
              h('div', { className: 'wsk-path' }, prettyPath(ws.path)),
              reason !== undefined
                ? h('div', { className: 'wsk-hint', style: { color: 'var(--wsk-bad)', marginTop: 4 } }, reason)
                : null),
            h('div', { className: 'wsk-actions' },
              reason !== undefined
                ? h('button', {
                    key: 'clear', type: 'button', className: 'wsk-btn', disabled: busy,
                    onClick: () => clearFlag(id, { path: ws.path }, title),
                  }, '清除标记')
                : null,
              h('button', {
                key: 'test', type: 'button', className: 'wsk-btn', disabled: isTesting || busy,
                onClick: () => runTest(id, title, { path: ws.path }),
              }, isTesting ? '测试中…' : '测试连接'),
              h('button', {
                key: 'cfg', type: 'button', className: 'wsk-btn',
                onClick: () => setEditing(isEditing ? null : {
                  kind: 'workspace',
                  id,
                  path: ws.path,
                  title,
                  ref: ws.ref,
                  key: '',
                  provider: ws.overrideProvider ?? (sessions[0]?.provider ?? ''),
                  model: undefined,
                  configured: ws.configured === true,
                  keyMasked: ws.keyMasked,
                  testBody: { path: ws.path },
                }),
              }, isEditing ? '收起' : '配置'))),
          isEditing ? renderEditor(editing) : null,
          sessions.length > 0 && open
            ? h('div', { className: 'wsk-sessions' }, sessions.map((session) => renderSession(ws, session)))
            : null)
      }

      const renderPrompt = () => {
        if (prompt === null) return null
        if (prompt.kind === 'no-default') {
          return h(Dialog, {
            title: '尚未配置系统默认 API Key',
            body: '当前没有任何可用的 DEEPSEEK_API_KEY。可以到「设置 → 模型」里配置系统默认 key，' +
              '也可以直接为某个工作区写一把专属 key。',
            onDismiss: () => setPrompt(null),
            actions: [{ label: '知道了', onClick: () => setPrompt(null) }],
          })
        }
        const ws = prompt.ws
        const reason = invalidReason(ws.invalid)
        return h(Dialog, {
          title: `${ws.title} 的 API Key 已失效`,
          body: h('div', null,
            h('div', null, reason),
            h('div', { className: 'wsk-hint', style: { marginTop: 6 } }, `工作区：${prettyPath(ws.path)}`),
            h('div', { className: 'wsk-hint' }, '可以重新配置这把 key，或让该工作区改用系统默认设置。')),
          onDismiss: () => setPrompt(null),
          actions: [
            {
              label: '重新配置', primary: true,
              onClick: () => {
                setPrompt(null)
                setExpanded((prev) => new Set(prev).add(ws.path))
                setEditing({
                  kind: 'workspace',
                  id: `ws:${ws.path}`,
                  path: ws.path,
                  title: ws.title,
                  ref: ws.ref,
                  key: '',
                  provider: ws.overrideProvider ?? '',
                  configured: true,
                  keyMasked: ws.keyMasked,
                  testBody: { path: ws.path },
                })
              },
            },
            {
              label: '改用系统设置',
              onClick: async () => {
                setPrompt(null)
                await save({
                  kind: 'workspace', id: `ws:${ws.path}`, path: ws.path, title: ws.title,
                  configured: true, key: '',
                }, '', { quiet: true })
              },
            },
            { label: '稍后', onClick: () => setPrompt(null) },
          ],
        })
      }

      return h('div', { className: 'wsk' },
        h('div', { className: 'wsk-head' },
          h('button', {
            type: 'button', className: 'wsk-back', onClick: close, title: '返回会话',
          }, chevronSvg(14), h('span', null, '返回')),
          h('span', { className: 'wsk-title' }, 'API Key 分配'),
          h('span', { className: 'wsk-sub' }, '按工作区 / 会话隔离计费'),
          h('span', { className: 'wsk-spacer' }),
          h('button', {
            type: 'button', className: 'wsk-btn', disabled: busy, onClick: refresh,
          }, refreshSvg(14), h('span', null, busy ? '刷新中…' : '刷新'))),

        h('div', { className: 'wsk-body' },
          notice !== null
            ? h('div', { className: `wsk-msg ${notice.kind}`, style: { marginBottom: 12 } }, notice.text)
            : null,
          error !== null
            ? h('div', { className: 'wsk-msg bad', style: { marginBottom: 12 } },
                `读取失败：${error}`,
                h('div', { className: 'wsk-hint' }, '请确认 DSH Web 服务正在运行、且本插件的宿主半边已加载。'))
            : null,
          state !== null && state.sessionListAvailable === false
            ? h('div', { className: 'wsk-msg info', style: { marginBottom: 12 } },
                '当前 DSH 版本没有提供会话列表服务，只能按工作区配置 key。')
            : null,

          h('div', { className: 'wsk-card' },
            h('h4', null, '系统默认设置'),
            h('div', { className: 'wsk-row' },
              h('div', { className: 'wsk-row-main' },
                h('div', { className: 'wsk-name' },
                  h('span', { key: 'r' }, defaultRef?.ref ?? DEFAULT_REF),
                  defaultRef?.configured === true
                    ? h('span', { key: 's', className: 'wsk-badge ok' },
                        `已配置${defaultRef.source ? ` · ${defaultRef.source}` : ''}`)
                    : h('span', { key: 's', className: 'wsk-badge bad' }, '未配置'),
                  defaultRef?.writable === false
                    ? h('span', { key: 'w', className: 'wsk-badge warn' }, '被环境变量遮蔽（只读）')
                    : null),
                h('div', { className: 'wsk-hint' },
                  '没有单独配置的工作区/会话，一律使用这把 key。',
                  defaultRef?.keyMasked ? ` 当前值：${defaultRef.keyMasked}` : '')),
              h('div', { className: 'wsk-actions' },
                h('button', {
                  type: 'button', className: 'wsk-btn',
                  disabled: busy || testing !== null || defaultRef?.configured !== true,
                  onClick: () => runTest(DEFAULT_KEY, '系统默认', { ref: defaultRef?.ref ?? DEFAULT_REF }),
                }, testing === DEFAULT_KEY ? '测试中…' : '测试连接')))),

          h('div', { className: 'wsk-card', style: { background: 'transparent', border: 0, padding: 0 } },
            h('h4', { style: { marginBottom: 6 } }, `工作区（${grouped.length}）`),
            h('div', { className: 'wsk-hint', style: { marginBottom: 6 } },
              '展开工作区可以看到它下面的会话，并单独给某个会话指定 key（会话 > 工作区 > 系统默认）。'),
            grouped.length === 0
              ? h('div', { className: 'wsk-hint' }, '还没有工作区。先在侧栏「工作区」里新建一个。')
              : h('div', { className: 'wsk-list' }, grouped.map((ws) => renderWorkspace(ws)))),

          ungrouped.length > 0
            ? h('div', { className: 'wsk-card' },
                h('h4', null, `未分组目录（${ungrouped.length}）`),
                h('div', { className: 'wsk-hint', style: { marginBottom: 6 } },
                  '这些目录里的会话没有挂在工作区下（侧栏的「未分组」），同样可以单独配置。'),
                h('div', { className: 'wsk-list' }, ungrouped.map((ws) => renderWorkspace(ws))))
            : null,

          orphans.length > 0
            ? h('div', { className: 'wsk-card' },
                h('h4', null, `已失效的配置（${orphans.length}）`),
                h('div', { className: 'wsk-hint', style: { marginBottom: 6 } },
                  '这些目录已经不是注册的工作区了，对应的 key 仍留在凭据库里。可改用系统默认以清理。'),
                h('div', { className: 'wsk-list' }, orphans.map((ws) => renderWorkspace(ws))))
            : null,

          h('div', { className: 'wsk-hint' },
            '专属 key 存进 DSH 凭据库中的独立引用，因此换 key 不写进会话日志、也不影响历史回放。',
            state?.statePath ? h('div', null, `状态文件：${state.statePath}`) : null)),

        renderPrompt())
    }

    // ─────────────────────── 进入会话时的提醒（覆盖层） ───────────────────────

    function createOverlayWatcher(ctx) {
      return function ApiKeyWatch() {
        const [prompt, setPrompt] = useState(null)
        const asked = useRef(new Set())

        useEffect(() => {
          ensureStyles()
          const sessions = ctx.get('sessions')
          if (sessions === undefined || sessions === null) return undefined

          let disposed = false
          const currentSessionId = () => {
            try {
              const snapshot = sessions.list?.getSnapshot?.()
              const byId = snapshot?.byId ?? {}
              for (const [id, item] of Object.entries(byId)) {
                if (Number(item?.retainedBy?.mainView) > 0) return id
              }
            } catch {
              /* 快照不可用时静默跳过 */
            }
            return undefined
          }

          const evaluate = async () => {
            const sessionId = currentSessionId()
            if (sessionId === undefined || asked.current.has(sessionId)) return
            asked.current.add(sessionId)
            try {
              const res = await api(`/check?sessionId=${encodeURIComponent(sessionId)}`)
              if (disposed) return
              if (res.needsAttention === true) setPrompt(res)
            } catch {
              /* 宿主接口不可用时不打扰用户 */
            }
          }

          evaluate()
          const unsubscribe = typeof sessions.list?.subscribe === 'function'
            ? sessions.list.subscribe(() => { evaluate() })
            : undefined
          return () => {
            disposed = true
            if (typeof unsubscribe === 'function') unsubscribe()
          }
        }, [])

        const openPanel = () => {
          const res = prompt
          if (res !== null) {
            bridge.focus = {
              sessionId: res.sessionId,
              path: res.workspaceScope?.path ?? res.cwd ?? undefined,
              title: res.title ?? undefined,
              provider: res.provider ?? undefined,
              model: res.model ?? undefined,
              ref: res.sessionScope?.ref ?? undefined,
            }
          }
          try {
            const layout = ctx.get('layout')
            if (layout !== null && typeof layout === 'object' && typeof layout.selectPanel === 'function') {
              layout.selectPanel(PANEL_ID)
            }
          } catch {
            /* layout 不可用时至少留下焦点 */
          }
          if (typeof bridge.refresh === 'function') bridge.refresh()
          setPrompt(null)
        }

        const useUpperLevel = async () => {
          const res = prompt
          setPrompt(null)
          if (res === null) return
          try {
            const body = res.level === 'session'
              ? { scope: 'session', sessionId: res.sessionId, useDefault: true }
              : { scope: 'workspace', path: res.workspaceScope?.path ?? res.cwd, useDefault: true }
            await api('/set', { method: 'POST', body: JSON.stringify(body) })
          } catch {
            /* 用户点不动就保持原样，绝不悄悄改 key */
          }
        }

        if (prompt === null) return null
        const invalid = invalidReason(prompt.invalid)
        const mismatch = mismatchText(prompt.mismatch)
        return h(Dialog, {
          title: invalid !== undefined ? '这个会话用的 API Key 已失效' : '这个会话的 API Key 可能不匹配',
          body: h('div', null,
            kv('会话', prompt.title ?? String(prompt.sessionId ?? '').slice(0, 12)),
            kv('模型', `${prompt.provider ?? '未知'} / ${prompt.model ?? '默认模型'}`),
            kv('生效 key', `${levelText(prompt.level)}${prompt.keyMasked ? ` · ${prompt.keyMasked}` : ''}`),
            invalid !== undefined
              ? h('div', { className: 'wsk-hint', style: { marginTop: 8, color: 'var(--wsk-bad)' } }, invalid)
              : null,
            mismatch !== undefined
              ? h('div', { className: 'wsk-hint', style: { marginTop: 8, color: 'var(--wsk-warn)' } }, mismatch)
              : null,
            h('div', { className: 'wsk-hint', style: { marginTop: 8 } },
              '插件不会自动更换 key —— 用哪把 key 由你决定，避免计费被悄悄改到别的账号上。')),
          onDismiss: () => setPrompt(null),
          actions: [
            { label: '去配置', primary: true, onClick: openPanel },
            ...(invalid !== undefined
              ? [{ label: res2Upper(prompt), onClick: useUpperLevel }]
              : []),
            { label: invalid !== undefined ? '稍后' : '继续用当前 key', onClick: () => setPrompt(null) },
          ],
        })
      }
    }

    function res2Upper(prompt) {
      return prompt.level === 'session' ? '清除本会话配置' : '改用系统默认'
    }

    // ─────────────────────────────── 插件入口 ───────────────────────────────

    function apply(ctx) {
      ensureStyles()
      const slots = ctx.get('slots')
      if (slots === undefined || slots === null) return

      // 惰性取 layout：点击时才读，避免服务尚未就绪时把 undefined 缓存下来。
      const back = () => {
        try {
          const layout = ctx.get('layout')
          if (layout === null || typeof layout !== 'object') return false
          if (typeof layout.selectPanel !== 'function') return false
          layout.selectPanel(null)
          return true
        } catch {
          return false
        }
      }

      ctx.effect(() => slots.inject('sidebar.panellist', () =>
        slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 1,
          label: () => 'API Key 分配',
        }, KeyIcon)), 'workspace-api-key: sidebar row')

      ctx.effect(() => slots.inject('main', () =>
        slots.register({
          name: 'main',
          key: PANEL_ID,
          inject: () => ({ back }),
        }, WorkspaceKeyPage)), 'workspace-api-key: main page')

      ctx.effect(() => slots.inject('shell.overlay', () =>
        slots.register({
          name: 'shell.overlay',
          id: OVERLAY_ID,
          order: 60,
          label: 'API Key 提醒',
        }, createOverlayWatcher(ctx))), 'workspace-api-key: session entry watcher')
    }

    exports.apply = apply
    exports.inject = ['slots', 'layout']
    return exports
  },
})
