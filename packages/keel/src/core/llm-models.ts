/**
 * The ONLY place model ids appear (ADR-0009). Everything else refers to LLM_MODELS.default /
 * LLM_MODELS.fast; upgrades are a one-line change here plus fixture re-recording.
 */
export const LLM_MODELS = {
    default: 'claude-sonnet-5',
    fast: 'claude-haiku-4-5-20251001',
} as const

export type LlmModelId = (typeof LLM_MODELS)[keyof typeof LLM_MODELS]
