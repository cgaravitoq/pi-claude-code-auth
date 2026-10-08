import { expect, mock, test } from "bun:test";
import { type Model, normalizeContext } from "@earendil-works/pi-ai";

let streamParams: any;
mock.module("@anthropic-ai/sdk", () => ({
	default: class {
		messages = {
			stream: (params: unknown) => {
				streamParams = params;
				return (async function* () {})();
			},
		};
	},
}));
const { streamClaudeCodeAnthropic } = await import("./anthropic-stream.ts");

test("sends the prompt and tools carried by the transcript's system messages", async () => {
	const context = normalizeContext({
		systemPrompt: "PI_SYSTEM_PROMPT",
		tools: [
			{
				name: "read",
				description: "Read a file",
				parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } as any,
			},
		],
		messages: [{ role: "user", content: "hi", timestamp: 0 }],
	});
	const model = {
		id: "claude-opus-5-5",
		api: "anthropic-messages",
		provider: "claude-code",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		maxTokens: 128000,
	} as Model<"anthropic-messages">;

	for await (const _event of streamClaudeCodeAnthropic(model, context, { apiKey: "token" })) {
	}

	expect(streamParams.tools.map((tool: { name: string }) => tool.name)).toEqual(["mcp_Read"]);
	expect(JSON.stringify([streamParams.system, streamParams.messages])).toContain("PI_SYSTEM_PROMPT");
});

test("replays thinking only from the model being called", async () => {
	const assistant = (model: string, signature: string, toolCallId: string) => ({
		role: "assistant" as const,
		content: [
			{ type: "thinking" as const, thinking: "", thinkingSignature: signature },
			{ type: "toolCall" as const, id: toolCallId, name: "read", arguments: { path: "package.json" } },
		],
		api: "anthropic-messages" as const,
		provider: "claude-code",
		model,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse" as const,
		timestamp: 0,
	});
	const toolResult = (toolCallId: string) => ({
		role: "toolResult" as const,
		toolCallId,
		toolName: "read",
		content: [{ type: "text" as const, text: "{}" }],
		isError: false,
		timestamp: 0,
	});
	const context = normalizeContext({
		messages: [
			{ role: "user", content: "hi", timestamp: 0 },
			assistant("claude-sonnet-5-5", "OTHER_MODEL_SIGNATURE", "toolu_1"),
			toolResult("toolu_1"),
			assistant("claude-haiku-5-5", "SAME_MODEL_SIGNATURE", "toolu_2"),
			toolResult("toolu_2"),
		],
	});
	const model = {
		id: "claude-haiku-5-5",
		api: "anthropic-messages",
		provider: "claude-code",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		maxTokens: 128000,
	} as Model<"anthropic-messages">;

	for await (const _event of streamClaudeCodeAnthropic(model, context, { apiKey: "token" })) {
	}

	const thinking = streamParams.messages
		.flatMap((message: { content: unknown }) => (Array.isArray(message.content) ? message.content : []))
		.filter((block: { type: string }) => block.type === "thinking");
	expect(thinking).toEqual([{ type: "thinking", thinking: "", signature: "SAME_MODEL_SIGNATURE" }]);
});
