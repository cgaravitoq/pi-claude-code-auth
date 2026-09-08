/**
 * pi-claude-code-auth
 *
 * pi extension that registers an Anthropic provider authenticated with the
 * Claude Code OAuth session that already lives on this machine.
 * No browser login, no API key — pi reads `~/.claude/.credentials.json`
 * (or macOS Keychain) and refreshes the token transparently.
 *
 * Activation:
 *   1. Install with `pi install npm:@cgaravitoq/pi-claude-code-auth`
 *   2. Run `pi`, then `/login claude-code` to materialize credentials into
 *      `~/.pi/agent/auth.json`
 *   3. Pick a model with `/model claude-code/<id>`
 */

import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readClaudeCodeCreds, refreshClaudeCodeCreds } from "@cgaravitoq/claude-code-core";
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
				id: "claude-opus-5",
				name: "Claude Opus 5 (Claude Code)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
				contextWindow: 1000000,
				maxTokens: 128000,
			},
			{
				id: "claude-fable-5-1",
				name: "Claude Fable 5.1 (Claude Code)",
				reasoning: true,
				input: ["text", "image"],
				// Fable 5.1 reads cache at 0.025x base input, not the 0.1x every other model here uses.
				cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
				contextWindow: 1000000,
				maxTokens: 128000,
			},
			{
				id: "claude-opus-4-8",
				name: "Claude Opus 4.8 (Claude Code)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
				contextWindow: 1000000,
				maxTokens: 128000,
			},
			{
				id: "claude-opus-4-7",
				name: "Claude Opus 4.7 (Claude Code)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
				contextWindow: 1000000,
				maxTokens: 128000,
			},
			{
				id: "claude-sonnet-5",
				name: "Claude Sonnet 5 (Claude Code)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
				contextWindow: 1000000,
				maxTokens: 128000,
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
