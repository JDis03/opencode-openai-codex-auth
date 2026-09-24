# OpenCode 2 Plugin Port — Root Cause & Design

**Status**: Implemented (v4.10.0). Structurally verified live against a real OpenCode 2.0.15
host (loads with a valid schema and a real plugin ID, hooks register without error). The
final request/response transformation path is covered by unit tests
(`test/v2.test.ts`) but has **not yet been exercised against a live Codex backend request**
under V2, because that requires a human to complete an interactive OAuth login (see
"What's left to verify" below) — this plugin cannot complete that step on its own.

## The report

> "vamos a actualizar la portabilidad a v2 de opencode actualize y quedo el plugin incompatible"

## Root cause (confirmed empirically, not guessed)

1. The user's OpenCode CLI is genuinely OpenCode 2 (`opencode --version` → `v2.0.15`,
   binary at `~/.local/share/opencode2/versions/2.0.15/@opencode/cli/bin/opencode.exe`,
   package name `@opencode/cli` — the V2 release renamed the npm scope from
   `@opencode-ai` to `@opencode`).
2. OpenCode 2 has an intentional, documented breaking change: "V1 plugin implementations do
   not run in V2" (https://opencode.ai/v2/docs/migrate-v1#plugins). A V1 plugin exports a
   bare async function; V2 requires `export default Plugin.define({ id, setup(ctx) {...} })`.
3. Reproduced directly against the live host with `--print-logs --log-level=debug`:
   - Our plugin (referenced as `file:///home/dark/Project/openai/dist/index.js` in
     `opencode.json`'s V1 `plugin` array) failed even earlier than the schema check:
     `"configured plugin path must be a directory" target=.../dist/index.js` — V2's
     `plugin`/`plugins` loader expects a package **directory** (resolved via its
     `package.json` `main`/`exports`), not a direct path to a compiled `.js` file.
   - Once that's fixed, the V1 default export itself would still fail: other V1-shaped
     plugins in the same environment (`magic-compact@latest`, `opencode-claude-auth-fix`)
     hit exactly `PluginModule.LoadError: ... SchemaError(Expected object at ["default"])`
     — the same shape our `index.ts` exports (`export default OpenAIAuthPlugin` where
     `OpenAIAuthPlugin` is an async function, not a `Plugin.define(...)` object).
4. **Why some things still "worked" before this fix**: OpenCode 2 ships its own **built-in**
   ChatGPT/Codex OAuth handling for the `openai` integration (methods `chatgpt-browser` /
   `chatgpt-headless`, confirmed via `opencode api GET /api/integration` — labels match
   `packages/opencode/src/plugin/openai/codex.ts` in the opencode monorepo verbatim). With
   this plugin absent from `opencode plugin list` entirely, a request like
   `openai/gpt-6-sol` still completed successfully — but via OpenCode 2's own minimal
   Codex handling, **not** through this plugin's Codex system instructions, CODEX_MODE
   bridge, model-registry reasoning normalization, or skill-catalog passthrough. Confirmed
   by enabling `ENABLE_PLUGIN_REQUEST_LOGGING=1` and observing that
   `~/.opencode/logs/codex-plugin/` was never created for that request.

## Reference implementation

`/home/dark/Project/opencode-anthropic-dark-auth` (same author's separate Anthropic OAuth
plugin) already has a working, tested, previously-verified-live V2 port
(`src/v2.ts`, built as `dist/v2.js`) solving the structurally identical problem
(custom OAuth + custom HTTP request/response transformation for a single provider). Its
`README.md` documents a critical V2 API limitation that shaped this port's design:

> "V2's integration method can own new logins; there is no public API to import an existing
> OAuth credential into its connection store at setup... If [the provider] is not active in
> OpenCode, the HTTP hooks will not run."

## Design decisions

- **Dual export, same package** (`package.json` `exports`): root (`.`) resolves to the new
  V2 build (`dist/v2.js`); `./legacy` resolves to the unchanged V1 build (`dist/index.js`).
  V1 users are unaffected — all 276 pre-existing tests pass unmodified.
- **Business logic untouched**: every existing `lib/` module (model registry,
  `transformRequestForCodex`, `createCodexHeaders`, `handleErrorResponse`/
  `handleSuccessResponse`, skill-catalog passthrough, CODEX_MODE bridge, ...) is reused
  as-is. Only the *glue* layer changed — how the plugin receives requests and how OAuth is
  wired — because that logic operates on plain URLs/headers/JSON bodies, not on any
  V1-specific type.
- **HTTP interception**: `ctx.session.hook("http.request" | "http.response", ..., {
  providerID: "openai" })` replaces the V1 custom `fetch()` override. Requests are filtered
  to the Responses API path (`isResponsesRequest()`) before any transformation, mirroring
  dark-auth's `anthropicMessages()` guard.
- **Own OAuth method** (`ctx.integration.transform` → `editor.method.update({ integrationID:
  "openai", method: { id: "codex-auth", type: "oauth", label: AUTH_LABELS.OAUTH_V2 },
  authorize, refresh })`), registered *alongside* OpenCode 2's built-in `chatgpt-browser`/
  `chatgpt-headless` methods, not replacing them. Reuses the exact same PKCE flow
  (`lib/auth/auth.ts`), local callback server (`lib/auth/server.ts`), and browser opener
  (`lib/auth/browser.ts`) as the V1 plugin. The `authorize()` callback dynamically returns
  `mode: "auto"` (if the local server on port 1455 binds) or `mode: "code"` (manual paste
  fallback) — unifying V1's two separate auth methods into one, since V2's
  `IntegrationOAuthAuthorization` type supports choosing the mode per invocation.
- **Own credential storage** (`lib/auth/v2-storage.ts`): a small, single-account,
  atomically-written JSON file at `~/.opencode/openai-codex-v2-credentials.json` — *not*
  `ctx.storage` (dark-auth deliberately avoided it for credentials; scoping/semantics
  weren't confirmed reliable enough for this use case) and *not* a write to opencode's own
  `auth.json` (V1's storage, left untouched). On first use, if this file doesn't exist yet,
  a **read-only** best-effort import of the legacy V1 `openai` OAuth credential from
  `~/.local/share/opencode/auth.json` pre-fills it — convenient for token reuse, but per the
  dark-auth limitation above, this alone cannot make OpenCode 2 treat `openai` as "actively
  connected" through this plugin; the user must still complete the new OAuth method once.

## What's left to verify

- [x] `npm run typecheck`, `npm test` (289/289, +13 new), `npm run build` all clean.
- [x] Structural load verified live: `opencode plugin list` (run from a location where the
  plugin is discovered) shows `opencode-openai-codex-auth` with a real ID and `local` source
  — the exact failure signature every other broken V1 plugin in the same environment shows
  (blank ID, `SchemaError`) is absent for this one.
- [ ] **Full live request through the new hooks**: requires a human to run
  `opencode auth login`, select `openai` → `ChatGPT Plus/Pro (Codex Auth)`, and complete the
  browser OAuth flow, so OpenCode 2 marks `openai` as actively connected through this
  plugin's method (a prerequisite this plugin cannot satisfy on its own). Once done, a
  request like `opencode run "say OK" --model=openai/gpt-6-sol` should populate
  `~/.opencode/logs/codex-plugin/` again (with `ENABLE_PLUGIN_REQUEST_LOGGING=1`), the same
  signal used throughout this project's history to confirm the transform pipeline actually
  ran.
- [ ] Retry/backoff hook (`ctx.session.hook("retry", ...)`) — V1 never implemented
  provider-side retry logic itself (it delegated to opencode's own retry handling), so this
  is not a regression, but V2's `retry` hook could let this plugin special-case Codex-specific
  errors (e.g. the `usage_limit_reached` → 429 remap already done in
  `mapUsageLimit404()`) more precisely than a generic HTTP-status-based retry. Left as
  future work.
- [ ] Publish under the new dual-export shape (npm publish still blocked — see prior
  session notes on the `npm whoami` 401 / package name ownership question).
