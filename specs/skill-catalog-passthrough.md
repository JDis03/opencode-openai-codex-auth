# Spec: Preserve opencode's Skill catalog when routing through the Codex backend

- Status: Draft — not implemented
- Owner: (assign yourself when you pick this up)
- Related repo (read-only reference): `/home/dark/Project/opencode` @ `08fb47373` (2026-07-16, branch `dev`)
- This repo: `/home/dark/Project/openai` @ `3bb32d7` (v4.7.0)

## Problem

opencode has a "Skills" system: a catalog of user/project-defined `SKILL.md`
files, rendered into the system prompt as an `<available_skills>` block
(name + description + location per skill), plus a generic `skill` tool the
model calls by name to load one. The tool's own description
(`packages/opencode/src/tool/skill.txt`) says, verbatim:

> Load a specialized skill when the task at hand matches one of the skills
> listed in the system prompt.
> ...
> The skill name must match one of the skills listed in **your system
> prompt**.

This mechanism is provider-agnostic *by design* — Anthropic models get the
full catalog because opencode's Anthropic path keeps `system` as ordinary
`role: "system"` messages, and `opencode-anthropic-dark-auth` only reorders
those entries (billing header, identity split) without ever dropping the
skills block.

**For OpenAI Codex sessions authenticated through this plugin, the catalog
never reaches the model at all.** The `skill` tool is still registered (tool
registration doesn't go through this plugin), but its description now
references a system-prompt section that was never delivered. Codex has no
way to discover that skills exist or when to trigger one — it can only call
`skill` if the user tells it the exact skill name directly.

## Root cause

Two facts combine to produce this, one in opencode core and one in this
plugin. Neither is a bug in isolation; the combination silently drops
functionality.

### 1. opencode core special-cases OpenAI OAuth request assembly

`packages/opencode/src/session/llm/request.ts` (`LLMRequestPrep.prepare`),
lines 56-112:

```ts
const isOpenaiOauth = input.provider.id === "openai" && input.auth?.type === "oauth"
const system = [
  [
    ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
    ...input.system,                    // env, AGENTS.md, mcp instructions, <available_skills>
    ...(input.user.system ? [input.user.system] : []),
  ].filter((x) => x).join("\n"),
]
...
if (isOpenaiOauth) options.instructions = system.join("\n")

const messages =
  isOpenaiOauth || input.isWorkflow
    ? input.messages                                          // <- no system messages at all
    : [...system.map((x) => ({ role: "system", content: x })), ...input.messages]
```

For every other provider/auth combination, `system` (which includes the
skills catalog — see `packages/opencode/src/session/prompt.ts:1257-1269` and
`packages/opencode/src/session/system.ts:98-110` for how `<available_skills>`
gets built and appended) is injected as ordinary `role: "system"` messages.

For **OpenAI + OAuth specifically**, opencode instead puts the *entire*
joined system text into `options.instructions`, which
`packages/opencode/src/provider/transform.ts` (`providerOptions()`, line
1287) nests as `providerOptions.openai.instructions` for the AI SDK call.
`@ai-sdk/openai`'s Responses provider forwards that straight through as the
top-level `instructions` field of the actual HTTP request body — i.e. by the
time this plugin's `fetch()` override runs, `init.body.instructions` should
already contain the full opencode system prompt (persona + env + AGENTS.md +
`<mcp_instructions>` + `<available_skills>`), as ONE string. This needs the
one-time empirical confirmation described in "Verification" below, but every
other option in that same `ProviderTransform.options()`/`providerOptions()`
pipeline (e.g. `store: false`) is confirmed to reach the real HTTP body the
same way, so this is the working assumption for the design below.

No `role: "system"`/`"developer"` items ever reach `body.input` for this
path (`messages = input.messages` verbatim), which is also why
`filterOpenCodeSystemPrompts()` (this repo,
`lib/request/helpers/input-utils.ts`) never actually finds anything to
filter in practice for the OAuth path — it was presumably written against an
older assumption or against `input`-array-based providers.

### 2. This plugin unconditionally discards `body.instructions`

`lib/request/request-transformer.ts`, `transformRequestBody()`, line 536:

```ts
body.instructions = codexInstructions;
```

This runs unconditionally — **regardless of `CODEX_MODE`** — discarding
whatever opencode put in `body.instructions` (per #1, the full system
prompt including the skills catalog) and replacing it with OpenAI's own
official Codex CLI instructions (fetched from GitHub, `lib/prompts/codex.ts`).

In `CODEX_MODE=true` (default), `filterOpenCodeSystemPrompts()` +
`addCodexBridgeMessage()` additionally manage `body.input`, but per #1 that
array never carried the skills catalog in the first place for this auth
path — the loss already happened at line 536, in `body.instructions`, in
both modes.

`CODEX_OPENCODE_BRIDGE` (`lib/prompts/codex-opencode-bridge.ts`) — the
~550-token message injected in `CODEX_MODE` to tell Codex about opencode's
tool names — lists `write`/`edit`/`read`/`grep`/`glob`/`list`/`bash`/
`webfetch`/`todowrite`/`todoread`/Task/MCP tools, but **does not mention the
`skill` tool at all**. Even if the catalog text were preserved elsewhere,
Codex isn't told the tool exists.

## Goals

1. Codex sessions (through this plugin) get functional parity with
   Anthropic sessions for Skills: the model can see which skills exist, read
   their trigger descriptions, and decide to call `skill` on its own.
2. No regression to the existing Codex-CLI-parity behavior this plugin
   exists for (official Codex system prompt, bridge message, stateless
   `store: false` operation, reasoning/text config, etc.).
3. Fail safe: if the skills catalog can't be extracted for any reason (empty
   project, extraction regex fails, opencode changes its wording), the
   request must still go through exactly as it does today — this is a
   strictly additive change.

## Non-goals

- Reproducing opencode's entire system prompt for Codex (env block, AGENTS.md,
  persona prompt). That duplication is intentionally avoided today because it
  conflicts with the official Codex CLI prompt this plugin injects instead.
  Only the **skills catalog** (and arguably `<mcp_instructions>`, see Open
  Questions) is in scope — the parts of opencode's system prompt that
  describe *capabilities the model doesn't otherwise know about*, as opposed
  to *behavioral/style guidance* (which the Codex CLI prompt already covers).
- Changing anything in the opencode core repo. This plugin cannot land a fix
  by itself — it does not own `request.ts`'s `isOpenaiOauth` branch — but it
  fully owns the destructive `body.instructions = codexInstructions`
  assignment, which is where the actual fix belongs.

## Verification (do this first, before writing the fix)

This plugin already has a request-logging facility
(`ENABLE_PLUGIN_REQUEST_LOGGING=1`, see `lib/logger.ts` /
`~/.opencode/logs/codex-plugin/`). Before implementing:

1. Add a temporary debug line in `transformRequestBody()` immediately before
   line 536, logging `body.instructions?.length` and whether it contains
   `"<available_skills>"`.
2. Run one opencode session against a project that has at least one
   discoverable skill (e.g. this very repo has skills configured — see the
   `<available_skills>` block visible in your own opencode session), on an
   OpenAI OAuth model routed through this plugin.
3. Confirm `body.instructions` at that point really does contain
   `<available_skills>...</available_skills>` before it gets overwritten.
4. Remove the temporary log line before implementing the real fix (or fold
   it into `logDebug` gated the same way existing debug logs are).

If step 3 does **not** confirm the assumption (e.g. AI SDK version drift
changes how `providerOptions.openai.instructions` is forwarded), fall back to
Open Question "alternate capture point" below before proceeding.

## Proposed design

### New helper: `lib/request/helpers/skill-catalog.ts`

```ts
/**
 * Extract opencode's <available_skills>...</available_skills> block (and
 * optionally <mcp_instructions>) from a system/instructions string, without
 * assuming anything else about the string's shape or origin.
 */
export function extractSkillCatalog(instructions: string | undefined): string | null {
	if (!instructions) return null;
	const match = instructions.match(/<available_skills>[\s\S]*?<\/available_skills>/);
	return match ? match[0] : null;
}
```

Keep it a single-purpose, pure string function — easy to unit test with
fixture strings shaped like opencode's real output (copy the block format
from `packages/opencode/src/session/system.ts` lines 320-345 in the opencode
repo, `Skill.fmt(list, { verbose: true })`, for realistic fixtures).

### `transformRequestBody()` change

Capture before the overwrite, recompose after:

```ts
const skillCatalog = extractSkillCatalog(body.instructions);
body.instructions = codexInstructions;
...
if (skillCatalog) {
	body.instructions += `\n\n${SKILL_TOOL_BRIDGE_HEADER}\n${skillCatalog}`;
}
```

Where `SKILL_TOOL_BRIDGE_HEADER` is a short, static string explaining the
`skill` tool exists and how to use it — this plugin's equivalent of
`packages/opencode/src/session/system.ts`'s two intro lines ("Skills provide
specialized instructions..." / "Use the skill tool to load a skill..."), so
the catalog isn't dropped into `instructions` with no framing.

This keeps the fix isolated to `instructions` (present in both `CODEX_MODE`
values, since the destructive assignment is unconditional) rather than
threading it through `addCodexBridgeMessage()` / `addToolRemapMessage()`,
which only run when `body.tools` is present and are conceptually about
*tool-name remapping*, not capability discovery.

### `CODEX_OPENCODE_BRIDGE` change (`lib/prompts/codex-opencode-bridge.ts`)

Add a short entry to the "Available OpenCode Tools" section, e.g. under
"Task Management" or its own subsection:

```
**Skills:**
- `skill` - Load a specialized skill by name when the task matches one listed
  under <available_skills> in your instructions.
```

This is independent of the `skill-catalog.ts` extraction — it just makes the
tool discoverable in the bridge prompt the same way Task/MCP tools already
are. Needed either way, since the bridge message currently omits `skill`
entirely from its tool list regardless of this fix.

### Tests

- `test/skill-catalog.test.ts` (new): `extractSkillCatalog()` — present,
  absent, malformed/unterminated tag, empty catalog
  (`<available_skills>\n</available_skills>` when no skills exist —
  `system.ts` still emits the wrapper tags even when the list is empty per
  `Skill.fmt`, confirm exact behavior against the opencode source before
  asserting).
- `test/request-transformer.test.ts`: extend `transformRequestBody()` cases
  — with skills catalog present in incoming `body.instructions`, assert it
  survives (as a substring) in the final `body.instructions`; without one,
  assert no regression (byte-identical to current passing tests).
- Confirm existing 250 tests still pass unmodified (this must be a strictly
  additive change per Goal 3).

### Docs

- `AGENTS.md`: add a subsection under "Key Design Patterns" documenting this
  (mirroring how CODEX_MODE / stateless operation are documented), and add
  `extractSkillCatalog()` to the file listing under `lib/request/helpers/`.
- `README.md` / `CHANGELOG.md`: one line noting Skills are now passed through
  to Codex models.

## Open questions

1. **`<mcp_instructions>` in scope too?** Same root cause affects MCP server
   instructions (`sys.mcp()` in opencode's `system.ts`) — they're also part
   of the same joined `system` string opencode builds, and get wiped by the
   same `body.instructions = codexInstructions` line. Decide whether this
   spec's fix extracts both blocks or just `<available_skills>` for now (the
   user's original ask was specifically about skills; MCP could be a
   fast-follow using the same `skill-catalog.ts` pattern generalized into
   `extractOpenCodeCapabilityBlocks()`).
2. **Token/cost impact.** A large skill catalog (many `SKILL.md` files across
   a workspace) adds real tokens to every Codex request's `instructions`,
   same as it does for Anthropic today. No special handling proposed here —
   parity with Anthropic's existing behavior is the explicit goal — but
   worth a mention in the CHANGELOG since Codex users don't currently pay
   this cost at all.
3. **Alternate capture point**, only needed if "Verification" above fails to
   confirm `body.instructions` carries the catalog pre-overwrite: opencode
   also exposes an `experimental.chat.system.transform` plugin hook
   (`request.ts` line 69-73, `{ system: string[] }`, mutable) that this
   plugin could register *as a second, separate opencode plugin hook*
   (`@opencode-ai/plugin` `experimental.chat.system.transform` export from
   `index.ts`) to capture the raw `system` array directly from opencode,
   before it's ever joined into `options.instructions` — sidestepping the
   AI-SDK-forwarding assumption entirely. More invasive (a second plugin
   hook + cross-call state to hand the captured catalog to the `fetch()`
   override for the same request), so only pursue if the simpler
   `body.instructions`-based capture doesn't pan out.

## Acceptance criteria

- [ ] Step-by-step verification in "Verification" confirms the capture point
      empirically, or Open Question 3's alternate path is implemented instead.
- [ ] `extractSkillCatalog()` unit-tested in isolation.
- [ ] `transformRequestBody()` preserves a real `<available_skills>` block
      (fixture from an actual opencode session) through to the final
      `body.instructions`, in both `CODEX_MODE=true` and `CODEX_MODE=false`.
- [ ] `CODEX_OPENCODE_BRIDGE` mentions the `skill` tool.
- [ ] `npm run typecheck && npm test` clean, all pre-existing tests
      unmodified and passing.
- [ ] One real end-to-end run: a project with a discoverable skill, driven
      through an OpenAI OAuth model via this plugin, where the model
      autonomously calls `skill` without being told the exact name — mirrors
      the end-to-end verification style already used in this repo's
      `progress.md` (e.g. the gpt-6-astra verification entry).
