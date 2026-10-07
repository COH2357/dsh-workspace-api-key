# dsh-workspace-api-key

[English](README.md) | [中文](README.zh.md)

A DeepSeek Harness plugin that binds a separate DeepSeek API key to each workspace.

DSH resolves the DeepSeek key from one global credential ref (default `DEEPSEEK_API_KEY`), so every session in every workspace spends the same key. This plugin adds a panel that gives individual workspaces their own key, so the spend of a key stays with the sessions that ran in that workspace. Workspaces without their own key keep using the system default.

## What you get

- **A sidebar row** labelled `API Key 分配`, placed directly under the host's own Plugins row, opening a full-area page.
- **Per-workspace keys** — every workspace registered with the `workspaceRegistry` service is listed, with its own key field.
- **A system-default card** — which ref is in effect, where its value comes from (`file`, `env`, …), and its masked value.
- **Connection test** — one real `POST <baseURL>/messages` request (`max_tokens: 1`) with that key, reported as `ok`, `invalid`, `quota`, `rate-limit` or `unreachable`.
- **Stale-key warning** — 401/403 marks a bound key `invalid`, 402 marks it `quota`, 429 marks it `rate-limit`. The next time you open the panel, affected workspaces are reported and you can *reconfigure*, *fall back to the system default*, or dismiss.
- **One-click revert** — clearing an entry deletes the generated credential ref and returns that workspace to the system default.

## How it works

Host half (`lib/index.js`):

- wraps `credentials.resolve` once per process (restored on dispose through `ctx.effect`) instead of registering a second service or provider route, neither of which cordis allows for a name that is already taken;
- reads the active session's directory from `agents.currentInitiator()?.session?.header?.cwd` — the agent loop runs the whole turn inside that async scope, so the value is available when the credential is resolved;
- matches that directory against `workspaceRegistry.list()` after normalizing both sides (absolute, trailing separator removed, lower-cased on Windows);
- derives a stable per-directory ref `DEEPSEEK_API_KEY_WS_<first 16 hex chars of sha1(normalized path), upper-cased>`, writes the key through the credentials service, and serves that ref's value for the workspace;
- rewrites only refs a provider actually reads: the default ref, every adapter's configured `apiKeyEnv`, and its own generated refs. Every other ref passes through untouched;
- keeps its own bookkeeping (which directory maps to which ref, invalid flags) in `$DSH_HOME/storages/dsh-workspace-api-key.json`;
- observes failures through the `agent/request-error` waterfall without ever returning `{kind: 'retry'}` — it only records the verdict and calls `next()`.

Browser half (`lib/client.js`) registers into the `sidebar.panellist` slot (`order: 1`) and the `main` slot (key `workspace-api-key`), the same slots `dsh-skill-mcp-panel` uses. It is plain `React.createElement` with no build step and no bundled dependencies.

### HTTP API (loopback only)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/wsk-api/state` | default ref status, workspace list, overrides, invalid flags |
| GET | `/wsk-api/resolve` | which workspace the current session's `cwd` resolves to right now |
| POST | `/wsk-api/set` | `{path, title, key}` binds a key to that directory; `{useDefault: true}` or an empty key clears it |
| POST | `/wsk-api/test` | `{path}` (or `{ref}`, or `{key}`) runs one real request and returns the verdict |
| POST | `/wsk-api/clear-flag` | `{path}` drops the invalid/quota flag |

Only loopback callers are accepted (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) with a same-origin or absent `Origin`. No response ever contains a plaintext key, only a mask.

`/wsk-api/set` also accepts directories that are not registered workspaces; such entries are listed in the panel next to the workspaces they belong to.

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
node test/host.test.mjs     # 55 assertions
node test/client.test.mjs   # 48 assertions
```

Neither suite needs a running DSH process. The host suite drives `apply()` against a mock context (fake `credentials`, `workspaceRegistry`, `agents`, `webServer`, stubbed `fetch`) and covers ref derivation, workspace matching, redirecting a second adapter's `apiKeyEnv`, clearing back to the default, 401/402/429/5xx classification, the loopback and origin checks, and state persistence. The client suite loads `lib/client.js` through a minimal `window.__ModuleLoader__` plus a small React runtime, renders the panel, and asserts slot registration, the first render, the stale-key prompt, saving, the connection test, flag clearing and back-navigation.

## Requirements and limits

- Verified against DSH Desktop 2.0.17 with `@deepseek-ai/dsh*` 0.2.0-rc.2 and `@deepseek-ai/cordis` 4.0.4. It has no runtime dependency and imports no `@deepseek-ai/*` package — only the host services (`credentials`, `workspaceRegistry`, `agents`, `webServer`, `llm`, `settings`) and Node built-ins.
- The binding is per directory and applies to whichever provider route reads a wrapped ref. It is not per session and not per model.
- Keys are stored through the credentials service in `$DSH_HOME/.credentials.yaml` under `refs:`, in plaintext, exactly like the default key. They are not written into session logs, the plugin's state file, or the plugin directory.
- Matching is textual after normalization. If a session's `cwd` is a symlink or junction to a registered workspace path, it will not match and the system default is used.
- Uninstalling the plugin leaves the generated `*_WS_*` refs in the credentials file; remove them from the Models page.

## License

MIT
