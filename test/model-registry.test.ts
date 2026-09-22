import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';

// Mock the fs module (same pattern as test/plugin-config.test.ts) so the
// registry's disk cache never touches the real ~/.opencode/cache directory.
vi.mock('node:fs', async () => {
	const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
	return {
		...actual,
		existsSync: vi.fn(),
		readFileSync: vi.fn(),
		writeFileSync: vi.fn(),
		mkdirSync: vi.fn(),
	};
});

import {
	getModelRegistry,
	lookupModelRegistryEntry,
	configureModelRegistrySource,
	__resetModelRegistryForTests,
	__triggerModelRegistryRefreshForTests,
} from '../lib/request/helpers/model-registry.js';
import { normalizeModel, getReasoningConfig } from '../lib/request/request-transformer.js';
import { getModelFamily } from '../lib/prompts/codex.js';

describe('Model Registry', () => {
	const mockExistsSync = vi.mocked(fs.existsSync);
	let originalEnvUrl: string | undefined;
	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		originalEnvUrl = process.env.OPENCODE_CODEX_MODEL_REGISTRY_URL;
		delete process.env.OPENCODE_CODEX_MODEL_REGISTRY_URL;
		mockExistsSync.mockReturnValue(false); // no cached overlay on disk
		__resetModelRegistryForTests();
		fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
	});

	afterEach(() => {
		if (originalEnvUrl === undefined) {
			delete process.env.OPENCODE_CODEX_MODEL_REGISTRY_URL;
		} else {
			process.env.OPENCODE_CODEX_MODEL_REGISTRY_URL = originalEnvUrl;
		}
		__resetModelRegistryForTests();
		vi.unstubAllGlobals();
	});

	describe('bundled registry lookups', () => {
		it('resolves a known alias to its canonical entry', () => {
			const entry = lookupModelRegistryEntry('gpt-5.2-codex');
			expect(entry?.id).toBe('gpt-5.2-codex');
			expect(entry?.family).toBe('gpt-5.2-codex');
		});

		it('is case-insensitive', () => {
			expect(lookupModelRegistryEntry('GPT-5.2-CODEX')?.id).toBe('gpt-5.2-codex');
		});

		it('returns undefined for a completely unknown model', () => {
			expect(lookupModelRegistryEntry('astra-6-mega-ultra')).toBeUndefined();
			expect(lookupModelRegistryEntry(undefined)).toBeUndefined();
		});

		it('includes every currently-shipped model family', () => {
			const registry = getModelRegistry();
			const ids = new Set(registry.map((e) => e.id));
			expect(ids).toEqual(
				new Set([
					'gpt-6-astra',
					'gpt-6-sol',
					'gpt-6-luna',
					'gpt-5.6-sol',
					'gpt-5.6-terra',
					'gpt-5.6-luna',
					'gpt-5.2-codex',
					'gpt-5.2',
					'gpt-5.1-codex-max',
					'gpt-5.1-codex-mini',
					'gpt-5.1-codex',
					'gpt-5.1',
				]),
			);
		});

		it('resolves GPT-6 Astra (verified live against the ChatGPT Codex backend)', () => {
			expect(lookupModelRegistryEntry('gpt-6-astra')?.id).toBe('gpt-6-astra');
			// Bare "gpt-6" is a convenience alias — the raw API rejects it directly.
			expect(lookupModelRegistryEntry('gpt-6')?.id).toBe('gpt-6-astra');
			expect(lookupModelRegistryEntry('gpt-6-astra')?.capabilities).toEqual({
				xhigh: true,
				max: true,
			});
		});

		it('resolves GPT-6 Sol and Luna (verified live against the ChatGPT Codex backend)', () => {
			expect(lookupModelRegistryEntry('gpt-6-sol')?.id).toBe('gpt-6-sol');
			expect(lookupModelRegistryEntry('gpt-6-sol')?.family).toBe('gpt-5.6');
			expect(lookupModelRegistryEntry('gpt-6-sol')?.capabilities).toEqual({
				none: true,
				xhigh: true,
				max: true,
			});
			expect(lookupModelRegistryEntry('gpt-6-luna')?.id).toBe('gpt-6-luna');
			expect(lookupModelRegistryEntry('gpt-6-luna')?.family).toBe('gpt-5.6');
			expect(lookupModelRegistryEntry('gpt-6-luna')?.capabilities).toEqual({
				none: true,
				xhigh: true,
				max: true,
			});
			expect(normalizeModel('gpt-6-sol-xhigh')).toBe('gpt-6-sol');
			expect(normalizeModel('openai/gpt-6-luna-max')).toBe('gpt-6-luna');
		});

		it('never calls fetch when no remote registry URL is configured', () => {
			getModelRegistry();
			lookupModelRegistryEntry('gpt-5.1');
			expect(fetchSpy).not.toHaveBeenCalled();
		});
	});

	describe('normalizeModel / getReasoningConfig / getModelFamily via the registry', () => {
		it('normalizes a registry-known alias without needing the static MODEL_MAP', () => {
			// gpt-5.6-sol is only reachable through the registry fallback path
			// (after the static MODEL_MAP miss), proving the wiring works.
			expect(normalizeModel('gpt-5.6-sol-xhigh')).toBe('gpt-5.6-sol');
		});

		it('derives reasoning capabilities from the registry entry', () => {
			expect(getReasoningConfig('gpt-5.2-codex', { reasoningEffort: 'none' }).effort).toBe('low');
			expect(getReasoningConfig('gpt-5.2', { reasoningEffort: 'none' }).effort).toBe('none');
		});

		it('derives the prompt family from the registry entry', () => {
			expect(getModelFamily('gpt-5.1-codex-mini')).toBe('codex');
			expect(getModelFamily('gpt-5.2-codex')).toBe('gpt-5.2-codex');
		});
	});

	describe('remote overlay (opt-in)', () => {
		it('adds a brand-new model from the remote overlay without any code change', async () => {
			configureModelRegistrySource('https://example.com/model-registry.json');
			fetchSpy.mockResolvedValue({
				ok: true,
				status: 200,
				headers: { get: () => 'W/"etag-1"' },
				json: async () => [
					{
						id: 'gpt-6-astra',
						aliases: ['gpt-6-astra', 'gpt-6'],
						family: 'gpt-5.1',
						capabilities: { none: true, xhigh: true },
						defaultEffort: 'high',
					},
				],
			});

			await __triggerModelRegistryRefreshForTests();

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const entry = lookupModelRegistryEntry('gpt-6-astra');
			expect(entry?.id).toBe('gpt-6-astra');
			expect(normalizeModel('gpt-6')).toBe('gpt-6-astra');
			// Existing bundled models remain available alongside the overlay.
			expect(lookupModelRegistryEntry('gpt-5.1')?.id).toBe('gpt-5.1');
		});

		it('falls back to the bundled registry when the remote fetch fails', async () => {
			configureModelRegistrySource('https://example.com/model-registry.json');
			fetchSpy.mockRejectedValue(new Error('network down'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await __triggerModelRegistryRefreshForTests();

			expect(lookupModelRegistryEntry('gpt-5.1')?.id).toBe('gpt-5.1');
			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});

		it('ignores a malformed remote payload instead of corrupting the registry', async () => {
			configureModelRegistrySource('https://example.com/model-registry.json');
			fetchSpy.mockResolvedValue({
				ok: true,
				status: 200,
				headers: { get: () => null },
				json: async () => ({ not: 'an array' }),
			});

			await __triggerModelRegistryRefreshForTests();

			expect(lookupModelRegistryEntry('gpt-5.1')?.id).toBe('gpt-5.1');
		});

		it('does nothing when no URL is configured', async () => {
			await __triggerModelRegistryRefreshForTests();
			expect(fetchSpy).not.toHaveBeenCalled();
		});
	});
});
