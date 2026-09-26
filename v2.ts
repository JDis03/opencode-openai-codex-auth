/**
 * OpenCode 2 native plugin entrypoint.
 *
 * V1 plugin implementations (a bare async function default export) do not
 * run under OpenCode 2 at all — the loader rejects them with a SchemaError
 * before any of their code runs. This file is a from-scratch V2 port that
 * reuses every existing business-logic module under lib/ unchanged (model
 * normalization, Codex instructions, CODEX_MODE bridge, skill-catalog
 * passthrough, SSE→JSON conversion, etc.) behind V2's native `http.request`
 * / `http.response` session hooks instead of a custom `fetch` override.
 *
 * The V1 entrypoint remains available unchanged at "./legacy" for users
 * still running OpenCode 1 (see package.json's dual "exports").
 *
 * See specs/opencode-v2-plugin-port.md for the root-cause investigation
 * (confirmed empirically against a real OpenCode 2.0.15 instance) and
 * design rationale behind every choice below.
 */

import { Plugin, type Credential } from "@opencode/plugin";
import type {
	SessionHttpRequest,
	SessionHttpResponse,
} from "@opencode/plugin/promise/session";
import {
	createAuthorizationFlow,
	decodeJWT,
	exchangeAuthorizationCode,
	parseAuthorizationInput,
	refreshAccessToken,
} from "./lib/auth/auth.js";
import { openBrowserUrl } from "./lib/auth/browser.js";
import { startLocalOAuthServer } from "./lib/auth/server.js";
import {
	importLegacyV1Credentials,
	loadV2Credentials,
	saveV2Credentials,
	type V2Credentials,
} from "./lib/auth/v2-storage.js";
import { getCodexMode, loadPluginConfig } from "./lib/config.js";
import { configureModelRegistrySource } from "./lib/request/helpers/model-registry.js";
import {
	AUTH_LABELS,
	CODEX_BASE_URL,
	JWT_CLAIM_PATH,
	URL_PATHS,
} from "./lib/constants.js";
import { logDebug } from "./lib/logger.js";
import {
	createCodexHeaders,
	handleErrorResponse,
	handleSuccessResponse,
	rewriteUrlForCodex,
	transformRequestForCodex,
} from "./lib/request/fetch-helpers.js";
import type { UserConfig } from "./lib/types.js";

/** Distinct from OpenCode's own built-in "chatgpt-browser"/"chatgpt-headless" methods. */
const METHOD_ID = "codex-auth";
const INTEGRATION_ID = "openai";

/**
 * Matches an outgoing OpenAI Responses API request before Codex-backend URL
 * rewriting. Mirrors the intent of the V1 fetch()'s URL_PATHS.RESPONSES
 * check, and (like dark-auth's anthropicMessages() helper) guards every
 * hook against firing for unrelated "openai" traffic.
 */
function isResponsesRequest(request: Request): boolean {
	try {
		const url = new URL(request.url);
		return (
			request.method === "POST" &&
			url.pathname.includes(URL_PATHS.RESPONSES)
		);
	} catch {
		return false;
	}
}

/** Build guidance from this request's real V2 tool names, not the V1 tool list. */
export function v2ToolBridge(tools: unknown): string {
	const names = Array.isArray(tools)
		? tools.map((tool) => tool?.name).filter((name): name is string => typeof name === "string")
		: [];
	return [
		"# Codex running in OpenCode 2",
		`Available tools for this request: ${names.join(", ") || "none"}.`,
		"Use only tools actually supplied in this request; follow their schemas rather than remembered Codex CLI or OpenCode 1 tool names.",
		...(names.includes("patch") ? ["For file changes use the patch tool; do not call write, edit, or apply_patch unless separately supplied."] : []),
		...(names.includes("shell") ? ["For commands use the shell tool; do not call bash unless separately supplied."] : []),
		"Check the available skills catalog for a matching skill before non-trivial work. MCP tools and subagents may be available through the provided tool schemas.",
	].join("\n");
}

function toOAuthCredential(creds: V2Credentials): Credential.OAuth {
	return {
		type: "oauth",
		methodID: METHOD_ID as Credential.OAuth["methodID"],
		access: creds.access,
		refresh: creds.refresh,
		expires: creds.expires,
	};
}

/**
 * Exported separately so hook wiring can be exercised in tests without a
 * live OpenCode 2 host (same pattern as dark-auth's createV2Hooks()).
 */
export function createV2Hooks() {
	// Per-session streaming flag, set in the request hook and consumed once
	// by the matching response hook. Request bodies are one-shot streams, so
	// this is cheaper than re-reading event.request in the response hook.
	const streamingBySession = new Map<string, boolean>();

	let cachedCredentials: V2Credentials | null = null;
	let cachedAccountId: string | undefined;
	let refreshPromise: Promise<V2Credentials | null> | null = null;

	function getCredentials(): V2Credentials | null {
		if (cachedCredentials) return cachedCredentials;
		cachedCredentials = loadV2Credentials() ?? importLegacyV1Credentials();
		return cachedCredentials;
	}

	function accountIdFor(creds: V2Credentials): string | undefined {
		if (creds.accountId) return creds.accountId;
		if (cachedAccountId) return cachedAccountId;
		const decoded = decodeJWT(creds.access);
		const accountId = decoded?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
		if (accountId) cachedAccountId = accountId;
		return accountId;
	}

	async function ensureFreshCredentials(): Promise<V2Credentials | null> {
		const current = getCredentials();
		if (!current) return null;
		if (current.expires > Date.now() + 60_000) return current;

		if (!refreshPromise) {
			refreshPromise = (async () => {
				const result = await refreshAccessToken(current.refresh);
				if (result.type !== "success") return null;
				const updated: V2Credentials = {
					access: result.access,
					refresh: result.refresh,
					expires: result.expires,
					accountId: cachedAccountId,
				};
				cachedCredentials = updated;
				saveV2Credentials(updated);
				return updated;
			})().finally(() => {
				refreshPromise = null;
			});
		}
		return refreshPromise;
	}

	const pluginConfig = loadPluginConfig();
	const codexMode = getCodexMode(pluginConfig);
	configureModelRegistrySource(pluginConfig.modelRegistryUrl);
	const userConfig: UserConfig = { global: {}, models: {} };

	async function request(event: SessionHttpRequest): Promise<void> {
		if (!isResponsesRequest(event.request)) return;

		const credentials = await ensureFreshCredentials();
		if (!credentials) {
			throw new Error(
				"[openai-codex-plugin] No ChatGPT/Codex credentials found. Authenticate via the 'ChatGPT Plus/Pro (Codex Auth)' method first.",
			);
		}
		const accountId = accountIdFor(credentials);
		if (!accountId) {
			throw new Error(
				"[openai-codex-plugin] Failed to extract accountId from token.",
			);
		}

		const original = event.request;
		const originalBody = original.body ? await original.clone().text() : "";
		const parsedBody = originalBody ? JSON.parse(originalBody) : {};
		const isStreaming = parsedBody.stream === true;
		streamingBySession.set(event.sessionID, isStreaming);

		const url = rewriteUrlForCodex(original.url);
		const transformation = await transformRequestForCodex(
			{ body: originalBody },
			url,
			userConfig,
			codexMode,
			v2ToolBridge(parsedBody.tools),
		);
		const transformedBody = transformation?.body;
		const finalBody = transformedBody
			? JSON.stringify(transformedBody)
			: originalBody;

		const headers = createCodexHeaders(
			{ headers: original.headers },
			accountId,
			credentials.access,
			{
				model: transformedBody?.model,
				promptCacheKey: (transformedBody as { prompt_cache_key?: string } | undefined)
					?.prompt_cache_key,
			},
		);

		event.request = new Request(url, {
			method: original.method,
			headers,
			body: finalBody,
			signal: original.signal,
			redirect: original.redirect,
		});
	}

	async function response(event: SessionHttpResponse): Promise<void> {
		if (!event.request.url.includes(URL_PATHS.CODEX_RESPONSES)) return;

		const isStreaming = streamingBySession.get(event.sessionID) ?? false;
		streamingBySession.delete(event.sessionID);

		event.response = event.response.ok
			? await handleSuccessResponse(event.response, isStreaming)
			: await handleErrorResponse(event.response);
	}

	return { request, response, getCredentials, ensureFreshCredentials };
}

export default Plugin.define({
	id: "opencode-openai-codex-auth",
	async setup(ctx) {
		const hooks = createV2Hooks();

		await ctx.session.hook("http.request", hooks.request, {
			providerID: INTEGRATION_ID,
		});
		await ctx.session.hook("http.response", hooks.response, {
			providerID: INTEGRATION_ID,
		});

		// V2's integration method can own new logins; there is no public API
		// to import an existing OAuth credential into its connection store at
		// setup (same limitation documented by dark-auth for Anthropic). This
		// plugin's own file-based store (lib/auth/v2-storage.ts) is what the
		// http.request hook above actually reads from, independent of which
		// method OpenCode 2 shows as "active" for the integration — but the
		// user must still complete THIS method once so OpenCode 2 treats
		// "openai" as connected and routes model requests through it.
		await ctx.integration.transform((editor) => {
			if (!editor.get(INTEGRATION_ID)) return;
			editor.method.update({
				integrationID: INTEGRATION_ID,
				method: {
					id: METHOD_ID,
					type: "oauth",
					label: AUTH_LABELS.OAUTH_V2,
				},
				authorize: async () => {
					const { pkce, state, url } = await createAuthorizationFlow();
					const serverInfo = await startLocalOAuthServer({ state });

					if (!serverInfo.ready) {
						return {
							url,
							instructions: AUTH_LABELS.INSTRUCTIONS_MANUAL,
							mode: "code" as const,
							callback: async (code: string) => {
								const parsed = parseAuthorizationInput(code);
								if (!parsed.code) throw new Error("[openai-codex-plugin] Missing authorization code");
								const tokens = await exchangeAuthorizationCode(parsed.code, pkce.verifier);
								if (tokens.type !== "success") {
									throw new Error("[openai-codex-plugin] OAuth exchange failed");
								}
								const creds: V2Credentials = {
									access: tokens.access,
									refresh: tokens.refresh,
									expires: tokens.expires,
								};
								saveV2Credentials(creds);
								return toOAuthCredential(creds);
							},
						};
					}

					openBrowserUrl(url);

					const callback = (async () => {
						const result = await serverInfo.waitForCode(state);
						serverInfo.close();
						if (!result) throw new Error("[openai-codex-plugin] OAuth callback timed out");
						const tokens = await exchangeAuthorizationCode(result.code, pkce.verifier);
						if (tokens.type !== "success") {
							throw new Error("[openai-codex-plugin] OAuth exchange failed");
						}
						const creds: V2Credentials = {
							access: tokens.access,
							refresh: tokens.refresh,
							expires: tokens.expires,
						};
						saveV2Credentials(creds);
						return toOAuthCredential(creds);
					})();

					return {
						url,
						instructions: AUTH_LABELS.INSTRUCTIONS,
						mode: "auto" as const,
						callback,
					};
				},
				refresh: async (credential) => {
					const result = await refreshAccessToken(credential.refresh);
					if (result.type !== "success") {
						throw new Error("[openai-codex-plugin] OAuth refresh failed");
					}
					const creds: V2Credentials = {
						access: result.access,
						refresh: result.refresh,
						expires: result.expires,
					};
					saveV2Credentials(creds);
					return toOAuthCredential(creds);
				},
			});
		});

		logDebug("[openai-codex-plugin] V2 plugin setup complete");
	},
});
