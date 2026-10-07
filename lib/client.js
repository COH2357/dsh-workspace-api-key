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
    const DEFAULT_KEY = '__default__'

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
  color: inherit; cursor: pointer; padding: 4px 6px; border-radius: 6px; font: inherit; }
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
.wsk-msg.info { background: var(--wsk-bg); color: var(--wsk-dim); }
.wsk-dialog-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
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

    // ─────────────────────────────── 主页面 ───────────────────────────────

    function WorkspaceKeyPage(props) {
      const layout = props?.layout
      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [editing, setEditing] = useState(null)
      const [testing, setTesting] = useState(null)
      const [tests, setTests] = useState({})
      const [notice, setNotice] = useState(null)
      const [prompt, setPrompt] = useState(null)

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

      const close = () => {
        if (layout !== undefined && layout !== null && typeof layout.selectPanel === 'function') {
          layout.selectPanel(null)
        }
      }

      const applyState = (next) => { if (alive.current) setState(next) }

      const save = async (ws, key, { quiet = false } = {}) => {
        const trimmed = typeof key === 'string' ? key.trim() : ''
        const wasDefault = ws.configured !== true
        setBusy(true)
        try {
          const body = trimmed === ''
            ? { path: ws.path, title: ws.title, useDefault: true }
            : { path: ws.path, title: ws.title, key: trimmed }
          const next = await api('/set', { method: 'POST', body: JSON.stringify(body) })
          applyState(next)
          setEditing(null)
          if (!quiet) {
            setNotice({
              kind: 'ok',
              text: trimmed === ''
                ? (wasDefault ? `${ws.title}：本来就使用系统默认设置` : `${ws.title}：已改为使用系统默认设置`)
                : `${ws.title}：已保存专属 key`,
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

      const runTest = async (target, key) => {
        setTesting(target.key)
        setNotice(null)
        try {
          const body = { path: target.path }
          if (typeof key === 'string' && key.trim() !== '') body.key = key.trim()
          const res = await api('/test', { method: 'POST', body: JSON.stringify(body) })
          if (!alive.current) return
          setTests((prev) => ({ ...prev, [target.key]: res.test }))
          setNotice({
            kind: res.test?.ok === true ? 'ok' : 'bad',
            text: `${target.title}：${verdictText(res.test?.verdict)}` +
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

      const clearFlag = async (ws) => {
        setBusy(true)
        try {
          applyState(await api('/clear-flag', { method: 'POST', body: JSON.stringify({ path: ws.path }) }))
          if (alive.current) {
            setTests((prev) => ({ ...prev, [ws.path]: undefined }))
            setNotice({ kind: 'info', text: `${ws.title}：已清除失效标记` })
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
      const defaultRef = state?.defaultRef

      const renderRow = (ws) => {
        const reason = invalidReason(ws.invalid)
        const lastTest = tests[ws.path]
        const isEditing = editing !== null && editing.path === ws.path
        const isTesting = testing !== null && testing === ws.path
        return h('div', { key: `${ws.kind ?? 'ws'}:${ws.path}` },
          h('div', { className: 'wsk-row' },
            h('div', { className: 'wsk-row-main' },
              h('div', { className: 'wsk-name' },
                h('span', { key: 'n' }, ws.title),
                reason !== undefined
                  ? h('span', { key: 's', className: 'wsk-badge bad', title: reason }, 'key 已失效')
                  : ws.configured === true
                    ? h('span', { key: 's', className: 'wsk-badge ok' }, '专属 key')
                    : h('span', { key: 's', className: 'wsk-badge' }, '系统默认'),
                ws.kind !== 'workspace'
                  ? h('span', { key: 'o', className: 'wsk-badge warn' }, '目录已不存在')
                  : null,
                lastTest !== undefined && lastTest !== null
                  ? h('span', {
                      key: 't',
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
                    onClick: () => clearFlag(ws),
                  }, '清除标记')
                : null,
              h('button', {
                key: 'test', type: 'button', className: 'wsk-btn', disabled: isTesting || busy,
                onClick: () => runTest({ key: ws.path, path: ws.path, title: ws.title }),
              }, isTesting ? '测试中…' : '测试连接'),
              h('button', {
                key: 'cfg', type: 'button', className: 'wsk-btn',
                onClick: () => setEditing(isEditing ? null : { path: ws.path, title: ws.title, key: '' }),
              }, isEditing ? '收起' : '配置'))),

          isEditing
            ? h('div', { className: 'wsk-editor' },
                h('div', { className: 'wsk-hint' },
                  ws.configured === true
                    ? `该工作区当前使用专属 key${ws.keyMasked ? `（${ws.keyMasked}）` : ''}。留空并保存即恢复使用系统默认。`
                    : '为该工作区指定一把专属 key；留空并保存即继续使用系统默认。'),
                h('input', {
                  className: 'wsk-input',
                  type: 'text',
                  autoComplete: 'off',
                  spellCheck: false,
                  placeholder: 'sk-…（留空 = 使用系统默认设置）',
                  value: editing.key,
                  onChange: (ev) => setEditing({ path: ws.path, title: ws.title, key: ev.target.value }),
                  onKeyDown: (ev) => { if (ev.key === 'Enter') save(ws, editing.key) },
                }),
                h('div', { className: 'wsk-dialog-actions' },
                  h('button', {
                    type: 'button', className: 'wsk-btn primary', disabled: busy,
                    onClick: () => save(ws, editing.key),
                  }, busy ? '保存中…' : '保存'),
                  h('button', {
                    type: 'button', className: 'wsk-btn', disabled: busy || editing.key.trim() === '',
                    onClick: () => runTest({ key: ws.path, path: ws.path, title: ws.title }, editing.key),
                  }, '用这把 key 测试'),
                  h('button', {
                    type: 'button', className: 'wsk-btn',
                    onClick: () => setEditing(null),
                  }, '取消')),
                h('div', { className: 'wsk-hint' }, `凭据引用：${ws.ref ?? '—'}`))
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
                setEditing({ path: ws.path, title: ws.title, key: '' })
              },
            },
            {
              label: '改用系统设置',
              onClick: async () => { setPrompt(null); await save(ws, '', { quiet: true }) },
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
          h('span', { className: 'wsk-sub' }, '按工作区隔离计费'),
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

          h('div', { className: 'wsk-card' },
            h('h4', null, '系统默认设置'),
            h('div', { className: 'wsk-row' },
              h('div', { className: 'wsk-row-main' },
                h('div', { className: 'wsk-name' },
                  h('span', { key: 'r' }, defaultRef?.ref ?? 'DEEPSEEK_API_KEY'),
                  defaultRef?.configured === true
                    ? h('span', { key: 's', className: 'wsk-badge ok' },
                        `已配置${defaultRef.source ? ` · ${defaultRef.source}` : ''}`)
                    : h('span', { key: 's', className: 'wsk-badge bad' }, '未配置'),
                  defaultRef?.writable === false
                    ? h('span', { key: 'w', className: 'wsk-badge warn' }, '被环境变量遮蔽（只读）')
                    : null),
                h('div', { className: 'wsk-hint' },
                  '没有单独配置的工作区，一律使用这把 key。',
                  defaultRef?.keyMasked ? ` 当前值：${defaultRef.keyMasked}` : '')),
              h('div', { className: 'wsk-actions' },
                h('button', {
                  type: 'button', className: 'wsk-btn',
                  disabled: busy || testing !== null || defaultRef?.configured !== true,
                  onClick: () => runTest({ key: DEFAULT_KEY, path: undefined, title: '系统默认' }),
                }, testing === DEFAULT_KEY ? '测试中…' : '测试连接')))),

          h('div', { className: 'wsk-card', style: { background: 'transparent', border: 0, padding: 0 } },
            h('h4', { style: { marginBottom: 6 } }, `工作区（${grouped.length}）`),
            grouped.length === 0
              ? h('div', { className: 'wsk-hint' }, '还没有工作区。先在侧栏「工作区」里新建一个。')
              : h('div', { className: 'wsk-list' }, grouped.map(renderRow))),

          orphans.length > 0
            ? h('div', { className: 'wsk-card' },
                h('h4', null, `已失效的配置（${orphans.length}）`),
                h('div', { className: 'wsk-hint', style: { marginBottom: 6 } },
                  '这些目录已经不是注册的工作区了，对应的 key 仍留在凭据库里。可改用系统默认以清理。'),
                h('div', { className: 'wsk-list' }, orphans.map(renderRow)))
            : null,

          h('div', { className: 'wsk-hint' },
            '专属 key 存进 DSH 凭据库中的独立引用，因此换 key 不写进会话日志、也不影响历史回放。',
            state?.statePath ? h('div', null, `状态文件：${state.statePath}`) : null)),

        renderPrompt())
    }

    // ─────────────────────────────── 插件入口 ───────────────────────────────

    function apply(ctx) {
      ensureStyles()
      const slots = ctx.get('slots')
      if (slots === undefined || slots === null) return
      const layout = ctx.get('layout')

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
          inject: () => ({ layout }),
        }, WorkspaceKeyPage)), 'workspace-api-key: main page')
    }

    exports.apply = apply
    exports.inject = ['slots']
    return exports
  },
})
