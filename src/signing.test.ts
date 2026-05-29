import { describe, expect, test } from "bun:test";
import { buildBillingHeaderValue } from "./signing.ts";

type Message = { role?: string; content?: string | Array<{ type?: string; text?: string }> };

function expectBillingHeader(value: string) {
	expect(value).toMatch(
		/^x-anthropic-billing-header: cc_version=\d+\.\d+\.\d+\.[a-f0-9]{3}; cc_entrypoint=[^;]+; cch=[a-f0-9]{5};$/,
	);
}

describe("buildBillingHeaderValue", () => {
	test("empty messages are deterministic and do not throw", () => {
		const value = buildBillingHeaderValue([], "2.1.112", "sdk-cli");

		expectBillingHeader(value);
		expect(value).toBe(buildBillingHeaderValue([], "2.1.112", "sdk-cli"));
	});

	test("single user text message is deterministic and idempotent", () => {
		const messages: Message[] = [{ role: "user", content: "hello" }];
		const first = buildBillingHeaderValue(messages, "2.1.112", "sdk-cli");
		const second = buildBillingHeaderValue(messages, "2.1.112", "sdk-cli");

		expectBillingHeader(first);
		expect(second).toBe(first);
	});

	test("only the first user message text influences output", () => {
		const base: Message[] = [
			{ role: "assistant", content: "ignored" },
			{ role: "user", content: "first" },
			{ role: "user", content: "second" },
		];
		const changedLaterMessages: Message[] = [
			{ role: "assistant", content: "changed" },
			{ role: "user", content: "first" },
			{ role: "user", content: "changed" },
		];

		expect(buildBillingHeaderValue(changedLaterMessages, "2.1.112", "sdk-cli")).toBe(
			buildBillingHeaderValue(base, "2.1.112", "sdk-cli"),
		);
	});

	test("same input twice returns identical output", () => {
		const messages: Message[] = [{ role: "user", content: [{ type: "text", text: "hello" }] }];

		expect(buildBillingHeaderValue(messages, "2.1.112", "sdk-cli")).toBe(
			buildBillingHeaderValue(messages, "2.1.112", "sdk-cli"),
		);
	});
});
