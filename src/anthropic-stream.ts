/**
 * Anthropic streaming implementation, adapted from pi's
 * examples/extensions/custom-provider-anthropic/index.ts.
 *
 * Hardcoded to OAuth mode since this extension only ever talks to
 * api.anthropic.com with a Claude Code OAuth bearer token.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
	ContentBlockParam,
	MessageCreateParamsStreaming,
} from "@anthropic-ai/sdk/resources/messages.js";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	calculateCost,
	createAssistantMessageEventStream,
	type ImageContent,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type StopReason,
	type TextContent,
	type ThinkingContent,
	type Tool,
	type ToolCall,
	type ToolResultMessage,
} from "@earendil-works/pi-ai";

import {
	applyClaudeCodeTransforms,
	computeBetas,
	config as ccConfig,
	getModelOverride,
	unprefixToolName,
} from "@cgaravitoq/claude-code-core";

// Map pi's ThinkingLevel to a valid Anthropic effort. "minimal" is not an API
// effort level; the API accepts low | medium | high | xhigh | max.
function toEffort(level: string): string {
	return level === "minimal" ? "low" : level;
}

// Claude Code tool names for OAuth stealth mode
const claudeCodeTools = [
	"Read",
	"Write",
	"Edit",
	"Bash",
	"Grep",
	"Glob",
	"AskUserQuestion",
	"TodoWrite",
	"WebFetch",
	"WebSearch",
];
const ccToolLookup = new Map(claudeCodeTools.map((t) => [t.toLowerCase(), t]));
const toClaudeCodeName = (name: string) => ccToolLookup.get(name.toLowerCase()) ?? name;
const fromClaudeCodeName = (name: string, tools?: Tool[]) => {
	const lowerName = name.toLowerCase();
	const matched = tools?.find((t) => t.name.toLowerCase() === lowerName);
	return matched?.name ?? name;
};

function sanitizeSurrogates(text: string): string {
	return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
}

function convertContentBlocks(
	content: (TextContent | ImageContent)[],
): string | Array<{ type: "text"; text: string } | { type: "image"; source: any }> {
	const hasImages = content.some((c) => c.type === "image");
	if (!hasImages) {
		return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
	}

	const blocks = content.map((block) => {
		if (block.type === "text") {
			return { type: "text" as const, text: sanitizeSurrogates(block.text) };
		}
		return {
			type: "image" as const,
			source: {
				type: "base64" as const,
				media_type: block.mimeType,
				data: block.data,
			},
		};
	});

	if (!blocks.some((b) => b.type === "text")) {
		blocks.unshift({ type: "text" as const, text: "(see attached image)" });
	}

	return blocks;
}

function convertMessages(messages: Message[]): any[] {
	const params: any[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				if (msg.content.trim()) {
					params.push({ role: "user", content: sanitizeSurrogates(msg.content) });
				}
			} else {
				const blocks: ContentBlockParam[] = msg.content.map((item) =>
					item.type === "text"
						? { type: "text" as const, text: sanitizeSurrogates(item.text) }
						: {
								type: "image" as const,
								source: { type: "base64" as const, media_type: item.mimeType as any, data: item.data },
							},
				);
				if (blocks.length > 0) {
					params.push({ role: "user", content: blocks });
				}
			}
		} else if (msg.role === "assistant") {
			const blocks: ContentBlockParam[] = [];
			for (const block of msg.content) {
				if (block.type === "text" && block.text.trim()) {
					blocks.push({ type: "text", text: sanitizeSurrogates(block.text) });
				} else if (block.type === "thinking") {
					// Skip: re-sending thinking blocks fails with claude-code beta because
					// the signature is bound to the original turn and cannot be revalidated.
					continue;
				} else if (block.type === "toolCall") {
					blocks.push({
						type: "tool_use",
						id: block.id,
						name: toClaudeCodeName(block.name),
						input: block.arguments,
					});
				}
			}
			if (blocks.length === 0) {
				// Preserve role alternation when thinking blocks are stripped.
				// Text must be non-empty: the API rejects empty text blocks with 400.
				blocks.push({ type: "text", text: "(no content)" });
			}
			params.push({ role: "assistant", content: blocks });
		} else if (msg.role === "toolResult") {
			const toolResults: any[] = [];
			toolResults.push({
				type: "tool_result",
				tool_use_id: msg.toolCallId,
				content: convertContentBlocks(msg.content),
				is_error: msg.isError,
			});

			let j = i + 1;
			while (j < messages.length && messages[j].role === "toolResult") {
				const nextMsg = messages[j] as ToolResultMessage;
				toolResults.push({
					type: "tool_result",
					tool_use_id: nextMsg.toolCallId,
					content: convertContentBlocks(nextMsg.content),
					is_error: nextMsg.isError,
				});
				j++;
			}
			i = j - 1;
			params.push({ role: "user", content: toolResults });
		}
	}

	// Add cache control to last user message
	if (params.length > 0) {
		const last = params[params.length - 1];
		if (last.role === "user" && Array.isArray(last.content)) {
			const lastBlock = last.content[last.content.length - 1];
			if (lastBlock) {
				lastBlock.cache_control = { type: "ephemeral" };
			}
		}
	}

	return params;
}

function convertTools(tools: Tool[]): any[] {
	return tools.map((tool) => ({
		name: toClaudeCodeName(tool.name),
		description: tool.description,
		input_schema: {
			type: "object",
			properties: (tool.parameters as any).properties || {},
			required: (tool.parameters as any).required || [],
		},
	}));
}

function mapStopReason(reason: string): StopReason {
	switch (reason) {
		case "end_turn":
		case "pause_turn":
		case "stop_sequence":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "toolUse";
		default:
			return "error";
	}
}

export function streamClaudeCodeAnthropic(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			const apiKey = options?.apiKey ?? "";

			const betas = computeBetas(model.id);
			const version = process.env.ANTHROPIC_CLI_VERSION ?? ccConfig.ccVersion;
			const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT ?? "sdk-cli";
			const userAgent =
				process.env.ANTHROPIC_USER_AGENT ?? `claude-cli/${version} (external, ${entrypoint})`;

			const client = new Anthropic({
				baseURL: model.baseUrl,
				apiKey: null,
				authToken: apiKey,
				defaultHeaders: {
					accept: "application/json",
					"anthropic-dangerous-direct-browser-access": "true",
					"anthropic-beta": betas.join(","),
					"user-agent": userAgent,
					"x-app": "cli",
				},
			});

			// Build request params
			let params: MessageCreateParamsStreaming = {
				model: model.id,
				messages: convertMessages(context.messages),
				max_tokens: options?.maxTokens || Math.floor(model.maxTokens / 3),
				stream: true,
			};

			// System prompt with Claude Code identity for OAuth
			params.system = [
				{
					type: "text",
					text: "You are Claude Code, Anthropic's official CLI for Claude.",
					cache_control: { type: "ephemeral" },
				},
			];
			if (context.systemPrompt) {
				params.system.push({
					type: "text",
					text: sanitizeSurrogates(context.systemPrompt),
					cache_control: { type: "ephemeral" },
				});
			}

			if (context.tools) {
				params.tools = convertTools(context.tools);
			}

			// Handle thinking/reasoning
			if (options?.reasoning && model.reasoning) {
				if (getModelOverride(model.id)?.adaptiveThinking) {
					// Adaptive-thinking models (Opus 4.8+): manual budget_tokens is
					// rejected with a 400. Thinking depth is driven by effort instead.
					params.thinking = { type: "adaptive" } as any;
					(params as any).output_config = { effort: toEffort(options.reasoning) };
				} else {
					const defaultBudgets: Record<string, number> = {
						minimal: 1024,
						low: 4096,
						medium: 10240,
						high: 20480,
						xhigh: 32768,
						max: 64000,
					};
					const customBudget = options.thinkingBudgets?.[options.reasoning as keyof typeof options.thinkingBudgets];
					params.thinking = {
						type: "enabled",
						budget_tokens: customBudget ?? defaultBudgets[options.reasoning] ?? 10240,
					};
				}
			}

			// Reshape system + tools + messages so Anthropic accepts this as a
			// legitimate Claude Code session (billing header, identity split,
			// move 3rd-party system prompts to user, mcp_<PascalCase> tool names).
			params = applyClaudeCodeTransforms(params);

			const anthropicStream = client.messages.stream({ ...params }, { signal: options?.signal });
			stream.push({ type: "start", partial: output });

			type Block = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & {
				index: number;
				argumentsParseError?: string;
				argumentsParseErrorWarned?: boolean;
			};
			const blocks = output.content as Block[];
			const parseToolCallArguments = (block: Block) => {
				if (block.type !== "toolCall") return;
				// A tool call with no input streams an empty (or whitespace) partialJson;
				// that means "no arguments", not a parse failure. Treat it as {}.
				if (!block.partialJson || !block.partialJson.trim()) {
					block.arguments = {};
					delete block.argumentsParseError;
					return;
				}
				try {
					block.arguments = JSON.parse(block.partialJson);
					delete block.argumentsParseError;
				} catch (err) {
					block.arguments = {};
					block.argumentsParseError = String(err);
					if (!block.argumentsParseErrorWarned) {
						console.warn("Failed to parse tool_use partialJson", {
							id: block.id,
							name: block.name,
							partialJson: block.partialJson.slice(0, 200),
						});
						block.argumentsParseErrorWarned = true;
					}
				}
			};

			for await (const event of anthropicStream) {
				if (event.type === "message_start") {
					output.usage.input = event.message.usage.input_tokens || 0;
					output.usage.output = event.message.usage.output_tokens || 0;
					output.usage.cacheRead = (event.message.usage as any).cache_read_input_tokens || 0;
					output.usage.cacheWrite = (event.message.usage as any).cache_creation_input_tokens || 0;
					output.usage.totalTokens =
						output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
					calculateCost(model, output.usage);
				} else if (event.type === "content_block_start") {
					if (event.content_block.type === "text") {
						output.content.push({ type: "text", text: "", index: event.index } as any);
						stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
					} else if (event.content_block.type === "thinking") {
						output.content.push({
							type: "thinking",
							thinking: "",
							thinkingSignature: "",
							index: event.index,
						} as any);
						stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
					} else if (event.content_block.type === "tool_use") {
						// Echoed name is mcp_<PascalCase>; strip the prefix, then resolve
						// to the canonical pi tool name (case-insensitive lookup).
						const stripped = unprefixToolName(event.content_block.name);
						const resolved = fromClaudeCodeName(stripped, context.tools);
						output.content.push({
							type: "toolCall",
							id: event.content_block.id,
							name: resolved,
							arguments: {},
							partialJson: "",
							index: event.index,
						} as any);
						stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
					}
				} else if (event.type === "content_block_delta") {
					const index = blocks.findIndex((b) => b.index === event.index);
					const block = blocks[index];
					if (!block) continue;

					if (event.delta.type === "text_delta" && block.type === "text") {
						block.text += event.delta.text;
						stream.push({ type: "text_delta", contentIndex: index, delta: event.delta.text, partial: output });
					} else if (event.delta.type === "thinking_delta" && block.type === "thinking") {
						block.thinking += event.delta.thinking;
						stream.push({
							type: "thinking_delta",
							contentIndex: index,
							delta: event.delta.thinking,
							partial: output,
						});
					} else if (event.delta.type === "input_json_delta" && block.type === "toolCall") {
						// Accumulate only; partial JSON is not valid mid-stream. Parse once
						// at content_block_stop to avoid spurious parse failures.
						(block as any).partialJson += event.delta.partial_json;
						stream.push({
							type: "toolcall_delta",
							contentIndex: index,
							delta: event.delta.partial_json,
							partial: output,
						});
					} else if (event.delta.type === "signature_delta" && block.type === "thinking") {
						block.thinkingSignature = (block.thinkingSignature || "") + (event.delta as any).signature;
					}
				} else if (event.type === "content_block_stop") {
					const index = blocks.findIndex((b) => b.index === event.index);
					const block = blocks[index];
					if (!block) continue;

					delete (block as any).index;
					if (block.type === "text") {
						stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
					} else if (block.type === "thinking") {
						stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: output });
					} else if (block.type === "toolCall") {
						parseToolCallArguments(block);
						delete (block as any).partialJson;
						delete (block as any).argumentsParseErrorWarned;
						stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
					}
				} else if (event.type === "message_delta") {
					if ((event.delta as any).stop_reason) {
						output.stopReason = mapStopReason((event.delta as any).stop_reason);
					}
					if (typeof (event.usage as any).output_tokens === "number") {
						output.usage.output = (event.usage as any).output_tokens;
					}
					output.usage.totalTokens =
						output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
					calculateCost(model, output.usage);
				}
			}

			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as any).index;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}
