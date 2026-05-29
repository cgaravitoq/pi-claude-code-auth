import { describe, expect, test } from "bun:test";
import { applyClaudeCodeTransforms, unprefixToolName } from "./transforms.ts";

type ContentBlock = {
	type: string;
	text?: string;
	id?: string;
	tool_use_id?: string;
	name?: string;
	input?: Record<string, unknown>;
};

type Message = { role: "user" | "assistant"; content: ContentBlock[] };

describe("tool transforms", () => {
	test("replaces orphan tool_use with placeholder and preserves messages", () => {
		const params = {
			messages: [
				{ role: "user", content: [{ type: "text", text: "hi" }] },
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "tool-1", name: "search", input: {} }],
				},
				{ role: "user", content: [{ type: "text", text: "next" }] },
			] satisfies Message[],
		};

		applyClaudeCodeTransforms(params);

		expect(params.messages).toHaveLength(3);
		expect(params.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
		expect(params.messages[1]?.content).toEqual([{ type: "text", text: "" }]);
	});

	test("replaces orphan tool_result with placeholder and preserves messages", () => {
		const params = {
			messages: [
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1" }] },
				{ role: "assistant", content: [{ type: "text", text: "done" }] },
			] satisfies Message[],
		};

		applyClaudeCodeTransforms(params);

		expect(params.messages).toHaveLength(2);
		expect(params.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(params.messages[0]?.content).toEqual([{ type: "text", text: "[tool result omitted]" }]);
	});

	test("matched tool pair survives untouched except tool name prefix", () => {
		const params = {
			messages: [
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "tool-1", name: "search", input: {} }],
				},
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", text: "ok" }] },
			] satisfies Message[],
		};

		applyClaudeCodeTransforms(params);

		expect(params.messages[0]?.content).toEqual([
			{ type: "tool_use", id: "tool-1", name: "mcp_Search", input: {} },
		]);
		expect(params.messages[1]?.content).toEqual([{ type: "tool_result", tool_use_id: "tool-1", text: "ok" }]);
	});

	test("fully filtered message keeps placeholder and role alternation", () => {
		const params = {
			messages: [
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1" }] },
				{ role: "assistant", content: [{ type: "text", text: "next" }] },
			] satisfies Message[],
		};

		applyClaudeCodeTransforms(params);

		expect(params.messages[0]?.role).toBe("user");
		expect(params.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(params.messages[0]?.content).toEqual([{ type: "text", text: "[tool result omitted]" }]);
	});

	test("unprefix reverses prefixed tool names", () => {
		const params = { tools: [{ name: "search" }] };

		applyClaudeCodeTransforms(params);

		expect(unprefixToolName(params.tools[0]?.name ?? "")).toBe("search");
	});

	test("applyClaudeCodeTransforms mutates and returns params with systems and prefixed tools", () => {
		const params = {
			system: "project instructions",
			tools: [{ name: "search" }],
			messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] satisfies Message[],
		};

		const result = applyClaudeCodeTransforms(params);

		expect(result).toBe(params);
		expect(params.tools[0]?.name).toBe("mcp_Search");
		expect(params.system).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ text: "You are Claude Code, Anthropic's official CLI for Claude." }),
			]),
		);
		expect(params.messages[0]?.content[0]).toEqual({ type: "text", text: "project instructions" });
	});
});
