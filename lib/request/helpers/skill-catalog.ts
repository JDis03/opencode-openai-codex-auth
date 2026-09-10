/**
 * OpenCode capability-block passthrough for OpenAI OAuth (Codex) sessions.
 *
 * Background: opencode's `isOpenaiOauth` branch (session/llm/request.ts) puts
 * the entire joined system prompt - persona, env, AGENTS.md, `<mcp_instructions>`,
 * and the `<available_skills>` catalog - into `options.instructions`, which the
 * AI SDK forwards as the Responses API's top-level `instructions` field. This
 * plugin's `transformRequestBody()` then unconditionally overwrites
 * `body.instructions` with the official Codex CLI instructions, silently
 * discarding both blocks before Codex ever sees them (confirmed empirically -
 * see specs/skill-catalog-passthrough.md).
 *
 * These helpers extract the two capability blocks before that overwrite so
 * they can be re-appended afterwards, giving Codex sessions the same
 * skill/MCP awareness Anthropic sessions already get. Kept as small, pure,
 * regex-based string functions - no assumptions about the rest of the
 * instructions string, safe to no-op if opencode ever changes its wording.
 */

const AVAILABLE_SKILLS_RE = /<available_skills>[\s\S]*?<\/available_skills>/;
const MCP_INSTRUCTIONS_RE = /<mcp_instructions>[\s\S]*?<\/mcp_instructions>/;

/**
 * Extract opencode's `<available_skills>...</available_skills>` block from an
 * instructions string, if present.
 * @param instructions - Raw instructions string (pre-overwrite)
 * @returns The matched block verbatim, or null if absent/malformed
 */
export function extractSkillCatalog(instructions: string | undefined): string | null {
	if (!instructions) return null;
	const match = instructions.match(AVAILABLE_SKILLS_RE);
	return match ? match[0] : null;
}

/**
 * Extract opencode's `<mcp_instructions>...</mcp_instructions>` block from an
 * instructions string, if present.
 * @param instructions - Raw instructions string (pre-overwrite)
 * @returns The matched block verbatim, or null if absent/malformed
 */
export function extractMcpInstructions(instructions: string | undefined): string | null {
	if (!instructions) return null;
	const match = instructions.match(MCP_INSTRUCTIONS_RE);
	return match ? match[0] : null;
}

/** Both capability blocks extracted from an instructions string, if present. */
export interface OpenCodeCapabilityBlocks {
	skillCatalog: string | null;
	mcpInstructions: string | null;
}

/**
 * Extract both preservable opencode capability blocks from an instructions
 * string in one pass, before the caller overwrites `body.instructions`.
 * @param instructions - Raw instructions string (pre-overwrite)
 */
export function extractOpenCodeCapabilityBlocks(
	instructions: string | undefined,
): OpenCodeCapabilityBlocks {
	return {
		skillCatalog: extractSkillCatalog(instructions),
		mcpInstructions: extractMcpInstructions(instructions),
	};
}

/**
 * Short framing line opencode itself prints just before `<available_skills>`
 * (see session/system.ts `sys.skills()`). That framing text lives in plain
 * prose *outside* the tag, so the regex above doesn't capture it - this is
 * our own equivalent framing to reattach when re-injecting the catalog into
 * Codex's instructions, so the block isn't dropped in with no context.
 */
export const SKILL_TOOL_BRIDGE_HEADER =
	"Skills provide specialized instructions and workflows for specific tasks. " +
	"Use the skill tool to load a skill when a task matches its description.";

/**
 * Recompose preserved capability blocks into a suffix to append to Codex's
 * instructions, in the same relative order opencode itself uses
 * (mcp before skills). Returns an empty string if nothing was preserved.
 * @param blocks - Extracted capability blocks
 */
export function formatPreservedCapabilityBlocks(blocks: OpenCodeCapabilityBlocks): string {
	const parts: string[] = [];
	if (blocks.mcpInstructions) {
		parts.push(blocks.mcpInstructions);
	}
	if (blocks.skillCatalog) {
		parts.push(`${SKILL_TOOL_BRIDGE_HEADER}\n${blocks.skillCatalog}`);
	}
	return parts.length > 0 ? `\n\n${parts.join("\n\n")}` : "";
}
