import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import install from "./index.ts";

describe("provider registration", () => {
	test("provider model metadata matches live context and output limits", () => {
		let providerConfig: ProviderConfig | undefined;
		const pi = {
			registerProvider(_name: string, config: ProviderConfig) {
				providerConfig = config;
			},
		} as Pick<ExtensionAPI, "registerProvider"> as ExtensionAPI;

		install(pi);

		const models = providerConfig?.models ?? [];
		expect(models.find((model) => model.id === "claude-opus-4-8")).toEqual(
			expect.objectContaining({ contextWindow: 1000000, maxTokens: 128000 }),
		);
		expect(models.find((model) => model.id === "claude-opus-4-7")).toEqual(
			expect.objectContaining({ contextWindow: 1000000, maxTokens: 128000 }),
		);
		expect(models.find((model) => model.id === "claude-sonnet-4-6")).toEqual(
			expect.objectContaining({ contextWindow: 1000000, maxTokens: 128000 }),
		);
		expect(models.find((model) => model.id === "claude-haiku-4-5")).toEqual(
			expect.objectContaining({ contextWindow: 200000, maxTokens: 64000 }),
		);
	});
});
