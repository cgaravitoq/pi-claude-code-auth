import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import install from "./index.ts";
import { computeBetas, config, getModelOverride } from "./model-config.ts";

describe("model config", () => {
	test("config is frozen", () => {
		expect(Object.isFrozen(config)).toBe(true);
	});

	test("nested overrides are frozen", () => {
		expect(Object.values(config.modelOverrides).every(Object.isFrozen)).toBe(true);
	});

	test("opus 4.8 override enables adaptive thinking", () => {
		expect(getModelOverride("claude-opus-4-8")).toEqual(
			expect.objectContaining({ adaptiveThinking: true }),
		);
	});

	test("opus 4.7 override enables adaptive thinking", () => {
		expect(getModelOverride("claude-opus-4-7")).toEqual(
			expect.objectContaining({ adaptiveThinking: true }),
		);
	});

	test("haiku returns haiku override", () => {
		expect(getModelOverride("claude-haiku-4-5")).toBe(config.modelOverrides.haiku);
	});

	test("unknown model returns null", () => {
		expect(getModelOverride("unknown-model")).toBeNull();
	});

	test("opus 4.8 betas include effort beta and no duplicates", () => {
		const result = computeBetas("claude-opus-4-8");

		expect(result).toContain("effort-2025-11-24");
		expect(result).toContain("context-1m-2025-08-07");
		expect(new Set(result).size).toBe(result.length);
	});

	test("opus 4.7 betas include effort and long-context betas via 4-7 override", () => {
		expect(computeBetas("claude-opus-4-7")).toContain("effort-2025-11-24");
		expect(computeBetas("claude-opus-4-7")).toContain("context-1m-2025-08-07");
	});

	test("sonnet 4.6 betas include long-context beta via 4-6 override", () => {
		expect(computeBetas("claude-sonnet-4-6")).toContain("context-1m-2025-08-07");
	});

	test("haiku betas exclude interleaved thinking", () => {
		expect(computeBetas("claude-haiku-4-5")).not.toContain(
			"interleaved-thinking-2025-05-14",
		);
	});

	test("haiku betas do not include effort beta (no add override)", () => {
		expect(computeBetas("claude-haiku-4-5")).not.toContain("effort-2025-11-24");
	});

	test("haiku betas do not include long-context beta", () => {
		expect(computeBetas("claude-haiku-4-5")).not.toContain("context-1m-2025-08-07");
	});

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
