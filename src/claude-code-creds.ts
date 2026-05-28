/**
 * Read existing Claude Code OAuth credentials from disk / macOS Keychain
 * and refresh them when expired.
 *
 * Sources of truth:
 *   - macOS:  Keychain entries named "Claude Code-credentials[-<suffix>]"
 *   - Linux/Windows: ~/.claude/.credentials.json
 *
 * Refresh strategy:
 *   1. Try POST to https://claude.ai/v1/oauth/token with grant_type=refresh_token
 *   2. On failure, invoke `claude -p . --model haiku` so the Claude CLI
 *      refreshes its own token; then re-read.
 *
 * Ported (and simplified) from griffinmartin/opencode-claude-auth.
 */

import { execSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const OAUTH_TOKEN_URL = "https://claude.ai/v1/oauth/token";
export const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

export interface ClaudeCodeCreds {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}

interface CredentialBlob {
	accessToken?: string;
	refreshToken?: string;
	expiresAt?: number;
	access_token?: string;
	refresh_token?: string;
	expires_at?: number;
}

function parseBlob(raw: string): ClaudeCodeCreds | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	const data =
		(parsed as { claudeAiOauth?: CredentialBlob }).claudeAiOauth ??
		(parsed as CredentialBlob);

	const access = data.accessToken ?? data.access_token;
	const refresh = data.refreshToken ?? data.refresh_token;
	const expires = data.expiresAt ?? data.expires_at;

	if (!access || !refresh || typeof expires !== "number") return null;
	return { accessToken: access, refreshToken: refresh, expiresAt: expires };
}

function readFromKeychain(): ClaudeCodeCreds | null {
	if (process.platform !== "darwin") return null;
	const services = ["Claude Code-credentials"];
	try {
		const dump = execSync('security dump-keychain 2>/dev/null | grep -o \'"Claude Code-credentials[^"]*"\'', {
			encoding: "utf-8",
		});
		const found = Array.from(
			new Set(dump.split("\n").map((s) => s.replace(/"/g, "").trim()).filter(Boolean)),
		);
		if (found.length > 0) services.splice(0, services.length, ...found);
	} catch {
		// fall back to default
	}
	for (const svc of services) {
		try {
			const out = execSync(`security find-generic-password -s ${JSON.stringify(svc)} -w`, {
				encoding: "utf-8",
			}).trim();
			const creds = parseBlob(out);
			if (creds) return creds;
		} catch {
			// try next service
		}
	}
	return null;
}

function getCredentialsFilePath(): string {
	return join(homedir(), ".claude", ".credentials.json");
}

function readFromFile(): ClaudeCodeCreds | null {
	const path = getCredentialsFilePath();
	if (!existsSync(path)) return null;
	try {
		return parseBlob(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

export function readClaudeCodeCreds(): ClaudeCodeCreds | null {
	return readFromKeychain() ?? readFromFile();
}

function writeBackToFile(creds: ClaudeCodeCreds): void {
	const path = getCredentialsFilePath();
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
	let existing: Record<string, unknown> = {};
	if (existsSync(path)) {
		try {
			existing = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
		} catch {
			// overwrite
		}
	}
	const updated = {
		...existing,
		claudeAiOauth: {
			accessToken: creds.accessToken,
			refreshToken: creds.refreshToken,
			expiresAt: creds.expiresAt,
		},
	};
	writeFileSync(path, JSON.stringify(updated, null, 2), { encoding: "utf-8", mode: 0o600 });
	if (process.platform !== "win32") chmodSync(path, 0o600);
}

interface OAuthResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
}

async function refreshViaOAuth(refreshToken: string): Promise<ClaudeCodeCreds | null> {
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		client_id: OAUTH_CLIENT_ID,
		refresh_token: refreshToken,
	});
	const res = await fetch(OAUTH_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});
	if (!res.ok) return null;
	const data = (await res.json()) as OAuthResponse;
	if (!data.access_token) return null;
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token ?? refreshToken,
		expiresAt: Date.now() + (data.expires_in ?? 36_000) * 1000,
	};
}

function refreshViaCli(): void {
	execSync("claude -p . --model haiku", {
		timeout: 60_000,
		encoding: "utf-8",
		env: { ...process.env, TERM: "dumb" },
		stdio: "ignore",
		cwd: tmpdir(),
	});
}

export async function refreshClaudeCodeCreds(current: ClaudeCodeCreds): Promise<ClaudeCodeCreds> {
	if (current.expiresAt > Date.now() + 60_000) return current;

	const oauth = await refreshViaOAuth(current.refreshToken).catch(() => null);
	if (oauth && oauth.expiresAt > Date.now() + 60_000) {
		try {
			writeBackToFile(oauth);
		} catch {
			// non-fatal
		}
		return oauth;
	}

	try {
		refreshViaCli();
	} catch {
		// fall through to read attempt
	}
	const reread = readClaudeCodeCreds();
	if (reread && reread.expiresAt > Date.now() + 60_000) return reread;

	throw new Error(
		"Failed to refresh Claude Code credentials. Run `claude` once to re-authenticate.",
	);
}
