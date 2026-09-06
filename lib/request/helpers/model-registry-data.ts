/**
 * Model Registry — bundled defaults
 *
 * Single source of truth for "what models does this plugin know about".
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * Historically, adding support for a brand-new model (e.g. GPT-5.6) required
 * touching every one of these places by hand:
 *   - lib/request/helpers/model-map.ts   (exact preset id -> API model id)
 *   - lib/request/request-transformer.ts (reasoning capability booleans)
 *   - lib/prompts/codex.ts               (prompt-family + cache-file maps)
 *   - config/opencode-legacy.json + config/opencode-modern.json (presets)
 *   - README.md + config/README.md
 *   - several test files
 *
 * That is a lot of surface area for a maintainer to keep in sync, especially
 * for a solo/volunteer-maintained plugin. This registry collapses the *model
 * knowledge* part (normalization, reasoning capabilities, prompt family) into
 * ONE array of plain data objects. Adding a new model family now means
 * appending one `ModelRegistryEntry` here — normalizeModel(), getReasoningConfig(),
 * and getModelFamily() all consult this data automatically (see model-registry.ts).
 *
 * Config presets (config/opencode-*.json) and README tables still need their
 * own entries, because they carry human-facing metadata (display names,
 * context limits) this registry intentionally does not duplicate. But the
 * *behavioral* wiring — which API model id to send, which reasoning efforts
 * are legal, and which Codex CLI prompt to use — is now data-driven.
 *
 * REMOTE OVERLAY
 * ---------------
 * lib/request/helpers/model-registry.ts can optionally merge this bundled
 * list with a remotely-hosted JSON overlay (ETag-cached, same pattern as
 * lib/prompts/codex.ts's instruction fetching). That lets an active
 * maintainer ship recognition for a new model instantly (by updating a JSON
 * file on GitHub) without waiting for users to upgrade the npm package. It
 * is entirely opt-in (no default URL is configured) — see README.md.
 */

import type { ModelFamily } from "../../prompts/codex.js";

/** Reasoning effort values accepted anywhere in this plugin. */
export type ReasoningEffort =
	| "none"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

/**
 * Which non-universal reasoning effort tiers a model family accepts.
 * "low"/"medium"/"high" are assumed universal and are not tracked here.
 */
export interface ModelCapabilities {
	/** Accepts reasoning.effort = "none" (general-purpose GPT-5.x/5.6 models). */
	none?: boolean;
	/** Accepts reasoning.effort = "xhigh" (flagship + Codex Max/5.2-codex/5.6). */
	xhigh?: boolean;
	/** Accepts reasoning.effort = "max" (currently GPT-5.6 only). */
	max?: boolean;
}

/**
 * One model family known to the plugin.
 *
 * `id` is what gets sent to the Codex API. `aliases` are every exact preset
 * id (config key / model string) that should resolve to this entry,
 * matched case-insensitively. Always include `id` itself in `aliases`.
 */
export interface ModelRegistryEntry {
	/** Canonical model id sent to the Codex API, e.g. "gpt-5.2-codex". */
	id: string;
	/** Exact preset/config ids that resolve to this entry (case-insensitive). */
	aliases: string[];
	/** Codex CLI prompt/instructions family used to pick the system prompt. */
	family: ModelFamily;
	/** Reasoning effort tiers this model accepts beyond low/medium/high. */
	capabilities?: ModelCapabilities;
	/** Effort used when the user hasn't configured one explicitly. */
	defaultEffort: ReasoningEffort;
	/** Codex Mini has a narrow effort range (medium/high only) with its own clamp rules. */
	isCodexMini?: boolean;
	/** Legacy nano/mini presets default to a lower effort before being clamped to "low". */
	isLightweight?: boolean;
	/** Optional human-readable note for maintainers browsing this file. */
	note?: string;
}

/**
 * Bundled model registry, shipped with every release of this package.
 *
 * ORDER DOES NOT MATTER — lookups are by exact alias, not by scanning order —
 * but keep newest models near the top for readability.
 */
export const BUNDLED_MODEL_REGISTRY: ModelRegistryEntry[] = [
	// ============================================================================
	// GPT-5.6 (none/low/medium/high/xhigh/max)
	// ============================================================================
	{
		id: "gpt-5.6-sol",
		aliases: [
			"gpt-5.6",
			"gpt-5.6-sol",
			"gpt-5.6-sol-none",
			"gpt-5.6-sol-low",
			"gpt-5.6-sol-medium",
			"gpt-5.6-sol-high",
			"gpt-5.6-sol-xhigh",
			"gpt-5.6-sol-max",
		],
		family: "gpt-5.6",
		capabilities: { none: true, xhigh: true, max: true },
		defaultEffort: "medium",
	},
	{
		id: "gpt-5.6-terra",
		aliases: [
			"gpt-5.6-terra",
			"gpt-5.6-terra-none",
			"gpt-5.6-terra-low",
			"gpt-5.6-terra-medium",
			"gpt-5.6-terra-high",
			"gpt-5.6-terra-xhigh",
			"gpt-5.6-terra-max",
		],
		family: "gpt-5.6",
		capabilities: { none: true, xhigh: true, max: true },
		defaultEffort: "medium",
	},
	{
		id: "gpt-5.6-luna",
		aliases: [
			"gpt-5.6-luna",
			"gpt-5.6-luna-none",
			"gpt-5.6-luna-low",
			"gpt-5.6-luna-medium",
			"gpt-5.6-luna-high",
			"gpt-5.6-luna-xhigh",
			"gpt-5.6-luna-max",
		],
		family: "gpt-5.6",
		capabilities: { none: true, xhigh: true, max: true },
		defaultEffort: "medium",
	},

	// ============================================================================
	// GPT-5.2 Codex (low/medium/high/xhigh)
	// ============================================================================
	{
		id: "gpt-5.2-codex",
		aliases: [
			"gpt-5.2-codex",
			"gpt-5.2-codex-low",
			"gpt-5.2-codex-medium",
			"gpt-5.2-codex-high",
			"gpt-5.2-codex-xhigh",
		],
		family: "gpt-5.2-codex",
		capabilities: { xhigh: true },
		defaultEffort: "high",
	},

	// ============================================================================
	// GPT-5.2 general purpose (none/low/medium/high/xhigh)
	// ============================================================================
	{
		id: "gpt-5.2",
		aliases: [
			"gpt-5.2",
			"gpt-5.2-none",
			"gpt-5.2-low",
			"gpt-5.2-medium",
			"gpt-5.2-high",
			"gpt-5.2-xhigh",
		],
		family: "gpt-5.2",
		capabilities: { none: true, xhigh: true },
		defaultEffort: "high",
	},

	// ============================================================================
	// GPT-5.1 Codex Max (low/medium/high/xhigh)
	// ============================================================================
	{
		id: "gpt-5.1-codex-max",
		aliases: [
			"gpt-5.1-codex-max",
			"gpt-5.1-codex-max-low",
			"gpt-5.1-codex-max-medium",
			"gpt-5.1-codex-max-high",
			"gpt-5.1-codex-max-xhigh",
		],
		family: "codex-max",
		capabilities: { xhigh: true },
		defaultEffort: "high",
	},

	// ============================================================================
	// GPT-5.1 Codex Mini (medium/high only, own clamp rules)
	// ============================================================================
	{
		id: "gpt-5.1-codex-mini",
		aliases: [
			"gpt-5.1-codex-mini",
			"gpt-5.1-codex-mini-medium",
			"gpt-5.1-codex-mini-high",
			// Legacy GPT-5.0 codex-mini names (being phased out) share the same behavior
			"codex-mini-latest",
			"gpt-5-codex-mini",
			"gpt-5-codex-mini-medium",
			"gpt-5-codex-mini-high",
		],
		family: "codex",
		defaultEffort: "medium",
		isCodexMini: true,
	},

	// ============================================================================
	// GPT-5.1 Codex (low/medium/high)
	// ============================================================================
	{
		id: "gpt-5.1-codex",
		aliases: [
			"gpt-5.1-codex",
			"gpt-5.1-codex-low",
			"gpt-5.1-codex-medium",
			"gpt-5.1-codex-high",
			// Legacy GPT-5.0 codex name (being phased out) shares the same behavior
			"gpt-5-codex",
		],
		family: "codex",
		defaultEffort: "medium",
	},

	// ============================================================================
	// GPT-5.1 general purpose (none/low/medium/high)
	// ============================================================================
	{
		id: "gpt-5.1",
		aliases: [
			"gpt-5.1",
			"gpt-5.1-none",
			"gpt-5.1-low",
			"gpt-5.1-medium",
			"gpt-5.1-high",
			"gpt-5.1-chat-latest",
			// Legacy GPT-5.0 names (being phased out) normalize to gpt-5.1
			"gpt-5",
		],
		family: "gpt-5.1",
		capabilities: { none: true },
		defaultEffort: "medium",
	},

	// ============================================================================
	// Legacy GPT-5.0 lightweight presets (being phased out; normalize to gpt-5.1)
	// Kept as distinct aliases (not merged into the "gpt-5.1" entry above) so
	// getReasoningConfig() still recognizes them as lightweight when called with
	// the raw preset id, before normalizeModel() has stripped the "nano"/"mini"
	// signal from the model string.
	// ============================================================================
	{
		id: "gpt-5.1",
		aliases: ["gpt-5-mini", "gpt-5-nano"],
		family: "gpt-5.1",
		capabilities: { none: true },
		defaultEffort: "minimal",
		isLightweight: true,
		note: "Legacy gpt-5-mini/gpt-5-nano presets. gpt-5 is being phased out in favor of gpt-5.1.",
	},
];
