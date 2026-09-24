/**
 * OpenCode 2 credential storage.
 *
 * V2's plugin API has no public way to import an existing OAuth credential
 * into its own integration connection store (see dark-auth's README for the
 * same limitation on the Anthropic side). This plugin therefore keeps its
 * own small, single-account, file-based credential store — analogous to
 * V1's reliance on opencode's ~/.local/share/opencode/auth.json, but scoped
 * to this plugin so it works independently of whichever OAuth method V2
 * shows as "active" for the openai integration.
 *
 * On first use (empty store), it best-effort imports the legacy V1
 * credential from opencode's own auth.json as a read-only convenience for
 * existing users — this only pre-fills the plugin's OWN store; it does not
 * touch auth.json and cannot make V2 treat that credential as "active" for
 * the integration (the user must still complete this plugin's OAuth method
 * once to establish an active openai connection in V2).
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface V2Credentials {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
}

const STORAGE_DIR = join(homedir(), ".opencode");
const STORAGE_PATH = join(STORAGE_DIR, "openai-codex-v2-credentials.json");
const LEGACY_AUTH_JSON_PATH = join(
	homedir(),
	".local",
	"share",
	"opencode",
	"auth.json",
);

function isValidCredentials(value: unknown): value is V2Credentials {
	if (!value || typeof value !== "object") return false;
	const v = value as Partial<V2Credentials>;
	return (
		typeof v.access === "string" &&
		typeof v.refresh === "string" &&
		typeof v.expires === "number"
	);
}

/** Read this plugin's own stored credentials, or null if none saved yet. */
export function loadV2Credentials(): V2Credentials | null {
	try {
		if (!existsSync(STORAGE_PATH)) return null;
		const parsed = JSON.parse(readFileSync(STORAGE_PATH, "utf8"));
		return isValidCredentials(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** Atomically persist this plugin's credentials (temp file + rename). */
export function saveV2Credentials(credentials: V2Credentials): void {
	if (!existsSync(STORAGE_DIR)) {
		mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o700 });
	}
	const tempPath = `${STORAGE_PATH}.${process.pid}.${Date.now()}.tmp`;
	const content = `${JSON.stringify(credentials, null, 2)}\n`;
	writeFileSync(tempPath, content, { encoding: "utf8", mode: 0o600 });
	renameSync(tempPath, STORAGE_PATH);
}

/**
 * Best-effort, read-only import of the legacy V1 "openai" OAuth credential
 * from opencode's own auth.json. Never throws; returns null on any failure
 * or if no valid OAuth credential is present.
 */
export function importLegacyV1Credentials(): V2Credentials | null {
	try {
		if (!existsSync(LEGACY_AUTH_JSON_PATH)) return null;
		const parsed = JSON.parse(readFileSync(LEGACY_AUTH_JSON_PATH, "utf8")) as {
			openai?: {
				type?: string;
				access?: string;
				refresh?: string;
				expires?: number;
			};
		};
		const openai = parsed.openai;
		if (
			!openai ||
			openai.type !== "oauth" ||
			typeof openai.access !== "string" ||
			typeof openai.refresh !== "string" ||
			typeof openai.expires !== "number"
		) {
			return null;
		}
		return { access: openai.access, refresh: openai.refresh, expires: openai.expires };
	} catch {
		return null;
	}
}
