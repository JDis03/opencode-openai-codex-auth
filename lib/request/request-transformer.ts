import { logDebug, logWarn } from "../logger.js";
import { TOOL_REMAP_MESSAGE } from "../prompts/codex.js";
import { CODEX_OPENCODE_BRIDGE } from "../prompts/codex-opencode-bridge.js";
import { getOpenCodeCodexPrompt } from "../prompts/opencode-codex.js";
import { getNormalizedModel } from "./helpers/model-map.js";
import { lookupModelRegistryEntry } from "./helpers/model-registry.js";
import {
	extractOpenCodeCapabilityBlocks,
	formatPreservedCapabilityBlocks,
} from "./helpers/skill-catalog.js";
import {
	filterOpenCodeSystemPromptsWithCachedPrompt,
	normalizeOrphanedToolOutputs,
} from "./helpers/input-utils.js";
import type {
	ConfigOptions,
	InputItem,
	ReasoningConfig,
	RequestBody,
	UserConfig,
} from "../types.js";

export {
	isOpenCodeSystemPrompt,
	filterOpenCodeSystemPromptsWithCachedPrompt,
} from "./helpers/input-utils.js";

/**
 * Normalize model name to Codex-supported variants
 *
 * Uses explicit model map for known models, with fallback pattern matching
 * for unknown/custom model names.
 *
 * @param model - Original model name (e.g., "gpt-5.1-codex-low", "openai/gpt-5-codex")
 * @returns Normalized model name (e.g., "gpt-5.1-codex", "gpt-5-codex")
 */
export function normalizeModel(model: string | undefined): string {
	if (!model) return "gpt-5.1";

	// Strip provider prefix if present (e.g., "openai/gpt-5-codex" → "gpt-5-codex")
	const modelId = model.includes("/") ? model.split("/").pop()! : model;

	// Try explicit model map first (handles all known model variants)
	const mappedModel = getNormalizedModel(modelId);
	if (mappedModel) {
		return mappedModel;
	}

	// Try the model registry (bundled defaults + optional remote overlay).
	// This is the preferred place to add support for a brand-new model
	// family — see lib/request/helpers/model-registry-data.ts — so most new
	// models never need to touch the pattern-matching fallback below at all.
	const registryEntry = lookupModelRegistryEntry(modelId);
	if (registryEntry) {
		return registryEntry.id;
	}

	// Last-resort fallback: generic pattern-based matching for names that are
	// in neither the static map nor the registry (e.g. brand-new/unregistered
	// custom model strings). This preserves backwards compatibility with old
	// verbose names like "GPT 5 Codex Low (ChatGPT Subscription)".
	const normalized = modelId.toLowerCase();

	// Priority order for pattern matching (most specific first):
	// 1. GPT-5.6 tiers. The base alias routes to Sol.
	if (
		normalized.includes("gpt-5.6-terra") ||
		normalized.includes("gpt 5.6 terra")
	) {
		return "gpt-5.6-terra";
	}
	if (
		normalized.includes("gpt-5.6-luna") ||
		normalized.includes("gpt 5.6 luna")
	) {
		return "gpt-5.6-luna";
	}
	if (
		normalized.includes("gpt-5.6-sol") ||
		normalized.includes("gpt 5.6 sol") ||
		normalized.includes("gpt-5.6") ||
		normalized.includes("gpt 5.6")
	) {
		return "gpt-5.6-sol";
	}

	// 2. GPT-5.2 Codex
	if (
		normalized.includes("gpt-5.2-codex") ||
		normalized.includes("gpt 5.2 codex")
	) {
		return "gpt-5.2-codex";
	}

	// 3. GPT-5.2 (general purpose)
	if (normalized.includes("gpt-5.2") || normalized.includes("gpt 5.2")) {
		return "gpt-5.2";
	}

	// 3. GPT-5.1 Codex Max
	if (
		normalized.includes("gpt-5.1-codex-max") ||
		normalized.includes("gpt 5.1 codex max")
	) {
		return "gpt-5.1-codex-max";
	}

	// 4. GPT-5.1 Codex Mini
	if (
		normalized.includes("gpt-5.1-codex-mini") ||
		normalized.includes("gpt 5.1 codex mini")
	) {
		return "gpt-5.1-codex-mini";
	}

	// 5. Legacy Codex Mini
	if (
		normalized.includes("codex-mini-latest") ||
		normalized.includes("gpt-5-codex-mini") ||
		normalized.includes("gpt 5 codex mini")
	) {
		return "codex-mini-latest";
	}

	// 6. GPT-5.1 Codex
	if (
		normalized.includes("gpt-5.1-codex") ||
		normalized.includes("gpt 5.1 codex")
	) {
		return "gpt-5.1-codex";
	}

	// 7. GPT-5.1 (general-purpose)
	if (normalized.includes("gpt-5.1") || normalized.includes("gpt 5.1")) {
		return "gpt-5.1";
	}

	// 8. GPT-5 Codex family (any variant with "codex")
	if (normalized.includes("codex")) {
		return "gpt-5.1-codex";
	}

	// 9. GPT-5 family (any variant) - default to 5.1 as 5 is being phased out
	if (normalized.includes("gpt-5") || normalized.includes("gpt 5")) {
		return "gpt-5.1";
	}

	// 10. Safety net for a genuinely unrecognized model whose numeric version
	// is NEWER than anything this plugin's pattern-matching knows about (e.g.
	// a brand-new "gpt-7-nova" or "gpt-6-something" released before a registry
	// entry was added for it — this is exactly what happened with gpt-6-sol
	// and gpt-6-luna before they were added above). Passing the id through
	// unchanged lets the real Codex backend decide whether it's valid, which
	// is much safer than silently downgrading the request to a much older,
	// weaker model with no error at all. Older/legacy families (e.g. "gpt-4")
	// are intentionally NOT covered by this — they keep normalizing forward
	// to gpt-5.1 via the final fallback below, matching existing migration
	// behavior and every "unknown-model"/"gpt-4" test case.
	const versionMatch = normalized.match(/^gpt[-\s]?(\d+)(?:\.(\d+))?/);
	if (versionMatch) {
		const major = parseInt(versionMatch[1], 10);
		const minor = versionMatch[2] ? parseInt(versionMatch[2], 10) : 0;
		const version = major + minor / 10;
		// Highest major.minor version explicitly known to the pattern-matching
		// chain above (registry-known models like gpt-6-astra never reach this
		// point at all, since lookupModelRegistryEntry() already returned).
		const HIGHEST_KNOWN_FALLBACK_VERSION = 5.6;
		if (version > HIGHEST_KNOWN_FALLBACK_VERSION) {
			return modelId;
		}
	}

	// Default fallback - use gpt-5.1 as gpt-5 is being phased out
	return "gpt-5.1";
}

/**
 * Extract configuration for a specific model
 * Merges global options with model-specific options (model-specific takes precedence)
 * @param modelName - Model name (e.g., "gpt-5-codex")
 * @param userConfig - Full user configuration object
 * @returns Merged configuration for this model
 */
export function getModelConfig(
	modelName: string,
	userConfig: UserConfig = { global: {}, models: {} },
): ConfigOptions {
	const globalOptions = userConfig.global || {};
	const modelOptions = userConfig.models?.[modelName]?.options || {};

	// Model-specific options override global options
	return { ...globalOptions, ...modelOptions };
}

function resolveReasoningConfig(
	modelName: string,
	modelConfig: ConfigOptions,
	body: RequestBody,
): ReasoningConfig {
	const providerOpenAI = body.providerOptions?.openai;
	const existingEffort =
		body.reasoning?.effort ?? providerOpenAI?.reasoningEffort;
	const existingSummary =
		body.reasoning?.summary ?? providerOpenAI?.reasoningSummary;

	const mergedConfig: ConfigOptions = {
		...modelConfig,
		...(existingEffort ? { reasoningEffort: existingEffort } : {}),
		...(existingSummary ? { reasoningSummary: existingSummary } : {}),
	};

	return getReasoningConfig(modelName, mergedConfig);
}

function resolveTextVerbosity(
	modelConfig: ConfigOptions,
	body: RequestBody,
): "low" | "medium" | "high" {
	const providerOpenAI = body.providerOptions?.openai;
	return (
		body.text?.verbosity ??
		providerOpenAI?.textVerbosity ??
		modelConfig.textVerbosity ??
		"medium"
	);
}

function resolveInclude(modelConfig: ConfigOptions, body: RequestBody): string[] {
	const providerOpenAI = body.providerOptions?.openai;
	const base =
		body.include ??
		providerOpenAI?.include ??
		modelConfig.include ??
		["reasoning.encrypted_content"];
	const include = Array.from(new Set(base.filter(Boolean)));
	if (!include.includes("reasoning.encrypted_content")) {
		include.push("reasoning.encrypted_content");
	}
	return include;
}

/**
 * Configure reasoning parameters based on model variant and user config
 *
 * NOTE: This plugin follows Codex CLI defaults instead of opencode defaults because:
 * - We're accessing the ChatGPT backend API (not OpenAI Platform API)
 * - opencode explicitly excludes gpt-5-codex from automatic reasoning configuration
 * - Codex CLI has been thoroughly tested against this backend
 *
 * @param originalModel - Original model name before normalization
 * @param userConfig - User configuration object
 * @returns Reasoning configuration
 */
/**
 * Reasoning capability flags used to compute the final effort value.
 * Derived either from the model registry (preferred) or from the legacy
 * pattern-matching fallback below.
 */
interface ReasoningCapabilityFlags {
	supportsXhigh: boolean;
	supportsMax: boolean;
	supportsNone: boolean;
	isCodexMini: boolean;
	defaultEffort: ReasoningConfig["effort"];
}

/**
 * Legacy pattern-matching derivation of reasoning capabilities, kept as the
 * fallback for any model name not present in the model registry (bundled or
 * remote-overlaid) — see lib/request/helpers/model-registry-data.ts, which is
 * the preferred place to add support for a new model going forward.
 */
function deriveLegacyReasoningFlags(
	modelName: string | undefined,
): ReasoningCapabilityFlags {
	const normalizedName = modelName?.toLowerCase() ?? "";
	const isGpt56 =
		normalizedName.includes("gpt-5.6") || normalizedName.includes("gpt 5.6");

	// GPT-5.2 Codex is the newest codex model (supports xhigh, but not "none")
	const isGpt52Codex =
		normalizedName.includes("gpt-5.2-codex") ||
		normalizedName.includes("gpt 5.2 codex");

	// GPT-5.2 general purpose (not codex variant)
	const isGpt52General =
		(normalizedName.includes("gpt-5.2") || normalizedName.includes("gpt 5.2")) &&
		!isGpt52Codex;
	const isCodexMax =
		normalizedName.includes("codex-max") ||
		normalizedName.includes("codex max");
	const isCodexMini =
		normalizedName.includes("codex-mini") ||
		normalizedName.includes("codex mini") ||
		normalizedName.includes("codex_mini") ||
		normalizedName.includes("codex-mini-latest");
	const isCodex = normalizedName.includes("codex") && !isCodexMini;
	const isLightweight =
		!isCodexMini &&
		(normalizedName.includes("nano") ||
			normalizedName.includes("mini"));

	// GPT-5.1 general purpose (not codex variants) - supports "none" per OpenAI API docs
	const isGpt51General =
		(normalizedName.includes("gpt-5.1") || normalizedName.includes("gpt 5.1")) &&
		!isCodex &&
		!isCodexMax &&
		!isCodexMini;

	// GPT 5.2, GPT 5.2 Codex, and Codex Max support xhigh reasoning
	const supportsXhigh = isGpt56 || isGpt52General || isGpt52Codex || isCodexMax;
	const supportsMax = isGpt56;

	// GPT 5.1 general and GPT 5.2 general support "none" reasoning per:
	// - OpenAI API docs: "gpt-5.1 defaults to none, supports: none, low, medium, high"
	// - Codex CLI: ReasoningEffort enum includes None variant (codex-rs/protocol/src/openai_models.rs)
	// - Codex CLI: docs/config.md lists "none" as valid for model_reasoning_effort
	// - gpt-5.2 (being newer) also supports: none, low, medium, high, xhigh
	// - Codex models (including GPT-5.2 Codex) do NOT support "none"
	const supportsNone = isGpt56 || isGpt52General || isGpt51General;

	// Default based on model type (Codex CLI defaults)
	// Note: OpenAI docs say gpt-5.1 defaults to "none", but we default to "medium"
	// for better coding assistance unless user explicitly requests "none"
	const defaultEffort: ReasoningConfig["effort"] = isCodexMini
		? "medium"
		: isGpt56
			? "medium"
			: supportsXhigh
				? "high"
				: isLightweight
					? "minimal"
					: "medium";

	return { supportsXhigh, supportsMax, supportsNone, isCodexMini, defaultEffort };
}

export function getReasoningConfig(
	modelName: string | undefined,
	userConfig: ConfigOptions = {},
): ReasoningConfig {
	// Prefer the model registry (bundled + optional remote overlay) — see
	// lib/request/helpers/model-registry-data.ts. Fall back to legacy
	// pattern-matching only for names the registry doesn't recognize at all,
	// so existing/custom model strings keep working exactly as before.
	const registryEntry = lookupModelRegistryEntry(modelName);
	const { supportsXhigh, supportsMax, supportsNone, isCodexMini, defaultEffort } =
		registryEntry
			? {
					supportsXhigh: !!registryEntry.capabilities?.xhigh,
					supportsMax: !!registryEntry.capabilities?.max,
					supportsNone: !!registryEntry.capabilities?.none,
					isCodexMini: !!registryEntry.isCodexMini,
					defaultEffort: registryEntry.defaultEffort,
				}
			: deriveLegacyReasoningFlags(modelName);

	// Get user-requested effort
	let effort = userConfig.reasoningEffort || defaultEffort;

	if (isCodexMini) {
		if (effort === "minimal" || effort === "low" || effort === "none") {
			effort = "medium";
		}
		if (effort === "xhigh") {
			effort = "high";
		}
		if (effort !== "high" && effort !== "medium") {
			effort = "medium";
		}
	}

	if (!supportsMax && effort === "max") {
		effort = supportsXhigh ? "xhigh" : "high";
	}

	// For models that don't support xhigh, downgrade to high
	if (!supportsXhigh && effort === "xhigh") {
		effort = "high";
	}

	// For models that don't support "none", upgrade to "low"
	// (Codex models don't support "none" - only GPT-5.1 and GPT-5.2 general purpose do)
	if (!supportsNone && effort === "none") {
		effort = "low";
	}

	// Normalize "minimal" to "low" for all non-mini models
	// The ChatGPT Codex backend does not accept "minimal" (supports none/low/medium/high).
	if (effort === "minimal") {
		effort = "low";
	}

	return {
		effort,
		summary: userConfig.reasoningSummary || "auto", // Changed from "detailed" to match Codex CLI
	};
}

/**
 * Filter input array for stateless Codex API (store: false)
 *
 * Two transformations needed:
 * 1. Remove AI SDK-specific items (not supported by Codex API)
 * 2. Strip IDs from all remaining items (stateless mode)
 *
 * AI SDK constructs to REMOVE (not in OpenAI Responses API spec):
 * - type: "item_reference" - AI SDK uses this for server-side state lookup
 *
 * Items to KEEP (strip IDs):
 * - type: "message" - Conversation messages (provides context to LLM)
 * - type: "function_call" - Tool calls from conversation
 * - type: "function_call_output" - Tool results from conversation
 *
 * Context is maintained through:
 * - Full message history (without IDs)
 * - reasoning.encrypted_content (for reasoning continuity)
 *
 * @param input - Original input array from OpenCode/AI SDK
 * @returns Filtered input array compatible with Codex API
 */
export function filterInput(
	input: InputItem[] | undefined,
): InputItem[] | undefined {
	if (!Array.isArray(input)) return input;

	return input
		.filter((item) => {
			// Remove AI SDK constructs not supported by Codex API
			if (item.type === "item_reference") {
				return false; // AI SDK only - references server state
			}
			return true; // Keep all other items
		})
		.map((item) => {
			// Strip IDs from all items (Codex API stateless mode)
			if (item.id) {
				const { id, ...itemWithoutId } = item;
				return itemWithoutId as InputItem;
			}
			return item;
		});
}

/**
 * Filter out OpenCode system prompts from input
 * Used in CODEX_MODE to replace OpenCode prompts with Codex-OpenCode bridge
 * @param input - Input array
 * @returns Input array without OpenCode system prompts
 */
export async function filterOpenCodeSystemPrompts(
	input: InputItem[] | undefined,
): Promise<InputItem[] | undefined> {
	if (!Array.isArray(input)) return input;

	// Fetch cached OpenCode prompt for verification
	let cachedPrompt: string | null = null;
	try {
		cachedPrompt = await getOpenCodeCodexPrompt();
	} catch {
		// If fetch fails, fallback to text-based detection only
		// This is safe because we still have the "starts with" check
	}

	return filterOpenCodeSystemPromptsWithCachedPrompt(input, cachedPrompt);
}

/**
 * Add Codex-OpenCode bridge message to input if tools are present
 * @param input - Input array
 * @param hasTools - Whether tools are present in request
 * @returns Input array with bridge message prepended if needed
 */
export function addCodexBridgeMessage(
	input: InputItem[] | undefined,
	hasTools: boolean,
): InputItem[] | undefined {
	if (!hasTools || !Array.isArray(input)) return input;

	const bridgeMessage: InputItem = {
		type: "message",
		role: "developer",
		content: [
			{
				type: "input_text",
				text: CODEX_OPENCODE_BRIDGE,
			},
		],
	};

	return [bridgeMessage, ...input];
}

/**
 * Add tool remapping message to input if tools are present
 * @param input - Input array
 * @param hasTools - Whether tools are present in request
 * @returns Input array with tool remap message prepended if needed
 */
export function addToolRemapMessage(
	input: InputItem[] | undefined,
	hasTools: boolean,
): InputItem[] | undefined {
	if (!hasTools || !Array.isArray(input)) return input;

	const toolRemapMessage: InputItem = {
		type: "message",
		role: "developer",
		content: [
			{
				type: "input_text",
				text: TOOL_REMAP_MESSAGE,
			},
		],
	};

	return [toolRemapMessage, ...input];
}

/**
 * Transform request body for Codex API
 *
 * NOTE: Configuration follows Codex CLI patterns instead of opencode defaults:
 * - opencode sets textVerbosity="low" for gpt-5, but Codex CLI uses "medium"
 * - opencode excludes gpt-5-codex from reasoning configuration
 * - This plugin uses store=false (stateless), requiring encrypted reasoning content
 *
 * @param body - Original request body
 * @param codexInstructions - Codex system instructions
 * @param userConfig - User configuration from loader
 * @param codexMode - Enable CODEX_MODE (bridge prompt instead of tool remap) - defaults to true
 * @returns Transformed request body
 */
export async function transformRequestBody(
	body: RequestBody,
	codexInstructions: string,
	userConfig: UserConfig = { global: {}, models: {} },
	codexMode = true,
): Promise<RequestBody> {
	const originalModel = body.model;
	const normalizedModel = normalizeModel(body.model);

	// Get model-specific configuration using ORIGINAL model name (config key)
	// This allows per-model options like "gpt-5-codex-low" to work correctly
	const lookupModel = originalModel || normalizedModel;
	const modelConfig = getModelConfig(lookupModel, userConfig);

	// Debug: Log which config was resolved
	logDebug(
		`Model config lookup: "${lookupModel}" → normalized to "${normalizedModel}" for API`,
		{
			hasModelSpecificConfig: !!userConfig.models?.[lookupModel],
			resolvedConfig: modelConfig,
		},
	);

	// Normalize model name for API call
	body.model = normalizedModel;

	// Codex required fields
	// ChatGPT backend REQUIRES store=false (confirmed via testing)
	body.store = false;
	// Always set stream=true for API - response handling detects original intent
	body.stream = true;

	// Preserve opencode's <available_skills>/<mcp_instructions> blocks before
	// they get overwritten below - see specs/skill-catalog-passthrough.md.
	// opencode's isOpenaiOauth path puts its full system prompt (including
	// these capability blocks) into body.instructions instead of role:system
	// messages, so this is the only place they can be recovered from.
	const preservedCapabilityBlocks = extractOpenCodeCapabilityBlocks(body.instructions);

	body.instructions = codexInstructions + formatPreservedCapabilityBlocks(preservedCapabilityBlocks);

	// Prompt caching relies on the host providing a stable prompt_cache_key
	// (OpenCode passes its session identifier). We no longer synthesize one here.

	// Filter and transform input
	if (body.input && Array.isArray(body.input)) {
		// Debug: Log original input message IDs before filtering
		const originalIds = body.input
			.filter((item) => item.id)
			.map((item) => item.id);
		if (originalIds.length > 0) {
			logDebug(
				`Filtering ${originalIds.length} message IDs from input:`,
				originalIds,
			);
		}

		body.input = filterInput(body.input);

		// Debug: Verify all IDs were removed
		const remainingIds = (body.input || [])
			.filter((item) => item.id)
			.map((item) => item.id);
		if (remainingIds.length > 0) {
			logWarn(
				`WARNING: ${remainingIds.length} IDs still present after filtering:`,
				remainingIds,
			);
		} else if (originalIds.length > 0) {
			logDebug(`Successfully removed all ${originalIds.length} message IDs`);
		}

		if (codexMode) {
			// CODEX_MODE: Remove OpenCode system prompt, add bridge prompt
			body.input = await filterOpenCodeSystemPrompts(body.input);
			body.input = addCodexBridgeMessage(body.input, !!body.tools);
		} else {
			// DEFAULT MODE: Keep original behavior with tool remap message
			body.input = addToolRemapMessage(body.input, !!body.tools);
		}

		// Handle orphaned function_call_output items (where function_call was an item_reference that got filtered)
		// Instead of removing orphans (which causes infinite loops as LLM loses tool results),
		// convert them to messages to preserve context while avoiding API errors
		if (body.input) {
			body.input = normalizeOrphanedToolOutputs(body.input);
		}
	}

	// Configure reasoning (prefer existing body/provider options, then config defaults)
	const reasoningConfig = resolveReasoningConfig(
		normalizedModel,
		modelConfig,
		body,
	);
	body.reasoning = {
		...body.reasoning,
		...reasoningConfig,
	};

	// Configure text verbosity (support user config)
	// Default: "medium" (matches Codex CLI default for all GPT-5 models)
	body.text = {
		...body.text,
		verbosity: resolveTextVerbosity(modelConfig, body),
	};

	// Add include for encrypted reasoning content
	// Default: ["reasoning.encrypted_content"] (required for stateless operation with store=false)
	// This allows reasoning context to persist across turns without server-side storage
	body.include = resolveInclude(modelConfig, body);

	// Remove unsupported parameters
	body.max_output_tokens = undefined;
	body.max_completion_tokens = undefined;

	return body;
}
