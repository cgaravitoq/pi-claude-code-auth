/**
 * pi-claude-code-auth
 *
 * pi extension that registers an Anthropic provider authenticated with the
 * Claude Code OAuth session that already lives on this machine.
 * No browser login, no API key — pi reads `~/.claude/.credentials.json`
 * (or macOS Keychain) and refreshes the token transparently.
 *
 * Activation:
 *   1. Drop this build into `~/.pi/agent/extensions/`
 *   2. Run `pi`, then `/login claude-code` to materialize credentials into
 *      `~/.pi/agent/auth.json`
 *   3. Pick a model with `/model claude-code/<id>`
 */

import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readClaudeCodeCreds, refreshClaudeCodeCreds } from "./claude-code-creds.ts";
import { streamClaudeCodeAnthropic } from "./anthropic-stream.ts";

const PROVIDER_ID = "claude-code";
const PROVIDER_NAME = "Claude Code (OAuth)";

async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const existing = readClaudeCodeCreds();
	if (existing) {
		const fresh = await refreshClaudeCodeCreds(existing);
		return {
			access: fresh.accessToken,
			refresh: fresh.refreshToken,
			expires: fresh.expiresAt,
		};
	}
	await callbacks.onPrompt({
		message:
			"No Claude Code credentials found. Run `claude` once to log in, then re-run `/login claude-code`. Press Enter to abort.",
	});
	throw new Error(
		"Claude Code credentials not found. Run `claude` to authenticate first.",
	);
}

async function refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	const fresh = await refreshClaudeCodeCreds({
		accessToken: credentials.access,
		refreshToken: credentials.refresh,
		expiresAt: credentials.expires,
	});
	return {
		access: fresh.accessToken,
		refresh: fresh.refreshToken,
		expires: fresh.expiresAt,
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider(PROVIDER_ID, {
		name: PROVIDER_NAME,
		baseUrl: "https://api.anthropic.com",
		api: "anthropic-messages",
		models: [
			{
				id: "claude-opus-4-8",
				name: "Claude Opus 4.8 (Claude Code)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
				contextWindow: 200000,
				maxTokens: 64000,
			},
			{
				id: "claude-opus-4-7",
				name: "Claude Opus 4.7 (Claude Code)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
				contextWindow: 200000,
				maxTokens: 64000,
			},
			{
				id: "claude-sonnet-4-6",
				name: "Claude Sonnet 4.6 (Claude Code)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
				contextWindow: 200000,
				maxTokens: 64000,
			},
			{
				id: "claude-haiku-4-5",
				name: "Claude Haiku 4.5 (Claude Code)",
				reasoning: false,
				input: ["text", "image"],
				cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
				contextWindow: 200000,
				maxTokens: 64000,
			},
		],
		oauth: {
			name: PROVIDER_NAME,
			login,
			refreshToken,
			getApiKey: (cred) => cred.access,
		},
		streamSimple: streamClaudeCodeAnthropic,
	});
}
