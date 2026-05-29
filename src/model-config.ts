export interface ModelOverride {
  readonly exclude?: readonly string[]
  readonly add?: readonly string[]
  disableEffort?: boolean
  /**
   * Model requires the adaptive-thinking contract: `thinking: {type: "adaptive"}`
   * plus `output_config.effort`. Manual `thinking: {type: "enabled", budget_tokens}`
   * is rejected with a 400 on these models (Opus 4.8 and newer).
   */
  adaptiveThinking?: boolean
}

export interface ModelConfig {
  ccVersion: string
  readonly baseBetas: readonly string[]
  readonly longContextBetas: readonly string[]
  readonly modelOverrides: Readonly<Record<string, ModelOverride>>
}

export const config: ModelConfig = {
  ccVersion: "2.1.112",
  baseBetas: [
    "claude-code-20250219",
    "oauth-2025-04-20",
    "interleaved-thinking-2025-05-14",
    "prompt-caching-scope-2026-01-05",
    "context-management-2025-06-27",
    "advisor-tool-2026-03-01",
  ],
  longContextBetas: [
    "context-1m-2025-08-07",
    "interleaved-thinking-2025-05-14",
  ],
  modelOverrides: {
    haiku: {
      exclude: ["interleaved-thinking-2025-05-14"],
      disableEffort: true,
    },
    "4-6": {
      add: ["effort-2025-11-24"],
    },
    "4-7": {
      add: ["effort-2025-11-24"],
    },
    "4-8": {
      add: ["effort-2025-11-24"],
      adaptiveThinking: true,
    },
  },
}

/**
 * Find the override entry matching a model ID.
 * Keys are matched via includes() against the lowercased model ID.
 *
 * First-match-wins: if multiple keys match, only the first (by insertion
 * order) is returned. List more specific keys before broader ones
 * (e.g. "opus-4-6" before "opus") so they take priority.
 */
export function getModelOverride(modelId: string): ModelOverride | null {
  const lower = modelId.toLowerCase()
  for (const [pattern, override] of Object.entries(config.modelOverrides)) {
    if (lower.includes(pattern)) return override
  }
  return null
}

/**
 * Compute the betas to send for a given model, honoring per-model overrides.
 */
export function computeBetas(modelId: string): string[] {
  const override = getModelOverride(modelId);
  let betas = [...config.baseBetas];
  if (override?.exclude) betas = betas.filter((b) => !override.exclude!.includes(b));
  if (override?.add) betas = [...betas, ...override.add];
  return Array.from(new Set(betas));
}

Object.values(config.modelOverrides).forEach(Object.freeze)
Object.freeze(config)
