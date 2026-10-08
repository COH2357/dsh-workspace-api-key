# dsh-workspace-api-key

[English](README.md) | [中文](README.zh.md)

A DeepSeek Harness plugin that binds a separate DeepSeek API key to each workspace — or to a single session.

DSH resolves the DeepSeek key from one global credential ref (default `DEEPSEEK_API_KEY`), so every session in every workspace spends the same key. This plugin adds a panel that gives individual workspaces — and, when you need it, individual sessions — their own key, so the spend of a key stays with the sessions that ran there. Anything without its own key keeps using the level above it:

```
session key  →  workspace key  →  system default
```

## What you get

- **A sidebar row** labelled `API Key 分配`, placed directly under the host's own Plugins row, opening a full-area page.
- **Per-workspace keys** — every workspace registered with the `workspaceRegistry` service is listed, with its own key field.
- **Per-session keys** — each workspace row expands (collapsed by default) to the sessions that live in that directory, each with its own key. Sessions that inherit a key from the level above say so instead of pretending to have one.
- **A system-default card** — which ref is in effect, where its value comes from (`file`, `env`, …), and its masked value.
- **Connection test** — one real `POST <baseURL>/messages` request (`max_tokens: 1`) with that key, reported as `ok`, `invalid`, `quota`, `rate-limit` or `unreachable`. A successful test also clears a stale flag.
- **Stale-key warning** — 401/403 marks a bound key `invalid`, 402 marks it `quota`, 429 marks it `rate-limit`. When you enter a session whose effective key is flagged, an overlay tells you what happened and offers *go configure*, *fall back to the level above*, or dismiss.
- **Mismatch warning** — if the key you bound was recorded for one provider (say `deepseek-official`) and the session now runs on another, entering that session reports it, because that request would be sent with a key the provider does not accept.
- **No silent substitution** — neither warning ever changes which key is used. The decision stays with you, which is the whole point: an automatically swapped key would defeat the billing separation.
- **One-click revert** — clearing a session entry falls back to the workspace key, clearing a workspace entry falls back to the system default.

## How it works

Host half (`lib/index.js`):

- wraps `credentials.resolve` once per process (restored on dispose through `ctx.effect`) instead of registering a second service or provider route, neither of which cordis allows for a name that is already taken;
- reads the active session's directory and id from `agents.currentInitiator()?.session` — the agent loop runs the whole turn inside that async scope, so both are available when the credential is resolved, and the resolver picks the most specific level that has a key;
- matches that directory against `workspaceRegistry.list()` after normalizing both sides (absolute, trailing separator removed, lower-cased on Windows);
- derives a stable ref per level — `DEEPSEEK_API_KEY_WS_<first 16 hex chars of sha1(normalized path), upper-cased>` for a workspace and `DEEPSEEK_API_KEY_SS_<first 16 hex chars of sha1(session id), upper-cased>` for a session (a session id contains `-` and cannot be a ref name) — writes the key through the credentials service, and serves that ref's value;
- rewrites only refs a provider actually reads: the default ref, every adapter's configured `apiKeyEnv`, and its own generated refs. Every other ref passes through untouched;
- builds the session list from the `sessionController` service (`list()`, unwrapping its `{items: […]}` envelope) and falls back to the live `sessions` service (`ctx.get('sessions').list()`), so the panel still has sessions when the controller is missing, throws, or returns an empty list — subagent sessions are filtered out of that fallback;
- reports its own version and a session probe (`available`, `shape`, `source`, `count`, `withoutCwd`, `samples`, `error`, plus sample workspace paths) in `/wsk-api/state`, so the panel can say *why* no sessions are listed: a stale host half (only a page reload instead of an app restart), a missing `sessionController`, a throwing `list()`, an unexpected envelope shape, or a `cwd` that matches no workspace path;
- keeps its own bookkeeping (which level maps to which ref, invalid flags, the provider a key was recorded for) in `$DSH_HOME/storages/dsh-workspace-api-key.json`;
- observes failures through the `agent/request-error` waterfall without ever returning `{kind: 'retry'}` — it only records the verdict and calls `next()`.

The browser half (`lib/client.js`) registers into the `sidebar.panellist` slot (`order: 1`), the `main` slot (key `workspace-api-key`) and the `shell.overlay` slot (the entering-a-session warning), the same slots `dsh-skill-mcp-panel` and `dsh-429-guard` use. It is plain `React.createElement` with no build step and no bundled dependencies. It merges the host rows with the browser-side `sessions` store (`ctx.get('sessions').list.getSnapshot()`, which is what the sidebar itself renders), so session titles come from `displayTitle`, host rows are never dropped when that store only knows a subset, and sessions stay visible even when the host cannot list them. That store is provided by `dsh-api-session-controller` *after* the plugin's `apply()`, so both the panel and the overlay retry for it (every 500 ms, at most 40 times) instead of giving up on the first render. The overlay asks `/wsk-api/check?sessionId=…&path=…` about the session that currently owns the main view, asks at most once per session, and its buttons only ever navigate to the panel — the panel is where a key can actually be changed.

### HTTP API (loopback only)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/wsk-api/state` | default ref status, workspaces with their sessions, overrides, invalid flags, plugin version and session probe |
| GET | `/wsk-api/resolve` | which level and ref the current session resolves to right now |
| GET | `/wsk-api/check` | `?sessionId=…&path=…` — read-only verdict for one session: effective level, key, stale flag, provider mismatch, `needsAttention` |
| POST | `/wsk-api/set` | `{scope: 'workspace' \| 'session', path \| sessionId, title, key, provider?}` binds a key; `{useDefault: true}` or an empty key clears it |
| POST | `/wsk-api/test` | `{scope, path \| sessionId \| ref}` (or `{key}`) runs one real request and returns the verdict; `invalid` marks the flag, `ok` clears it |
| POST | `/wsk-api/clear-flag` | `{ref}` or a target drops the invalid/quota flag |

Only loopback callers are accepted (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) with a same-origin or absent `Origin`. No response ever contains a plaintext key, only a mask.

Workspace targets may be directories that are not registered workspaces; such entries appear as ungrouped directories next to the workspaces they belong to.

## Install

Install through the market (设置 → 插件市场) once the plugin is listed, or manually:

```sh
# in the profile directory, e.g. ~/.dsh/profiles/desktop
pnpm add "dsh-workspace-api-key@github:COH2357/dsh-workspace-api-key"
```

Then add `"dsh-workspace-api-key"` to `dsh.profile.bundles` in that profile's `package.json` and restart DSH. For local development, use a link instead:

```jsonc
"dependencies": { "dsh-workspace-api-key": "link:/path/to/dsh-workspace-api-key" }
```

## Tests

```sh
node test/host.test.mjs     # 125 assertions
node test/client.test.mjs   # 130 assertions
```

Neither suite needs a running DSH process. The host suite drives `apply()` against a mock context (fake `credentials`, `workspaceRegistry`, `agents`, `sessionController`, `sessions`, `webServer`, stubbed `fetch`) and covers ref derivation, the session → workspace → default cascade, workspace matching, redirecting a second adapter's `apiKeyEnv`, clearing back to the default, 401/402/429/5xx classification, the loopback and origin checks, state persistence, and the session probe including the `{items}` envelope and the live-session fallback. The client suite loads `lib/client.js` through a minimal `window.__ModuleLoader__` plus a small React runtime, renders the panel and the overlay, and asserts slot registration, the first render, session expand/collapse, per-session saving and testing, sessions recovered from the browser-side store when the host has none (with `displayTitle` winning and subagent sessions hidden), the ungrouped-directory card, the stale and mismatch prompts, the "go configure" hand-off, graceful degradation without a session list, and back-navigation when `ctx.get('layout')` only becomes available after the plugin was applied.

## Requirements and limits

- Verified against DSH Desktop 2.0.17 with `@deepseek-ai/dsh*` 0.2.0-rc.2 and `@deepseek-ai/cordis` 4.0.4. It has no runtime dependency and imports no `@deepseek-ai/*` package — only the host services (`credentials`, `workspaceRegistry`, `agents`, `sessionController`, `webServer`, `llm`, `settings`) and Node built-ins.
- One key per level: a session has a single key whichever provider route reads it, and a key recorded for one provider is reported as a mismatch when the session runs on another. Model changes inside one provider are not treated as a mismatch, because a DeepSeek key is account-wide.
- Sessions are matched to a workspace by their directory (`cwd`). The host's own `list()` skips stored sessions that never got a `cwd`, and the live-session fallback only knows sessions that are currently loaded, so the panel may show fewer sessions than the sidebar. Sessions visible only in the browser-side store carry no `cwd` of their own beyond the one the sidebar knows.
- The connection test speaks the Anthropic Messages shape (`POST <baseURL>/messages` with `x-api-key` and `anthropic-version: 2023-06-01`), which is what the DeepSeek route uses. A provider that speaks a different protocol can still have keys bound per level, but the test may report a failure for a key that works.
- Keys are stored through the credentials service in `$DSH_HOME/.credentials.yaml` under `refs:`, in plaintext, exactly like the default key. They are not written into session logs, the plugin's state file, or the plugin directory.
- Matching is textual after normalization. If a session's `cwd` is a symlink or junction to a registered workspace path, it will not match and the level above is used.
- Uninstalling the plugin leaves the generated `*_WS_*` / `*_SS_*` refs in the credentials file; remove them from the Models page.
- If the panel lists workspaces but no expandable sessions, read the diagnostics line at the bottom of the panel. A red "the host half is still an older version" banner means the DSH process was never restarted: the host half is loaded once at startup, so closing the window or reloading the page is not enough — fully quit DSH Desktop and open it again. Otherwise the diagnostics line shows how many sessions the host sees (and from which source: `sessionController`, its live-session fallback, or the browser store), plus sample session `cwd` values next to sample workspace paths when none of them match.

## License

MIT
