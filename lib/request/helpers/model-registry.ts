/**
 * Model Registry — lookup, merging, and optional remote overlay
 *
 * Consumers (normalizeModel, getReasoningConfig, getModelFamily) call
 * `lookupModelRegistryEntry()` synchronously. The registry itself is always
 * available synchronously (bundled defaults + last-persisted remote overlay,
 * both loaded once at module init); a remote refresh — when configured — runs
 * in the background and updates the in-memory copy for *future* lookups. This
 * means a request is never delayed or blocked by a network call.
 *
 * The remote overlay is entirely OPT-IN: unless a maintainer or user
 * explicitly configures `modelRegistryUrl` (plugin config) or the
 * `OPENCODE_CODEX_MODEL_REGISTRY_URL` env var, no network request is ever
 * made. This keeps the default (and every existing test) fully offline.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	BUNDLED_MODEL_REGISTRY,
	type ModelRegistryEntry,
} from "./model-registry-data.js";

const CACHE_DIR = join(homedir(), ".opencode", "cache");
const CACHE_FILE = join(CACHE_DIR, "model-registry-overlay.json");
const CACHE_META_FILE = join(CACHE_DIR, "model-registry-overlay-meta.json");
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes, matches lib/prompts/codex.ts

interface OverlayCacheMeta {
	etag: string | null;
	lastChecked: number;
	url: string;
}

/** Set once (per process) by index.ts from the loaded plugin config. */
let configuredUrl: string | undefined;

/** In-memory registry: bundled defaults merged with the last-known overlay. */
let activeRegistry: ModelRegistryEntry[] = BUNDLED_MODEL_REGISTRY;
let aliasIndex: Map<string, ModelRegistryEntry> = buildAliasIndex(activeRegistry);
let refreshInFlight = false;

function buildAliasIndex(
	registry: ModelRegistryEntry[],
): Map<string, ModelRegistryEntry> {
	const index = new Map<string, ModelRegistryEntry>();
	for (const entry of registry) {
		for (const alias of entry.aliases) {
			index.set(alias.toLowerCase(), entry);
		}
	}
	return index;
}

/**
 * Merge a remote overlay into the bundled defaults.
 * Overlay entries take precedence for any alias they also define, so a
 * maintainer can both add brand-new models and patch an existing one.
 */
function mergeRegistries(
	bundled: ModelRegistryEntry[],
	overlay: ModelRegistryEntry[],
): ModelRegistryEntry[] {
	if (overlay.length === 0) return bundled;
	const overlayAliases = new Set(
		overlay.flatMap((entry) => entry.aliases.map((a) => a.toLowerCase())),
	);
	const remainingBundled = bundled.filter(
		(entry) => !entry.aliases.some((a) => overlayAliases.has(a.toLowerCase())),
	);
	return [...overlay, ...remainingBundled];
}

function isValidRegistryEntry(value: unknown): value is ModelRegistryEntry {
	if (!value || typeof value !== "object") return false;
	const entry = value as Partial<ModelRegistryEntry>;
	return (
		typeof entry.id === "string" &&
		Array.isArray(entry.aliases) &&
		entry.aliases.every((a) => typeof a === "string") &&
		typeof entry.family === "string" &&
		typeof entry.defaultEffort === "string"
	);
}

function loadCachedOverlaySync(): ModelRegistryEntry[] {
	try {
		if (!existsSync(CACHE_FILE)) return [];
		const parsed = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isValidRegistryEntry);
	} catch {
		return [];
	}
}

function loadCachedMetaSync(): OverlayCacheMeta | null {
	try {
		if (!existsSync(CACHE_META_FILE)) return null;
		return JSON.parse(readFileSync(CACHE_META_FILE, "utf8")) as OverlayCacheMeta;
	} catch {
		return null;
	}
}

// Initialize from any previously-cached overlay so a restarted process picks
// up the last successful remote fetch immediately, without waiting on a
// network round-trip.
{
	const cachedOverlay = loadCachedOverlaySync();
	if (cachedOverlay.length > 0) {
		activeRegistry = mergeRegistries(BUNDLED_MODEL_REGISTRY, cachedOverlay);
		aliasIndex = buildAliasIndex(activeRegistry);
	}
}

/**
 * Configure the remote overlay source. Called once by index.ts from the
 * loaded plugin config. Pass `undefined`/empty to disable.
 */
export function configureModelRegistrySource(url: string | undefined): void {
	configuredUrl = url?.trim() || undefined;
}

function getConfiguredRegistryUrl(): string | undefined {
	return process.env.OPENCODE_CODEX_MODEL_REGISTRY_URL?.trim() || configuredUrl;
}

/**
 * Fetch the remote overlay JSON with ETag-based conditional requests,
 * mirroring the caching strategy in lib/prompts/codex.ts. Never throws —
 * all failures are swallowed since this only ever refines an already-usable
 * in-memory registry.
 */
async function fetchRemoteOverlay(url: string): Promise<ModelRegistryEntry[] | null> {
	const meta = loadCachedMetaSync();
	const headers: Record<string, string> = {};
	if (meta?.url === url && meta.etag) {
		headers["If-None-Match"] = meta.etag;
	}

	const response = await fetch(url, { headers });

	if (response.status === 304) {
		return null; // Unchanged; nothing new to merge.
	}

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}

	const data = (await response.json()) as unknown;
	const entries = Array.isArray(data) ? data.filter(isValidRegistryEntry) : [];

	if (!existsSync(CACHE_DIR)) {
		mkdirSync(CACHE_DIR, { recursive: true });
	}
	writeFileSync(CACHE_FILE, JSON.stringify(entries), "utf8");
	writeFileSync(
		CACHE_META_FILE,
		JSON.stringify({
			etag: response.headers.get("etag"),
			lastChecked: Date.now(),
			url,
		} satisfies OverlayCacheMeta),
		"utf8",
	);

	return entries;
}

async function performRefresh(url: string): Promise<void> {
	refreshInFlight = true;
	try {
		const entries = await fetchRemoteOverlay(url);
		if (entries && entries.length > 0) {
			activeRegistry = mergeRegistries(BUNDLED_MODEL_REGISTRY, entries);
			aliasIndex = buildAliasIndex(activeRegistry);
		}
	} catch (error) {
		console.error(
			"[openai-codex-plugin] Failed to refresh remote model registry:",
			(error as Error).message,
		);
	} finally {
		refreshInFlight = false;
	}
}

/**
 * Kick off a background refresh if a remote source is configured and the
 * cache is stale. Fire-and-forget: never awaited by request handling, so it
 * can never slow down or fail a live request. Results apply to subsequent
 * lookups only.
 */
function maybeTriggerBackgroundRefresh(): void {
	const url = getConfiguredRegistryUrl();
	if (!url || refreshInFlight) return;

	const meta = loadCachedMetaSync();
	if (meta?.url === url && Date.now() - meta.lastChecked < CACHE_TTL_MS) {
		return; // Cache is fresh enough; don't spam the network.
	}

	void performRefresh(url);
}

/**
 * Test-only: deterministically run (and await) a refresh attempt against the
 * currently configured URL, bypassing the fire-and-forget wrapper. No-op
 * (resolves immediately) if no URL is configured.
 */
export async function __triggerModelRegistryRefreshForTests(): Promise<void> {
	const url = getConfiguredRegistryUrl();
	if (!url) return;
	await performRefresh(url);
}

/**
 * Get the current model registry (bundled defaults + any merged overlay).
 * Synchronous — safe to call from hot request-handling paths.
 */
export function getModelRegistry(): ModelRegistryEntry[] {
	maybeTriggerBackgroundRefresh();
	return activeRegistry;
}

/**
 * Look up a model id or preset name in the registry, case-insensitively.
 * Returns undefined if nothing matches (callers should fall back to their
 * own generic pattern matching for completely unrecognized names).
 */
export function lookupModelRegistryEntry(
	modelId: string | undefined,
): ModelRegistryEntry | undefined {
	if (!modelId) return undefined;
	maybeTriggerBackgroundRefresh();
	return aliasIndex.get(modelId.toLowerCase());
}

/**
 * Test-only: reset in-memory state and force a specific configured URL.
 * Not exported from the package's public surface.
 */
export function __resetModelRegistryForTests(): void {
	configuredUrl = undefined;
	refreshInFlight = false;
	activeRegistry = BUNDLED_MODEL_REGISTRY;
	aliasIndex = buildAliasIndex(activeRegistry);
}

export type { ModelRegistryEntry } from "./model-registry-data.js";
