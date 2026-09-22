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
