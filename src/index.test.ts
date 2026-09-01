import { describe, expect, test } from "bun:test";
import { getModelOverride } from "@cgaravitoq/claude-code-core";
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
		expect(models.find((model) => model.id === "claude-opus-5")).toEqual(
			expect.objectContaining({ contextWindow: 1000000, maxTokens: 128000 }),
		);
		expect(models.find((model) => model.id === "claude-fable-5-1")).toEqual(
			expect.objectContaining({ contextWindow: 1000000, maxTokens: 128000 }),
		);
		expect(models.find((model) => model.id === "claude-fable-5")).toEqual(
			expect.objectContaining({ contextWindow: 1000000, maxTokens: 128000 }),
		);
		expect(models.find((model) => model.id === "claude-opus-4-8")).toEqual(
			expect.objectContaining({ contextWindow: 1000000, maxTokens: 128000 }),
		);
		expect(models.find((model) => model.id === "claude-opus-4-7")).toEqual(
			expect.objectContaining({ contextWindow: 1000000, maxTokens: 128000 }),
		);
		expect(models.find((model) => model.id === "claude-sonnet-5")).toEqual(
			expect.objectContaining({ contextWindow: 1000000, maxTokens: 128000 }),
		);
		expect(models.find((model) => model.id === "claude-haiku-4-5")).toEqual(
			expect.objectContaining({ contextWindow: 200000, maxTokens: 64000 }),
		);
	});

	test("Claude 5 models resolve to adaptive thinking", () => {
		for (const modelId of ["claude-opus-5", "claude-fable-5", "claude-sonnet-5"]) {
			expect(getModelOverride(modelId)).toEqual(
				expect.objectContaining({ adaptiveThinking: true }),
			);
		}
	});
});
