# Changelog

All notable changes to this project are documented here. Dates use the ISO format (YYYY-MM-DD).

## [4.10.0] - 2026-09-24

**Compatibility release**: OpenCode 2 native plugin port.

### Added
- **OpenCode 2 support**: new `v2.ts` entrypoint using the V2 plugin API (`Plugin.define({ id, setup(ctx) {...} })`), shipped alongside the unchanged V1 entrypoint via `package.json`'s dual `exports` — the package root now resolves to the V2 build (`dist/v2.js`); `opencode-openai-codex-auth/legacy` resolves to the original V1 build (`dist/index.js`) for anyone still on OpenCode 1. Every existing `lib/` business-logic module (model registry, Codex instructions, CODEX_MODE bridge, skill-catalog passthrough, SSE→JSON conversion) is reused unchanged — only the glue layer (HTTP interception, OAuth registration) was rewritten for V2's API.
  - Replaces the V1 custom `fetch()` override with native `ctx.session.hook("http.request" | "http.response", ..., { providerID: "openai" })` hooks.
  - Registers this plugin's own OAuth integration method (**ChatGPT Plus/Pro (Codex Auth)**) alongside OpenCode 2's built-in `chatgpt-browser`/`chatgpt-headless` methods, reusing the exact same PKCE flow, local callback server, and browser opener as V1. New `lib/auth/v2-storage.ts` provides a small file-based credential store (V2's plugin API has no way to import an existing OAuth credential into its own built-in connection store), with a best-effort read-only import of any existing V1 `auth.json` credential on first use.
  - New `test/v2.test.ts` (13 tests) covering request filtering, URL rewriting, header assembly, body transformation, proactive token refresh, and response routing — all 289 tests pass (276 pre-existing + 13 new), `npm run typecheck` and `npm run build` clean.
  - Full root-cause investigation (confirmed empirically against a live OpenCode 2.0.15 host, not guessed) in `specs/opencode-v2-plugin-port.md`, including why a request could silently appear to "work" even with this plugin completely absent from `opencode plugin list` (OpenCode 2's own built-in Codex handling, which does **not** apply this plugin's Codex instructions, CODEX_MODE bridge, or model-registry reasoning normalization).
  - **Migration note for existing users on OpenCode 2**: installing this version alone is not enough — run `opencode auth login`, select `openai` → `ChatGPT Plus/Pro (Codex Auth)`, and complete the login once so OpenCode 2 treats `openai` as actively connected through this plugin (a V2 API limitation, not specific to this plugin — see spec for details).

## [4.9.0] - 2026-09-22

**Model release**: GPT-6 Sol/Luna, plus a safety net so future unrecognized models fail safe instead of silently downgrading.

### Added
- **gpt-6-sol** and **gpt-6-luna**: new models, added as two registry entries reusing the existing `gpt-5.6` prompt family (no changes needed to `request-transformer.ts` or `codex.ts` logic beyond the safety net below), plus config presets.
  - **Verified live** against the ChatGPT Codex backend (not guessed): both are real API model ids, and both accept the full `none`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max` reasoning range (same tiers as `gpt-5.6-sol`/`terra`/`luna`).
  - Context window (`context: 1050000`, `input: 922000`, `output: 128000`) confirmed via models.dev's public catalog rather than assumed — and used to correct `gpt-6-astra`'s previously-provisional `272000`/`128000` limit to the same real 1.05M window.
  - End-to-end verified through `opencode run --model=openai/gpt-6-sol` and `--model=openai/gpt-6-luna` against the local plugin build, both real `HTTP 200` completions.

### Fixed
- **Silent downgrade of unrecognized newer models**: `normalizeModel()`'s last-resort fallback had no pattern for model ids newer than `gpt-5.6` (e.g. `gpt-6-*`), so an unrecognized-but-well-formed id like `gpt-6-sol` — already selectable in OpenCode today because `models.dev`'s catalog and OpenCode's additive provider-config merge don't require any change on this plugin's side — was silently rewritten to `gpt-5.1` with no error at all. Added a version-aware safety net: a `gpt-N[.M]-*` id whose version is higher than anything this plugin's fallback chain recognizes (5.6) is now passed through to the real Codex backend unchanged instead of being downgraded. Older/legacy families (e.g. `gpt-4`) are unaffected and keep normalizing forward to `gpt-5.1` as before.
- **GPT-5.6 effective input window**: Sol, Terra, and Luna presets now declare `input: 922000` alongside `context: 1050000` and `output: 128000`. Without the explicit input limit, OpenCode inherited a stale `272000` input cap from its model catalog, causing the UI and automatic compaction to behave as if the models only had a 272k input window.

## [4.8.0] - 2026-09-10

**Quality release**: Codex sessions now get OpenCode's Skills catalog and MCP instructions, matching Anthropic session parity.

### Fixed
- **`<available_skills>` and `<mcp_instructions>` were silently dropped for every OpenAI OAuth (Codex) session.** OpenCode's `isOpenaiOauth` request path puts its entire system prompt — including both capability blocks — into `body.instructions` instead of `role:"system"` messages (every other provider/auth combo gets the latter). `transformRequestBody()` unconditionally overwrote `body.instructions` with the official Codex CLI instructions, discarding both blocks before Codex ever saw them. Confirmed empirically (not just by reading code) via `ENABLE_PLUGIN_REQUEST_LOGGING=1` against a real session: pre-fix, the final request Codex received had no trace of either block despite opencode generating them; post-fix, a live end-to-end run shows the real `<available_skills>` catalog (3 skills) and `<mcp_instructions>` reaching the ChatGPT backend with a real `HTTP 200` response.
- **New**: `lib/request/helpers/skill-catalog.ts` — `extractOpenCodeCapabilityBlocks()` captures both blocks before the overwrite (pure regex-based, safe no-op if absent/malformed), `formatPreservedCapabilityBlocks()` re-appends them after the Codex instructions (mcp before skills, matching opencode's own ordering). Strictly additive: identical output when neither block is present, in both `CODEX_MODE` values.
- **`CODEX_OPENCODE_BRIDGE`** now mentions the `skill` tool, so Codex knows to check the (now-preserved) catalog for a matching skill before starting non-trivial work — it previously omitted this tool entirely from its "Available OpenCode Tools" list.
- **Tests**: new `test/skill-catalog.test.ts` (15 cases) plus 6 new `transformRequestBody()` scenarios in `test/request-transformer.test.ts` covering both-present, skills-only, mcp-only, absent, and `CODEX_MODE` independence. All 250 pre-existing tests pass unmodified (271/271 total).
- Full root-cause writeup: `specs/skill-catalog-passthrough.md`.

## [4.7.0] - 2026-09-06

**Model release**: GPT‑6 Astra — first model added purely through the new registry.

### Added
- **gpt-6-astra**: new flagship model. Added as a single entry in `lib/request/helpers/model-registry-data.ts` (no changes needed to `request-transformer.ts` or `codex.ts` logic), plus config presets and a `gpt-6` convenience alias.
  - **Verified live** against the ChatGPT Codex backend (not guessed): `gpt-6-astra` is the real API model id — bare `gpt-6` is rejected by the API directly but works here as an alias. Confirmed reasoning support is `low`/`medium`/`high`/`xhigh`/`max` (**no** `none` — the API's own error message enumerates the supported values when `none` is rejected).
  - Reuses the `gpt-5.2` Codex CLI prompt family, since `openai/codex` has not published a dedicated `gpt-6` prompt file yet (checked release `rust-v0.153.4`). Context/output limits in the config presets are provisional (borrowed from `gpt-5.2`) pending official numbers.

## [4.6.0] - 2026-09-06

**Maintainability release**: data-driven model registry.

### Added
- **Model registry** (`lib/request/helpers/model-registry-data.ts`): single source of truth for model normalization, reasoning capabilities (`none`/`xhigh`/`max` support), default effort, and Codex CLI prompt family. `normalizeModel()`, `getReasoningConfig()`, and `getModelFamily()` now consult it first, falling back to the previous hardcoded pattern-matching only for names the registry doesn't recognize. Adding a new model family now typically means one array entry instead of edits across `model-map.ts`, `request-transformer.ts`, and `codex.ts`.
- **Optional remote registry overlay**: `modelRegistryUrl` (plugin config) or `OPENCODE_CODEX_MODEL_REGISTRY_URL` (env var) lets a maintainer host a JSON overlay of `ModelRegistryEntry` objects that the plugin merges in automatically (ETag-cached, checked at most every 15 minutes, background-refreshed so it never blocks a request). Fully opt-in — no network call is made unless configured, and any failure silently falls back to the bundled registry.
- **Tests**: new `test/model-registry.test.ts` (12 cases) covering bundled lookups, registry-driven normalization/reasoning/prompt-family selection, and the remote overlay (success, network failure, malformed payload, and disabled-by-default behavior).

### Changed
- `getReasoningConfig()`'s hardcoded capability derivation was extracted into `deriveLegacyReasoningFlags()` and now only runs as a fallback when a model isn't found in the registry — behavior is unchanged for every existing model (verified by the full pre-existing test suite passing unmodified).

## [4.5.0] - 2026-09-06

**Model release**: GPT‑5.6 support and local dev install flag.

### Added
- **GPT‑5.6 Sol/Terra/Luna models**: full `none/low/medium/high/xhigh/max` reasoning range, config presets (modern variants + legacy), and dedicated Codex CLI prompt/instructions family. `gpt-5.6` aliases to `gpt-5.6-sol`.
- **`max` reasoning effort**: new tier above `xhigh`, currently exclusive to the GPT‑5.6 family.
- **`--local` installer flag**: points the generated config at this repository's built `dist/index.js` (via `file://` URL) instead of the published npm package, for testing unreleased changes end-to-end.

## [4.4.0] - 2026-01-09

**Maintenance release**: OAuth success page version sync.

### Changed
- **OAuth success banner**: Updates the success page header to display the current release version.

## [4.3.1] - 2026-01-08

**Installer safety release**: JSONC support, safe uninstall, and minimal reasoning clamp.

### Added
- **JSONC-aware installer**: preserves comments/formatting and prioritizes `opencode.jsonc` over `opencode.json`.
- **Safe uninstall**: `--uninstall` removes only plugin entries + our model presets; `--all` removes tokens/logs/cache.
- **Installer tests**: coverage for JSONC parsing, precedence, uninstall safety, and artifact cleanup.

### Changed
- **Default config path**: installer creates `~/.config/opencode/opencode.jsonc` when no config exists.
- **Dependency**: `jsonc-parser` added to keep JSONC updates robust and comment-safe.

### Fixed
- **Minimal reasoning clamp**: `minimal` is now normalized to `low` for GPT‑5.x requests to avoid backend rejection.

## [4.3.0] - 2026-01-04

**Feature + reliability release**: variants support, one-command installer, and auth/error handling fixes.

### Added
- **One-command installer/update**: `npx -y opencode-openai-codex-auth@latest` (global config, backup, cache clear) with `--legacy` for OpenCode v1.0.209 and below.
- **Modern variants config**: `config/opencode-modern.json` for OpenCode v1.0.210+; legacy presets remain in `config/opencode-legacy.json`.
- **Installer CLI** bundled as package bin for cross-platform use (Windows/macOS/Linux).

### Changed
- **Variants-aware request config**: respects host-supplied `body.reasoning` / `providerOptions.openai` before falling back to defaults.
- **OpenCode prompt source**: updates to the current upstream repository (`anomalyco/opencode`).
- **Docs/README**: install-first layout with leaner guidance and explicit legacy path.

### Fixed
- **Headless login fallback**: missing `xdg-open` no longer fails the OAuth flow; manual URL paste stays available.
- **Error handling alignment**: refresh failures throw; usage-limit 404s map to retryable 429s where appropriate.
- **AGENTS.md preservation**: protected instruction markers stop accidental filtering of user instructions.
- **Tool-call integrity**: orphan outputs now match `local_shell_call` and `custom_tool_call` (Codex CLI parity); unmatched outputs preserved as assistant messages.
- **Logging noise**: debug logging gated behind flags to prevent stdout bleed.

## [4.2.0] - 2025-12-19

**Feature release**: GPT 5.2 Codex support and prompt alignment with latest Codex CLI.

### Added
- **GPT 5.2 Codex model family**: Full support for `gpt-5.2-codex` with presets:
  - `gpt-5.2-codex-low` - Fast GPT 5.2 Codex responses
  - `gpt-5.2-codex-medium` - Balanced GPT 5.2 Codex tasks
  - `gpt-5.2-codex-high` - Complex GPT 5.2 Codex reasoning & tools
  - `gpt-5.2-codex-xhigh` - Deep GPT 5.2 Codex long-horizon work
- **New model family prompt**: `gpt-5.2-codex_prompt.md` fetched from the latest Codex CLI release with its own cache file.
- **Test coverage**: Added unit tests for GPT 5.2 Codex normalization, family selection, and reasoning behavior.

### Changed
- **Prompt selection alignment**: GPT 5.2 general now uses `gpt_5_2_prompt.md` (Codex CLI parity).
- **Reasoning configuration**: GPT 5.2 Codex supports `xhigh` but does **not** support `"none"`; `"none"` auto-upgrades to `"low"` and `"minimal"` normalizes to `"low"`.
- **Config presets**: `config/opencode-legacy.json` includes the 22 pre-configured presets (adds GPT 5.2 Codex); `config/opencode-modern.json` provides the variant-based setup.
- **Docs**: Updated README/AGENTS/config docs to include GPT 5.2 Codex and new model family behavior.

## [4.1.1] - 2025-12-17

**Minor release**: "none" reasoning effort support, orphaned function_call_output fix, and HTML version update.

### Added
- **"none" reasoning effort support**: GPT-5.1 and GPT-5.2 support `reasoning_effort: "none"` which disables the reasoning phase entirely. This can result in faster responses when reasoning is not needed.
  - `gpt-5.2-none` - GPT-5.2 with reasoning disabled
  - `gpt-5.1-none` - GPT-5.1 with reasoning disabled
- **4 new unit tests** for "none" reasoning behavior (now 197 total unit tests).

### Fixed
- **Orphaned function_call_output 400 errors**: Fixed API errors when conversation history contains `item_reference` pointing to stored function calls. Previously, orphaned `function_call_output` items were only filtered when `!body.tools`. Now always handles orphans regardless of tools presence, and converts them to assistant messages to preserve context while avoiding API errors.
- **OAuth HTML version display**: Updated version in oauth-success.html from 1.0.4 to 4.1.0.

### Technical Details
- `getReasoningConfig()` now detects GPT-5.1 general purpose models (not Codex variants) and allows "none" to pass through.
- GPT-5.2 inherits "none" support as it's newer than GPT-5.1.
- Codex variants (gpt-5.1-codex, gpt-5.1-codex-max, gpt-5.1-codex-mini) do NOT support "none":
  - Codex and Codex Max: "none" auto-converts to "low"
  - Codex Mini: "none" auto-converts to "medium" (as before)
- Documentation updated with complete reasoning effort support matrix per model family.

### References
- **OpenAI API docs** (`platform.openai.com/docs/api-reference/chat/create`): "gpt-5.1 defaults to none, which does not perform reasoning. The supported reasoning values for gpt-5.1 are none, low, medium, and high."
- **Codex CLI** (`codex-rs/protocol/src/openai_models.rs`): `ReasoningEffort` enum includes `None` variant with `#[serde(rename_all = "lowercase")]` serialization to `"none"`.
- **Codex CLI** (`codex-rs/core/src/client.rs`): Request builder passes `ReasoningEffort::None` through to API without validation/rejection.
- **Codex CLI** (`docs/config.md`): Documents `model_reasoning_effort = "none"` as valid config option.

### Notes
- This plugin defaults to "medium" for better coding assistance; users must explicitly set "none" if desired.

## [4.1.0] - 2025-12-11

**Feature release**: GPT 5.2 model support and image input capabilities.

### Added
- **GPT 5.2 model family support**: Full support for OpenAI's latest GPT 5.2 model with 4 reasoning level presets:
  - `gpt-5.2-low` - Fast responses with light reasoning
  - `gpt-5.2-medium` - Balanced reasoning for general tasks
  - `gpt-5.2-high` - Complex reasoning and analysis
  - `gpt-5.2-xhigh` - Deep multi-hour analysis (same as Codex Max)
- **Full image input support**: All 16 model variants now include `modalities.input: ["text", "image"]` enabling full multimodal capabilities - read screenshots, diagrams, UI mockups, and any image directly in OpenCode.
- **GPT 5.2 model family** added to `codex.ts` with dedicated prompt handling.
- **Test coverage**: Updated integration tests to verify all 16 models (was 13), now 193 unit tests + 16 integration tests.

### Changed
- **Model ordering**: Config now ordered by model family priority: GPT 5.2 → Codex Max → Codex → Codex Mini → GPT 5.1.
- **Removed default presets**: Removed `gpt-5.1-codex-max` and `gpt-5.2` (without reasoning suffix) to enforce explicit reasoning level selection.
- **Test script**: `scripts/test-all-models.sh` now uses local dist for testing and includes GPT 5.2 tests.
- **Documentation**: Updated README with GPT 5.2 models, image support, and condensed config example.

### Technical Details
- GPT 5.2 maps to `gpt-5.2` API model with same reasoning options as Codex Max (`low/medium/high/xhigh`).
- `getModelFamily()` now returns `"gpt-5.2"` for GPT 5.2 models, using Codex Max prompts.
- `getReasoningConfig()` treats GPT 5.2 like Codex Max for `xhigh` reasoning support.
- Model normalization pattern matching updated to recognize GPT 5.2 before other patterns.

## [4.0.2] - 2025-11-27

**Bugfix release**: Fixes compaction context loss, agent creation, and SSE/JSON response handling.

### Fixed
- **Compaction losing context**: v4.0.1 was too aggressive in filtering tool calls - it removed ALL `function_call`/`function_call_output` items when tools weren't present. Now only **orphaned** outputs (without matching calls) are filtered, preserving matched pairs for compaction context.
- **Agent creation failing**: The `/agent create` command was failing with "Invalid JSON response" because we were returning SSE streams instead of JSON for `generateText()` requests.
- **SSE/JSON response handling**: Properly detect original request intent - `streamText()` requests get SSE passthrough, `generateText()` requests get SSE→JSON conversion.

### Added
- **`gpt-5.1-chat-latest` model support**: Added to model map, normalizes to `gpt-5.1`.

### Technical Details
- Root cause of compaction issue: OpenCode sends `item_reference` with `fc_*` IDs for function calls. We filter these for stateless mode, but v4.0.1 then removed ALL tool items. Now we only remove orphaned `function_call_output` items (where no matching `function_call` exists).
- Root cause of agent creation issue: We were forcing `stream: true` for all requests and returning SSE for all responses. Now we capture original `stream` value before transformation and convert SSE→JSON only when original request wasn't streaming.
- The Codex API always receives `stream: true` (required), but response handling is based on original intent.

## [4.0.1] - 2025-11-27

**Bugfix release**: Fixes API errors during summary/compaction and GitHub rate limiting.

### Fixed
- **Orphaned `function_call_output` errors**: Fixed 400 errors during summary/compaction requests when OpenCode sends `item_reference` pointers to server-stored function calls. The plugin now filters out `function_call` and `function_call_output` items when no tools are present in the request.
- **GitHub API rate limiting**: Added fallback mechanism when fetching Codex instructions from GitHub. If the API returns 403 (rate limit), the plugin now falls back to parsing the HTML releases page.

### Technical Details
- Root cause: OpenCode's secondary model (gpt-5-nano) uses `item_reference` with `fc_*` IDs to reference stored function calls. Our plugin filters `item_reference` for stateless mode (`store: false`), leaving `function_call_output` orphaned. The Codex API rejects requests with orphaned outputs.
- Fix: When `hasTools === false`, filter out all `function_call` and `function_call_output` items from the input array.
- GitHub fallback chain: API endpoint → HTML page → redirect URL parsing → HTML regex parsing.

## [4.0.0] - 2025-11-25

**Major release**: Complete prompt engineering overhaul matching official Codex CLI behavior, with full **GPT-5.1 Codex Max** support.

### Highlights
- **Full Codex Max support** with dedicated prompt including frontend design guidelines
- **Model-specific prompts** matching Codex CLI's prompt selection logic
- **GPT-5.0 → GPT-5.1 migration** as legacy models are phased out

### Added
- **Model-specific system prompts**: Plugin now fetches the correct Codex prompt based on model family, matching Codex CLI's `model_family.rs` logic:
  - `gpt-5.1-codex-max*` → `gpt-5.1-codex-max_prompt.md` (117 lines, includes frontend design guidelines)
  - `gpt-5.1-codex*`, `gpt-5.1-codex-mini*` → `gpt_5_codex_prompt.md` (105 lines, focused coding prompt)
  - `gpt-5.1*` → `gpt_5_1_prompt.md` (368 lines, full behavioral guidance)
- New `ModelFamily` type (`"codex-max" | "codex" | "gpt-5.1"`) for prompt selection.
- New `getModelFamily()` function to determine prompt selection based on normalized model name.
- Model family now logged in request logs for debugging (`modelFamily` field in after-transform logs).
- 16 new unit tests for model family detection (now **191 total unit tests**).
- Integration tests now verify correct model family selection (13 integration tests with family verification).

### Changed
- **Legacy GPT-5.0 models now map to GPT-5.1**: All legacy `gpt-5` model variants automatically normalize to their `gpt-5.1` equivalents as GPT-5.0 is being phased out by OpenAI:
  - `gpt-5-codex` → `gpt-5.1-codex`
  - `gpt-5` → `gpt-5.1`
  - `gpt-5-mini`, `gpt-5-nano` → `gpt-5.1`
  - `codex-mini-latest` → `gpt-5.1-codex-mini`
- **Lazy instruction loading**: Instructions are now fetched per-request based on model family (not pre-loaded at initialization).
- **Separate caching per model family**: Each model family has its own cached prompt file:
  - `codex-max-instructions.md` + `codex-max-instructions-meta.json`
  - `codex-instructions.md` + `codex-instructions-meta.json`
  - `gpt-5.1-instructions.md` + `gpt-5.1-instructions-meta.json`

### Fixed
- Fixed OpenCode prompt cache URL to fetch from `dev` branch instead of non-existent `main` branch.
- Fixed model configuration test script to correctly identify model logs in multi-model sessions (opencode uses a small model like `gpt-5-nano` for title generation alongside the user's selected model).

### Technical Details
This release brings full parity with Codex CLI's prompt engineering:
- **Codex family** (105 lines): Concise, tool-focused prompt for coding tasks
- **Codex Max family** (117 lines): Adds frontend design guidelines for UI work
- **GPT-5.1 general** (368 lines): Comprehensive behavioral guidance, personality, planning

## [3.3.0] - 2025-11-19
### Added
- GPT 5.1 Codex Max support: normalization, per-model defaults, and new presets (`gpt-5.1-codex-max`, `gpt-5.1-codex-max-xhigh`) with extended reasoning options (including `none`/`xhigh`) while keeping the 272k context / 128k output limits.
- Typing and config support for new reasoning options (`none`/`xhigh`, summary `off`/`on`) plus updated test matrix entries.

### Changed
- Codex Mini clamping now downgrades unsupported `xhigh` to `high` and guards against `none`/`minimal` inputs.
- Documentation, config guides, and validation scripts now reflect 13 verified GPT 5.1 variants (3 codex, 5 codex-max, 2 codex-mini, 3 general), including Codex Max. See README for details on pre-configured variants.

## [3.2.0] - 2025-11-14
### Added
- GPT 5.1 model family support: normalization for `gpt-5.1`, `gpt-5.1-codex`, and `gpt-5.1-codex-mini` plus new GPT 5.1-only presets in the canonical `config/opencode-legacy.json`.
- Documentation updates (README, docs, AGENTS) describing the 5.1 families, their reasoning defaults, and how they map to ChatGPT slugs and token limits.

### Changed
- Model normalization docs and tests now explicitly cover both 5.0 and 5.1 Codex/general families and the two Codex Mini tiers.
- The legacy GPT 5.0 full configuration is now published separately; new installs should prefer the 5.1 presets in `config/opencode-legacy.json`.

## [3.1.0] - 2025-11-11
### Added
- Codex Mini support end-to-end: normalization to the `codex-mini-latest` slug, proper reasoning defaults, and two new presets (`gpt-5-codex-mini-medium` / `gpt-5-codex-mini-high`).
- Documentation & configuration updates describing the Codex Mini tier (200k input / 100k output tokens) plus refreshed totals (11 presets, 160+ unit tests).

### Fixed
- Prevented Codex Mini from inheriting the lightweight (`minimal`) reasoning profile used by `gpt-5-mini`/`nano`, ensuring the API always receives supported effort levels.

## [3.0.0] - 2025-11-04
### Added
- Codex-style usage-limit messaging that mirrors the 5-hour and weekly windows reported by the Codex CLI.
- Documentation guidance noting that OpenCode's context auto-compaction and usage sidebar require the canonical `config/opencode-legacy.json`.

### Changed
- Prompt caching now relies solely on the host-supplied `prompt_cache_key`; conversation/session headers are forwarded only when OpenCode provides one.
- CODEX_MODE bridge prompt refreshed to the newest Codex CLI release so tool awareness stays in sync.

### Fixed
- Clarified README, docs, and configuration references so the canonical config matches shipped behaviour.
- Pinned `hono` (4.10.4) and `vite` (7.1.12) to resolve upstream security advisories.

## [2.1.2] - 2025-10-12
### Added
- Comprehensive compliance documentation (ToS guidance, security, privacy) and a full user/developer doc set.

### Fixed
- Per-model configuration lookup, stateless multi-turn conversations, case-insensitive model normalization, and GitHub instruction caching.

## [2.1.1] - 2025-10-04
### Fixed
- README cache-clearing snippet now runs in a subshell from the home directory to avoid path issues while removing cached plugin files.

## [2.1.0] - 2025-10-04
### Added
- Enhanced CODEX_MODE bridge prompt with Task tool and MCP awareness plus ETag-backed verification of OpenCode system prompts.

### Changed
- Request transformation made async to support prompt verification caching; AGENTS.md renamed to provide cross-agent guidance.

## [2.0.0] - 2025-10-03
### Added
- Full TypeScript rewrite with strict typing, 123 automated tests, and nine pre-configured model variants matching the Codex CLI.
- CODEX_MODE introduced (enabled by default) with a lightweight bridge prompt and configurability via config file or `CODEX_MODE` env var.

### Changed
- Library reorganized into semantic folders (auth, prompts, request, etc.) and OAuth flow polished with the new success page.

## [1.0.3] - 2025-10-02
### Changed
- Major internal refactor splitting the runtime into focused modules (logger, request/response handlers) and removing legacy debug output.

## [1.0.2] - 2025-10-02
### Added
- ETag-based GitHub caching for Codex instructions and release-tag tracking for more stable prompt updates.

### Fixed
- Default model fallback, text verbosity initialization, and standardized error logging prefixes.

## [1.0.1] - 2025-10-01
### Added
- README clarifications: opencode auto-installs plugins, config locations, and streamlined quick-start instructions.

## [1.0.0] - 2025-10-01
### Added
- Initial production release with ChatGPT Plus/Pro OAuth support, tool remapping, auto-updating Codex instructions, and zero runtime dependencies.
