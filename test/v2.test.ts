import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionHttpRequest, SessionHttpResponse } from '@opencode/plugin/promise/session';

const mocks = vi.hoisted(() => ({
	credentials: null as { access: string; refresh: string; expires: number; accountId?: string } | null,
	legacyCredentials: null as { access: string; refresh: string; expires: number } | null,
	savedCredentials: [] as unknown[],
	refreshResult: { type: 'success', access: 'new-access', refresh: 'new-refresh', expires: Date.now() + 3600_000 } as
		| { type: 'success'; access: string; refresh: string; expires: number }
		| { type: 'failed' },
}));

vi.mock('../lib/auth/v2-storage.js', () => ({
	loadV2Credentials: vi.fn(() => mocks.credentials),
	importLegacyV1Credentials: vi.fn(() => mocks.legacyCredentials),
	saveV2Credentials: vi.fn((creds: unknown) => {
		mocks.savedCredentials.push(creds);
	}),
}));

vi.mock('../lib/auth/auth.js', async () => {
	const actual = await vi.importActual<typeof import('../lib/auth/auth.js')>('../lib/auth/auth.js');
	return {
		...actual,
		refreshAccessToken: vi.fn(async () => mocks.refreshResult),
		decodeJWT: vi.fn((token: string) => {
			if (token === 'bad-token') return null;
			return { 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_from_jwt' } };
		}),
	};
});

vi.mock('../lib/request/fetch-helpers.js', async () => {
	const actual = await vi.importActual<typeof import('../lib/request/fetch-helpers.js')>(
		'../lib/request/fetch-helpers.js',
	);
	return {
		...actual,
		transformRequestForCodex: vi.fn(async (init: RequestInit) => {
			const body = JSON.parse(init.body as string);
			return { body: { ...body, model: 'gpt-6-sol' }, updatedInit: init };
		}),
		handleSuccessResponse: vi.fn(async (response: Response) => response),
		handleErrorResponse: vi.fn(async (response: Response) => response),
	};
});

vi.mock('../lib/config.js', () => ({
	loadPluginConfig: vi.fn(() => ({ codexMode: true })),
	getCodexMode: vi.fn(() => true),
}));

vi.mock('../lib/request/helpers/model-registry.js', () => ({
	configureModelRegistrySource: vi.fn(),
}));

import { createV2Hooks } from '../v2.js';
import {
	importLegacyV1Credentials,
	loadV2Credentials,
	saveV2Credentials,
} from '../lib/auth/v2-storage.js';
import { refreshAccessToken } from '../lib/auth/auth.js';
import { transformRequestForCodex, handleErrorResponse, handleSuccessResponse } from '../lib/request/fetch-helpers.js';

const model = { providerID: 'openai', id: 'gpt-6-sol' } as SessionHttpRequest['model'];

function makeRequestEvent(body: object, url = 'https://api.openai.com/v1/responses'): SessionHttpRequest {
	return {
		sessionID: 'session-one',
		agent: 'build',
		kind: 'primary',
		model,
		request: new Request(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}),
	} as SessionHttpRequest;
}

function makeResponseEvent(request: Request, response: Response, sessionID = 'session-one'): SessionHttpResponse {
	return { sessionID, agent: 'build', kind: 'primary', model, request, response } as SessionHttpResponse;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.credentials = { access: 'access-token', refresh: 'refresh-token', expires: Date.now() + 3_600_000 };
	mocks.legacyCredentials = null;
	mocks.savedCredentials = [];
	mocks.refreshResult = { type: 'success', access: 'new-access', refresh: 'new-refresh', expires: Date.now() + 3_600_000 };
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('OpenCode 2 native HTTP hooks (createV2Hooks)', () => {
	describe('request()', () => {
		it('ignores non-Responses-API requests entirely', async () => {
			const hooks = createV2Hooks();
			const event = makeRequestEvent({ foo: 'bar' }, 'https://api.openai.com/v1/models');
			const original = event.request;

			await hooks.request(event);

			expect(event.request).toBe(original);
			expect(transformRequestForCodex).not.toHaveBeenCalled();
		});

		it('rewrites the URL to the Codex backend for a matching request', async () => {
			const hooks = createV2Hooks();
			const event = makeRequestEvent({ model: 'gpt-6-sol', input: [] });

			await hooks.request(event);

			expect(event.request.url).toBe('https://api.openai.com/v1/codex/responses');
		});

		it('sets Codex headers: Authorization, chatgpt-account-id, OpenAI-Beta, originator', async () => {
			const hooks = createV2Hooks();
			const event = makeRequestEvent({ model: 'gpt-6-sol', input: [] });

			await hooks.request(event);

			expect(event.request.headers.get('authorization')).toBe('Bearer access-token');
			expect(event.request.headers.get('chatgpt-account-id')).toBe('acct_from_jwt');
			expect(event.request.headers.get('openai-beta')).toBe('responses=experimental');
			expect(event.request.headers.get('originator')).toBe('codex_cli_rs');
		});

		it('transforms the body through transformRequestForCodex', async () => {
			const hooks = createV2Hooks();
			const event = makeRequestEvent({ model: 'gpt-5-codex', input: [] });

			await hooks.request(event);

			expect(transformRequestForCodex).toHaveBeenCalled();
			const sentBody = JSON.parse(await event.request.clone().text());
			expect(sentBody.model).toBe('gpt-6-sol');
		});

		it('throws a clear error when no credentials are available anywhere', async () => {
			mocks.credentials = null;
			mocks.legacyCredentials = null;
			const hooks = createV2Hooks();
			const event = makeRequestEvent({ model: 'gpt-6-sol', input: [] });

			await expect(hooks.request(event)).rejects.toThrow(/No ChatGPT\/Codex credentials/);
		});

		it('falls back to importing legacy V1 credentials when this plugin has none saved yet', async () => {
			mocks.credentials = null;
			mocks.legacyCredentials = { access: 'legacy-access', refresh: 'legacy-refresh', expires: Date.now() + 3_600_000 };
			const hooks = createV2Hooks();
			const event = makeRequestEvent({ model: 'gpt-6-sol', input: [] });

			await hooks.request(event);

			expect(importLegacyV1Credentials).toHaveBeenCalled();
			expect(event.request.headers.get('authorization')).toBe('Bearer legacy-access');
		});

		it('proactively refreshes credentials that are near expiry', async () => {
			mocks.credentials = { access: 'stale-access', refresh: 'refresh-token', expires: Date.now() + 1_000 };
			const hooks = createV2Hooks();
			const event = makeRequestEvent({ model: 'gpt-6-sol', input: [] });

			await hooks.request(event);

			expect(refreshAccessToken).toHaveBeenCalledWith('refresh-token');
			expect(saveV2Credentials).toHaveBeenCalled();
			expect(event.request.headers.get('authorization')).toBe('Bearer new-access');
		});

		it('throws when a near-expiry refresh fails, instead of sending a request doomed to 401', async () => {
			mocks.credentials = { access: 'stale-access', refresh: 'refresh-token', expires: Date.now() + 1_000 };
			mocks.refreshResult = { type: 'failed' };
			const hooks = createV2Hooks();
			const event = makeRequestEvent({ model: 'gpt-6-sol', input: [] });

			await expect(hooks.request(event)).rejects.toThrow();
		});

		it('extracts accountId from the JWT and caches it across calls (does not re-decode every request)', async () => {
			const { decodeJWT } = await import('../lib/auth/auth.js');
			const hooks = createV2Hooks();
			await hooks.request(makeRequestEvent({ model: 'gpt-6-sol', input: [] }));
			await hooks.request(makeRequestEvent({ model: 'gpt-6-sol', input: [] }));

			expect(decodeJWT).toHaveBeenCalledTimes(1);
		});
	});

	describe('response()', () => {
		it('ignores responses whose request never went to the Codex backend', async () => {
			const hooks = createV2Hooks();
			const request = new Request('https://api.openai.com/v1/models');
			const response = new Response('{}', { status: 200 });
			const event = makeResponseEvent(request, response);

			await hooks.response(event);

			expect(event.response).toBe(response);
			expect(handleSuccessResponse).not.toHaveBeenCalled();
			expect(handleErrorResponse).not.toHaveBeenCalled();
		});

		it('routes a successful Codex response through handleSuccessResponse with the streaming flag from request()', async () => {
			const hooks = createV2Hooks();
			const reqEvent = makeRequestEvent({ model: 'gpt-6-sol', input: [], stream: true });
			await hooks.request(reqEvent);

			const response = new Response('{}', { status: 200 });
			const respEvent = makeResponseEvent(reqEvent.request, response);
			await hooks.response(respEvent);

			expect(handleSuccessResponse).toHaveBeenCalledWith(response, true);
			expect(handleErrorResponse).not.toHaveBeenCalled();
		});

		it('routes a failed Codex response through handleErrorResponse', async () => {
			const hooks = createV2Hooks();
			const reqEvent = makeRequestEvent({ model: 'gpt-6-sol', input: [] });
			await hooks.request(reqEvent);

			const response = new Response('{"error":"boom"}', { status: 400 });
			const respEvent = makeResponseEvent(reqEvent.request, response);
			await hooks.response(respEvent);

			expect(handleErrorResponse).toHaveBeenCalledWith(response);
			expect(handleSuccessResponse).not.toHaveBeenCalled();
		});

		it('cleans up per-session streaming state after the response is handled', async () => {
			const hooks = createV2Hooks();
			const reqEvent = makeRequestEvent({ model: 'gpt-6-sol', input: [] });
			await hooks.request(reqEvent);
			const response = new Response('{}', { status: 200 });
			await hooks.response(makeResponseEvent(reqEvent.request, response));

			// A second response for the same sessionID with no matching request()
			// call must not resurrect stale streaming state (defaults to false).
			const secondResponse = new Response('{}', { status: 200 });
			await hooks.response(makeResponseEvent(reqEvent.request, secondResponse));
			expect(handleSuccessResponse).toHaveBeenLastCalledWith(secondResponse, false);
		});
	});
});
