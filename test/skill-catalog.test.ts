import { describe, it, expect } from 'vitest';
import {
	extractSkillCatalog,
	extractMcpInstructions,
	extractOpenCodeCapabilityBlocks,
	formatPreservedCapabilityBlocks,
	SKILL_TOOL_BRIDGE_HEADER,
} from '../lib/request/helpers/skill-catalog.js';

// Realistic fixture shaped like opencode's real Skill.fmt({ verbose: true })
// output (packages/opencode/src/skill/index.ts).
const REAL_SKILLS_BLOCK = [
	'<available_skills>',
	'  <skill>',
	'    <name>context7-mcp</name>',
	'    <description>Use for library/framework docs.</description>',
	'    <location>/home/dark/.agents/skills/context7-mcp/SKILL.md</location>',
	'  </skill>',
	'</available_skills>',
].join('\n');

const EMPTY_SKILLS_BLOCK = '<available_skills>\n</available_skills>';

const REAL_MCP_BLOCK = [
	'<mcp_instructions>',
	'You have access to the following MCP servers:',
	'- context7: library docs',
	'</mcp_instructions>',
].join('\n');

describe('skill-catalog helpers', () => {
	describe('extractSkillCatalog', () => {
		it('returns null for undefined input', () => {
			expect(extractSkillCatalog(undefined)).toBeNull();
		});

		it('returns null when no catalog is present', () => {
			expect(extractSkillCatalog('You are a helpful assistant.')).toBeNull();
		});

		it('extracts a real-shaped catalog verbatim', () => {
			const instructions = `Some persona text\n${REAL_SKILLS_BLOCK}\nMore text`;
			expect(extractSkillCatalog(instructions)).toBe(REAL_SKILLS_BLOCK);
		});

		it('extracts an empty catalog (no skills configured)', () => {
			const instructions = `Persona\n${EMPTY_SKILLS_BLOCK}`;
			expect(extractSkillCatalog(instructions)).toBe(EMPTY_SKILLS_BLOCK);
		});

		it('returns null for an unterminated/malformed tag', () => {
			const instructions = 'Persona\n<available_skills>\n  <skill>broken';
			expect(extractSkillCatalog(instructions)).toBeNull();
		});
	});

	describe('extractMcpInstructions', () => {
		it('returns null for undefined input', () => {
			expect(extractMcpInstructions(undefined)).toBeNull();
		});

		it('returns null when absent', () => {
			expect(extractMcpInstructions('no mcp here')).toBeNull();
		});

		it('extracts a real-shaped mcp_instructions block verbatim', () => {
			const instructions = `Persona\n${REAL_MCP_BLOCK}\nTrailer`;
			expect(extractMcpInstructions(instructions)).toBe(REAL_MCP_BLOCK);
		});
	});

	describe('extractOpenCodeCapabilityBlocks', () => {
		it('extracts both blocks in one pass when both are present', () => {
			const instructions = `Persona\n${REAL_MCP_BLOCK}\n${REAL_SKILLS_BLOCK}`;
			const result = extractOpenCodeCapabilityBlocks(instructions);
			expect(result.mcpInstructions).toBe(REAL_MCP_BLOCK);
			expect(result.skillCatalog).toBe(REAL_SKILLS_BLOCK);
		});

		it('returns nulls for both when instructions is undefined', () => {
			expect(extractOpenCodeCapabilityBlocks(undefined)).toEqual({
				skillCatalog: null,
				mcpInstructions: null,
			});
		});

		it('returns nulls for both when neither block is present', () => {
			expect(extractOpenCodeCapabilityBlocks('plain instructions')).toEqual({
				skillCatalog: null,
				mcpInstructions: null,
			});
		});
	});

	describe('formatPreservedCapabilityBlocks', () => {
		it('returns empty string when nothing was preserved', () => {
			expect(formatPreservedCapabilityBlocks({ skillCatalog: null, mcpInstructions: null })).toBe('');
		});

		it('formats skills-only with the bridge header', () => {
			const result = formatPreservedCapabilityBlocks({
				skillCatalog: REAL_SKILLS_BLOCK,
				mcpInstructions: null,
			});
			expect(result).toBe(`\n\n${SKILL_TOOL_BRIDGE_HEADER}\n${REAL_SKILLS_BLOCK}`);
		});

		it('formats mcp-only without a synthetic header (tag is self-contained)', () => {
			const result = formatPreservedCapabilityBlocks({
				skillCatalog: null,
				mcpInstructions: REAL_MCP_BLOCK,
			});
			expect(result).toBe(`\n\n${REAL_MCP_BLOCK}`);
		});

		it('orders mcp before skills when both are present, matching opencode', () => {
			const result = formatPreservedCapabilityBlocks({
				skillCatalog: REAL_SKILLS_BLOCK,
				mcpInstructions: REAL_MCP_BLOCK,
			});
			const mcpIndex = result.indexOf(REAL_MCP_BLOCK);
			const skillsIndex = result.indexOf(REAL_SKILLS_BLOCK);
			expect(mcpIndex).toBeGreaterThan(-1);
			expect(skillsIndex).toBeGreaterThan(mcpIndex);
		});
	});
});
