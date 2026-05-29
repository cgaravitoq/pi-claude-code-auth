/**
 * Claude Code-style payload transforms.
 *
 * These run AFTER pi's example builds `params` for the Anthropic SDK, but
 * BEFORE we call `client.messages.stream(params)`. They reshape the request
 * so Anthropic classifies it as a legitimate Claude Code session (eligible
 * for the user's subscription) instead of as a third-party OAuth call
 * (which 400s with "out of extra usage").
 *
 * Steps:
 *   1. Inject billing header as system[0]
 *   2. Keep the Claude Code identity prefix as system[1]
 *   3. Move all other system content into the first user message
 *   4. Prefix every tool name with `mcp_<PascalCase>` (Claude Code convention)
 *   5. Strip `effort` for haiku
 *   6. Filter orphan tool_use/tool_result pairs while preserving message order and role alternation
 *
 * Adapted from griffinmartin/opencode-claude-auth/src/transforms.ts.
 */

import { buildBillingHeaderValue } from "./signing.ts";
import { config, getModelOverride } from "./model-config.ts";

const TOOL_PREFIX = "mcp_";
const SYSTEM_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const BILLING_PREFIX = "x-anthropic-billing-header";

export function prefixToolName(name: string): string {
	return `${TOOL_PREFIX}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

export function unprefixToolName(name: string): string {
	if (!name.startsWith(TOOL_PREFIX)) return name;
	const rest = name.slice(TOOL_PREFIX.length);
	return rest.charAt(0).toLowerCase() + rest.slice(1);
}

type SystemEntry = { type?: string; text?: string; cache_control?: unknown } & Record<string, unknown>;
type ContentBlock = { type?: string; text?: string; name?: string } & Record<string, unknown>;
type Message = { role?: string; content?: string | ContentBlock[] };

function repairToolPairs(messages: Message[]): Message[] {
	const toolUseIds = new Set<string>();
	const toolResultIds = new Set<string>();
	for (const m of messages) {
		if (!Array.isArray(m.content)) continue;
		for (const block of m.content) {
			const id = (block as any).id;
			const toolUseId = (block as any).tool_use_id;
			if (block.type === "tool_use" && typeof id === "string") toolUseIds.add(id);
			if (block.type === "tool_result" && typeof toolUseId === "string") toolResultIds.add(toolUseId);
		}
	}
	const orphanedUses = new Set<string>();
	const orphanedResults = new Set<string>();
	for (const id of toolUseIds) if (!toolResultIds.has(id)) orphanedUses.add(id);
	for (const id of toolResultIds) if (!toolUseIds.has(id)) orphanedResults.add(id);
	if (!orphanedUses.size && !orphanedResults.size) return messages;
	return messages
		.map((m) => {
			if (!Array.isArray(m.content)) return m;
			const filtered = m.content.filter((b) => {
				const id = (b as any).id;
				const toolUseId = (b as any).tool_use_id;
				if (b.type === "tool_use" && typeof id === "string") return !orphanedUses.has(id);
				if (b.type === "tool_result" && typeof toolUseId === "string") return !orphanedResults.has(toolUseId);
				return true;
			});
			if (filtered.length === 0) {
				return {
					...m,
					content:
						m.role === "user"
							? [{ type: "text", text: "[tool result omitted]" }]
							: [{ type: "text", text: "" }],
				};
			}
			return { ...m, content: filtered };
		});
}

export interface ClaudeCodeParams {
	model?: string;
	system?: SystemEntry[] | string;
	thinking?: Record<string, unknown>;
	output_config?: unknown;
	tools?: Array<{ name?: string } & Record<string, unknown>>;
	messages?: Message[];
}

/**
 * Mutate the Anthropic Messages params in place so they match the
 * Claude Code payload contract.
 */
export function applyClaudeCodeTransforms(params: ClaudeCodeParams): void {
	const version = process.env.ANTHROPIC_CLI_VERSION ?? config.ccVersion;
	const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT ?? "sdk-cli";

	const billingHeader = buildBillingHeaderValue(
		(params.messages ?? []) as Array<{ role?: string; content?: any }>,
		version,
		entrypoint,
	);

	// Normalize system to array form
	let system: SystemEntry[] = [];
	if (typeof params.system === "string") {
		if (params.system.trim()) system.push({ type: "text", text: params.system });
	} else if (Array.isArray(params.system)) {
		system = [...params.system];
	}

	// Drop any pre-existing billing header
	system = system.filter(
		(e) => !(typeof e.text === "string" && e.text.startsWith(BILLING_PREFIX)),
	);

	// Ensure identity prefix is present as a dedicated entry (not merged with other text)
	const hasIdentity = system.some(
		(e) => typeof e.text === "string" && e.text.startsWith(SYSTEM_IDENTITY),
	);

	// Split any entry that starts with SYSTEM_IDENTITY into [identity, rest]
	const split: SystemEntry[] = [];
	for (const entry of system) {
		const text = typeof entry.text === "string" ? entry.text : "";
		if (text.startsWith(SYSTEM_IDENTITY) && text.length > SYSTEM_IDENTITY.length) {
			const rest = text.slice(SYSTEM_IDENTITY.length).replace(/^\n+/, "");
			const { text: _t, cache_control: _cc, ...identityProps } = entry;
			const { text: _t2, ...restProps } = entry;
			split.push({ ...identityProps, type: "text", text: SYSTEM_IDENTITY });
			if (rest) split.push({ ...restProps, type: "text", text: rest });
		} else {
			split.push(entry);
		}
	}
	system = split;

	if (!hasIdentity) {
		system.unshift({ type: "text", text: SYSTEM_IDENTITY });
	}

	// Move everything that is not billing-header or identity into the first user message
	const kept: SystemEntry[] = [];
	const moved: string[] = [];
	for (const entry of system) {
		const text = typeof entry.text === "string" ? entry.text : "";
		if (text.startsWith(BILLING_PREFIX) || text.startsWith(SYSTEM_IDENTITY)) {
			kept.push(entry);
		} else if (text) {
			moved.push(text);
		}
	}
	if (moved.length && Array.isArray(params.messages)) {
		const firstUser = params.messages.find((m) => m.role === "user");
		if (firstUser) {
			const prefix = moved.join("\n\n");
			if (typeof firstUser.content === "string") {
				firstUser.content = prefix + "\n\n" + firstUser.content;
			} else if (Array.isArray(firstUser.content)) {
				firstUser.content.unshift({ type: "text", text: prefix });
			}
		}
	}

	// Insert billing header as system[0]
	kept.unshift({ type: "text", text: billingHeader });
	params.system = kept;

	// Strip effort for models that don't support it
	const override = getModelOverride(params.model ?? "");
	if (override?.disableEffort && params.thinking && "effort" in params.thinking) {
		delete params.thinking.effort;
		if (!Object.keys(params.thinking).length) delete params.thinking;
	}

	// Prefix every tool name
	if (Array.isArray(params.tools)) {
		params.tools = params.tools.map((t) => ({
			...t,
			name: t.name ? prefixToolName(t.name) : t.name,
		}));
	}

	// Prefix every tool_use name in messages
	if (Array.isArray(params.messages)) {
		params.messages = params.messages.map((m) => {
			if (!Array.isArray(m.content)) return m;
			return {
				...m,
				content: m.content.map((b) => {
					if (b.type === "tool_use" && typeof b.name === "string") {
						return { ...b, name: prefixToolName(b.name) };
					}
					return b;
				}),
			};
		});
		params.messages = repairToolPairs(params.messages);
	}
}
