# AGENTS.md

This file provides coding guidance for AI agents (including Claude Code, Codex, and others) when working with code in this repository.

## Overview

This is an **opencode plugin** that enables OAuth authentication with OpenAI's ChatGPT Plus/Pro Codex backend. It allows users to access `gpt-5.2-codex`, `gpt-5.1-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`, `gpt-5.2`, and `gpt-5.1` models through their ChatGPT subscription instead of using OpenAI Platform API credits. Legacy GPT-5.0 models are automatically normalized to their GPT-5.1 equivalents.

**Key architecture principle**: 7-step fetch flow that intercepts opencode's OpenAI SDK requests, transforms them for the ChatGPT backend API, and handles OAuth token management.

## Build & Test Commands

```bash
# Build (compiles TypeScript + copies HTML file)
npm run build

# Type checking only (no build)
npm run typecheck

# Run all tests
npm test

# Watch mode for TDD
npm run test:watch

# Interactive test UI
npm run test:ui

# Coverage report
npm run test:coverage
```

**Important**: The build script has a critical step that copies `lib/oauth-success.html` to `dist/lib/`. This HTML file is required for the OAuth callback flow.

## Code Architecture

### Plugin Flow (index.ts)

The main entry point orchestrates a **7-step fetch flow**:

1. **Token Management**: Check token expiration, refresh if needed
2. **URL Rewriting**: Transform OpenAI Platform API URLs → ChatGPT backend API (`https://chatgpt.com/backend-api/codex/responses`)
3. **Request Transformation**:
   - Normalize model names (all variants → `gpt-5.2`, `gpt-5.2-codex`, `gpt-5.1`, `gpt-5.1-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`, `gpt-5`, `gpt-5-codex`, or `codex-mini-latest`)
   - Inject Codex system instructions from latest GitHub release
   - Apply reasoning configuration (effort, summary, verbosity)
   - Add CODEX_MODE bridge prompt (default) or tool remap message (legacy)
   - Filter OpenCode system prompts when in CODEX_MODE
   - Filter conversation history (remove `rs_*` IDs for stateless operation)
4. **Headers**: Add OAuth token + ChatGPT account ID
5. **Request Execution**: Send to Codex backend
6. **Response Logging**: Optional debug logging (ENABLE_PLUGIN_REQUEST_LOGGING=1)
7. **Response Handling**: Convert SSE to JSON (non-tool requests) or pass through

### Module Organization

**Core Plugin — V1** (`index.ts`)
- Plugin definition and main fetch orchestration (OpenCode 1 API: bare async function default export)
- OAuth loader (extracts ChatGPT account ID from JWT)
- Configuration loading and CODEX_MODE determination
- Published at the `opencode-openai-codex-auth/legacy` subpath (see pattern 9 below)

**Core Plugin — V2** (`v2.ts`)
- Plugin definition using OpenCode 2's API (`Plugin.define({ id, setup(ctx) {...} })`)
- Reuses every `lib/` module below unchanged; only the glue layer differs (native `http.request`/`http.response` session hooks instead of a custom `fetch()` override, `ctx.integration.transform` instead of the V1 `auth` hook)
- Published at the package root (see pattern 9 below)

**Authentication** (`lib/auth/`)
- `auth.ts`: OAuth flow (PKCE, token exchange, JWT decoding, refresh) — shared by both `index.ts` and `v2.ts`
- `server.ts`: Local HTTP server for OAuth callback (port 1455) — shared
- `browser.ts`: Platform-specific browser opening — shared
- `v2-storage.ts`: OpenCode 2-only. Small file-based OAuth credential store (`~/.opencode/openai-codex-v2-credentials.json`) with a read-only legacy `auth.json` import fallback — needed because V2's plugin API has no public way to import an existing OAuth credential into its own built-in connection store

**Request Handling** (`lib/request/`)
- `fetch-helpers.ts`: 10 focused helper functions for main fetch flow
- `request-transformer.ts`: Body transformations (model normalization, reasoning config, input filtering)
- `response-handler.ts`: SSE to JSON conversion
- `helpers/model-map.ts`: Static, frozen exact-alias map for currently-shipped presets (fast path)
- `helpers/model-registry-data.ts`: **Single source of truth** for model normalization, reasoning capabilities, and prompt family — add new models here
- `helpers/model-registry.ts`: Registry lookup/merge + optional ETag-cached remote overlay (opt-in, see "Model Registry" pattern below)
- `helpers/skill-catalog.ts`: Extracts/re-injects opencode's `<available_skills>`/`<mcp_instructions>` blocks around the `body.instructions` overwrite (see "OpenCode Capability Block Passthrough" pattern below)

**Prompts** (`lib/prompts/`)
- `codex.ts`: Fetches Codex instructions from GitHub (ETag-cached), tool remap message
- `codex-opencode-bridge.ts`: CODEX_MODE bridge prompt for CLI parity

**Configuration** (`lib/`)
- `config.ts`: Plugin config loading, CODEX_MODE determination
- `constants.ts`: All magic values, URLs, error messages
- `types.ts`: TypeScript type definitions
- `logger.ts`: Debug logging (controlled by env var)

### Key Design Patterns

**1. Stateless Operation**: Uses `store: false` + `include: ["reasoning.encrypted_content"]`
- Allows multi-turn conversations without server-side storage
- Encrypted reasoning content persists context across turns

**2. CODEX_MODE** (enabled by default):
- **Priority**: `CODEX_MODE` env var > `~/.opencode/openai-codex-auth-config.json` > default (true)
- When enabled: Filters out OpenCode system prompts, adds Codex-OpenCode bridge prompt with Task tool & MCP awareness
- When disabled: Uses legacy tool remap message
- Bridge prompt (~550 tokens): Tool mappings, available tools, working style, **Task tool/sub-agent awareness**, **MCP tool awareness**
- **Prompt verification**: Caches OpenCode's codex.txt from GitHub (ETag-based) to verify exact prompt removal, with fallback to text signature matching

**3. Configuration Merging**:
- Global options (`provider.openai.options`) + per-model options (`provider.openai.models[name].options`)
- Model-specific options override global
- Plugin defaults: `reasoningEffort: "medium"`, `reasoningSummary: "auto"`, `textVerbosity: "medium"`

**4. Model Normalization** (GPT-5.0 → GPT-5.1 migration):
- All `gpt-5.2-codex*` variants → `gpt-5.2-codex` (newest Codex model, supports xhigh)
- All `gpt-5.1-codex-max*` variants → `gpt-5.1-codex-max`
- All `gpt-5.1-codex*` variants → `gpt-5.1-codex`
- All `gpt-5.1-codex-mini*` variants → `gpt-5.1-codex-mini`
- All `gpt-5.2` variants → `gpt-5.2`
- All `gpt-5.1` variants → `gpt-5.1`
- **Legacy mappings** (GPT-5.0 being phased out):
  - `gpt-5-codex*` variants → `gpt-5.1-codex`
  - `gpt-5-codex-mini*` or `codex-mini-latest` → `gpt-5.1-codex-mini`
  - `gpt-5*` variants (including `gpt-5-mini`, `gpt-5-nano`) → `gpt-5.1`
- `minimal` effort auto-normalized to `low` for Codex families (including GPT-5.2 Codex) and clamped to `medium` (or `high` when requested) for Codex Mini

**5. Model-Specific Prompt Selection**:
- Different prompts for different model families (matching Codex CLI):
  - `gpt-5.2-codex*` → `gpt-5.2-codex_prompt.md` (117 lines, Codex CLI agent prompt)
  - `gpt-5.1-codex-max*` → `gpt-5.1-codex-max_prompt.md` (117 lines, frontend design guidelines)
  - `gpt-5.1-codex*`, `codex-*` → `gpt_5_codex_prompt.md` (105 lines, coding focus)
  - `gpt-5.2*` → `gpt_5_2_prompt.md` (GPT‑5.2 general family)
  - `gpt-5.1*` → `gpt_5_1_prompt.md` (368 lines, full behavioral guidance)
- `getModelFamily()` determines prompt selection based on normalized model

**6. Model Registry** (data-driven model knowledge):
- `lib/request/helpers/model-registry-data.ts` is the single source of truth for which model families the plugin knows about: canonical API id, accepted preset aliases, reasoning capabilities (`none`/`xhigh`/`max` support), default effort, and Codex CLI prompt family.
- `normalizeModel()`, `getReasoningConfig()`, and `getModelFamily()` all consult this registry (via `lib/request/helpers/model-registry.ts`) before falling back to legacy hardcoded pattern-matching, so most new models require **one array entry**, not edits across `model-map.ts`, `request-transformer.ts`, and `codex.ts`.
- Optional, opt-in remote overlay: set `modelRegistryUrl` (plugin config) or `OPENCODE_CODEX_MODEL_REGISTRY_URL` (env var, takes precedence) to an HTTPS URL serving a JSON array of `ModelRegistryEntry` objects. It's ETag-cached (15 min TTL, same pattern as Codex instructions below) and merged with the bundled registry in the background — never blocks a request, never called unless configured, and silently falls back to bundled defaults on any failure. This lets an active maintainer ship recognition for a brand-new model without a full npm release.
- `lib/request/helpers/model-map.ts` remains as a static, frozen exact-alias map for currently-shipped presets (fast path, kept for backwards compatibility); it is not the place to add new models going forward.

**7. Codex Instructions Caching**:
- Fetches from latest release tag (not main branch)
- ETag-based HTTP conditional requests per model family
- Separate cache files per family: `gpt-5.2-codex-instructions.md`, `codex-max-instructions.md`, `codex-instructions.md`, `gpt-5.2-instructions.md`, `gpt-5.1-instructions.md`
- Cache invalidation when release tag changes
- Falls back to bundled version if GitHub unavailable

**9. OpenCode 2 Dual Plugin Entrypoint** (V1 + V2 from one package):
- OpenCode 2 has a new, incompatible plugin API — a V1 plugin (bare async function default export, what `index.ts` has always been) is rejected with a schema error before any of its code runs; it does not degrade gracefully. Confirmed live against a real OpenCode 2.0.15 host: other V1-shaped plugins in the same environment fail with `PluginModule.LoadError: ... SchemaError(Expected object at ["default"])`.
- `package.json`'s `exports` field resolves the package root (`opencode-openai-codex-auth`) to the new `v2.ts` build (`dist/v2.js`), and `opencode-openai-codex-auth/legacy` to the unchanged V1 build (`dist/index.js`), matching the same dual-export pattern this maintainer's separate Anthropic plugin (`opencode-anthropic-dark-auth`) already validated live.
- `v2.ts` reuses every `lib/` business-logic module unchanged (model registry, Codex instructions, CODEX_MODE bridge, skill-catalog passthrough, SSE→JSON conversion) — the port only replaces the *glue*: `ctx.session.hook("http.request" | "http.response", ..., { providerID: "openai" })` instead of a custom `fetch()`, and `ctx.integration.transform(...)` (registering this plugin's own OAuth method, `id: "codex-auth"`) instead of the V1 `auth` hook.
- **Important caveat, not specific to this plugin**: OpenCode 2 ships its own built-in ChatGPT/Codex OAuth handling for the `openai` integration (`chatgpt-browser`/`chatgpt-headless` methods) that can silently make basic model access "work" even while this plugin is completely absent from `opencode plugin list` — but without Codex instructions, the CODEX_MODE bridge, or model-registry reasoning normalization. A user must explicitly complete this plugin's own OAuth method (`opencode auth login` → `openai` → `ChatGPT Plus/Pro (Codex Auth)`) for OpenCode 2 to route through it; V2's plugin API has no public way to activate an integration connection from an imported credential alone.
- See `specs/opencode-v2-plugin-port.md` for the full root-cause investigation and design rationale, and `test/v2.test.ts` for hook-level test coverage.

**8. OpenCode Capability Block Passthrough** (Skills + MCP parity with Anthropic sessions):
- opencode's `isOpenaiOauth` branch (`session/llm/request.ts` in opencode core) puts the *entire* joined system prompt — including the `<available_skills>` catalog and `<mcp_instructions>` block — into `body.instructions` instead of `role:"system"` messages (every other provider/auth combo gets the latter). `transformRequestBody()` used to unconditionally overwrite `body.instructions` with the official Codex CLI instructions, silently discarding both blocks before Codex ever saw them — confirmed empirically via `ENABLE_PLUGIN_REQUEST_LOGGING=1` (real request: `<available_skills>`/`<mcp_instructions>` both present pre-overwrite, absent after).
- `lib/request/helpers/skill-catalog.ts` extracts both blocks (`extractOpenCodeCapabilityBlocks()`, pure regex-based, safe no-op if absent/malformed) *before* the overwrite, then `transformRequestBody()` re-appends them (`formatPreservedCapabilityBlocks()`) after `codexInstructions`, in the same order opencode uses (mcp before skills). Runs unconditionally (both `CODEX_MODE` values), since the destructive overwrite it patches is itself unconditional.
- `CODEX_OPENCODE_BRIDGE` (`lib/prompts/codex-opencode-bridge.ts`) mentions the `skill` tool so Codex knows to check the (now-preserved) catalog for a matching skill before starting non-trivial work.
- See `specs/skill-catalog-passthrough.md` for the full root-cause writeup and design rationale.

## Development Patterns

### Adding a New Model

1. Add one entry to `BUNDLED_MODEL_REGISTRY` in `lib/request/helpers/model-registry-data.ts` (canonical `id`, `aliases`, `family`, `capabilities`, `defaultEffort`). This alone wires up `normalizeModel()`, `getReasoningConfig()`, and `getModelFamily()`.
2. If the model reuses an existing Codex CLI prompt family (the common case), you're done with the TypeScript side. If it needs a genuinely new prompt family, also add a `ModelFamily` union member + `PROMPT_FILES`/`CACHE_FILES` entries in `lib/prompts/codex.ts` (this requires knowing the actual instructions filename shipped in the `openai/codex` GitHub release).
3. Add user-facing presets to `config/opencode-modern.json` and `config/opencode-legacy.json` (display name, context/output limits, per-effort variants) — the registry intentionally does not duplicate this human-facing metadata.
4. Add tests: at minimum, `normalizeModel()` and `getReasoningConfig()` cases in `test/request-transformer.test.ts` (or `test/model-registry.test.ts` for registry-specific behavior) and a `getModelFamily()` case in `test/codex.test.ts` if a new family was added.
5. Update the model tables in `README.md` and `config/README.md`, and add a `CHANGELOG.md` entry.

For urgent/interim support ahead of a full release, an active maintainer can instead publish a JSON overlay (array of `ModelRegistryEntry`) and point users at it via `modelRegistryUrl` / `OPENCODE_CODEX_MODEL_REGISTRY_URL` — see the "Model Registry" pattern above.

### Adding New Configuration Options

1. Add to `ConfigOptions` interface in `lib/types.ts`
2. Update `transformRequestBody()` in `lib/request/request-transformer.ts`
3. Add tests in `test/request-transformer.test.ts`
4. Document in README.md configuration section

### Modifying Request Transformation

All request transformations go through `transformRequestBody()`:
- Input filtering: `filterInput()`, `filterOpenCodeSystemPrompts()`
- Message injection: `addCodexBridgeMessage()` or `addToolRemapMessage()`
- Reasoning config: `getReasoningConfig()` (follows Codex CLI defaults, not opencode defaults)
- Model config: `getModelConfig()` (merges global + per-model options)

### OAuth Flow Modifications

OAuth implementation follows OpenAI Codex CLI patterns:
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann`
- PKCE with S256 challenge
- Special params: `codex_cli_simplified_flow=true`, `originator=codex_cli_rs`
- Callback server on port 1455 (matches Codex CLI)

### Testing Strategy

- **191 comprehensive tests** covering all modules
- Test files mirror source structure (`test/auth.test.ts` ↔ `lib/auth/auth.ts`)
- Mock-heavy testing (no actual network calls or file I/O in tests)
- Focus on edge cases: token expiration, model normalization, input filtering, CODEX_MODE toggling

## Important Configuration Differences

This plugin **intentionally differs from opencode defaults** because it accesses ChatGPT backend API (not OpenAI Platform API):

| Setting | opencode Default | This Plugin Default | Reason |
|---------|-----------------|---------------------|--------|
| `reasoningEffort` | "high" (gpt-5) | "medium" (Codex Max defaults to "high") | Matches Codex CLI default and Codex Max capabilities |
| `textVerbosity` | "low" (gpt-5) | "medium" | Matches Codex CLI default |
| `reasoningSummary` | "detailed" | "auto" | Matches Codex CLI default |
| gpt-5-codex config | (excluded) | Full support | opencode excludes gpt-5-codex from auto-config |
| `store` | true | false | Required for ChatGPT backend |
| `include` | (not set) | `["reasoning.encrypted_content"]` | Required for stateless operation |

## File Paths & Locations

- **Plugin config**: `~/.opencode/openai-codex-auth-config.json`
- **Cache dir**: `~/.opencode/cache/`
  - `codex-instructions.md` (Codex CLI instructions from GitHub)
  - `codex-instructions-meta.json` (ETag + release tag for Codex instructions)
  - `opencode-codex.txt` (OpenCode system prompt from GitHub, for verification)
  - `opencode-codex-meta.json` (ETag for OpenCode prompt)
  - `model-registry-overlay.json` / `model-registry-overlay-meta.json` (cached remote model registry overlay, only written when `modelRegistryUrl`/`OPENCODE_CODEX_MODEL_REGISTRY_URL` is configured)
- **Debug logs**: `~/.opencode/logs/codex-plugin/` (when `ENABLE_PLUGIN_REQUEST_LOGGING=1`)
- **OAuth callback**: `http://localhost:1455/auth/callback`

## Environment Variables

- `CODEX_MODE`: Override config file (1=enable, 0=disable)
- `ENABLE_PLUGIN_REQUEST_LOGGING`: Enable detailed request logging (1=enable)
- `OPENCODE_CODEX_MODEL_REGISTRY_URL`: HTTPS URL to a remote model registry overlay JSON (takes precedence over the `modelRegistryUrl` config field); opt-in, unset by default

## TypeScript Configuration

- Target: ES2022
- Module: ES2022 with bundler resolution
- Output: `./dist/`
- Strict mode enabled
- Declaration files generated
- Source maps enabled
- Excludes: `test/`, `node_modules/`, `dist/`

## Dependencies

**Production**:
- `@openauthjs/openauth` (OAuth PKCE implementation)

**Development**:
- `@opencode-ai/plugin` (peer dependency)
- `vitest` (testing framework)
- TypeScript

**Zero external runtime dependencies** - only uses Node.js built-ins for file I/O, HTTP, crypto.
