import type { LlmModelId } from '../core/llm-models'

export interface LlmMessage {
    role: 'user' | 'assistant'
    content: string
}

export interface LlmRequest {
    /**
     * Stable tag naming WHY the call is made (e.g. 'assistant-demo'). Fixtures are grouped by
     * purpose, so replay stays deterministic per feature.
     */
    purpose: string
    /** Defaults to LLM_MODELS.default. */
    model?: LlmModelId
    system?: string
    messages: LlmMessage[]
    maxTokens?: number
}

// --- Tool use --------------------------------------------------------------------------------
//
// A minimal, honest tool-loop surface: the APP supplies tool definitions and an initial message
// list; the port drives the model↔tool alternation and RELAYS each tool-call request to the
// app's `execute` callback. The port NEVER executes tools itself — it only carries the model's
// tool_use request out and the app's tool_result back in. This keeps the trust boundary sharp:
// the LLM widens no data access beyond whatever `execute` (an app closure) chooses to expose.
//
// TRUST MODEL (read this before adding a tool): tool results are USER CONTENT flowing into the
// model's context — in real mode a stored note can carry injection text that steers the model.
// Model output is therefore UNTRUSTED, always: display it, never branch on it, never wire it to a
// privileged action. A tool's blast radius is exactly its `execute` closure — scope the closure to
// the caller's session (resolved ids captured at build time, never model-supplied), validate the
// tool name with exact equality, and ignore model-controlled input unless each field is validated.
// Adapters additionally refuse to execute a tool_use whose name isn't among the supplied defs.

/** A tool the app exposes to the model. `description`/`inputSchema` are MODEL-facing prompt
 *  content (like `system`), not user-facing UI copy — so they are plain strings, not next-intl. */
export interface LlmToolDef {
    name: string
    /** Tells the model WHEN to call the tool (Anthropic tool `description`). */
    description: string
    /** JSON-schema-ish input shape (Anthropic tool `input_schema`). */
    inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown }
}

/** One content block in a conversation turn. Mirrors Anthropic's block shapes closely enough to
 *  serialize as a fixture, small enough to stay scoped to what this app needs. */
export type LlmContentBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'tool_result'; toolUseId: string; content: string }

/** One turn in the returned conversation. Recorded fixture turns are always `assistant` (the
 *  model's utterances, incl. tool_use); the live `tool_result` turns the adapter interleaves are
 *  `user`. */
export interface LlmTurn {
    role: 'assistant' | 'user'
    content: LlmContentBlock[]
}

export interface LlmToolLoopRequest {
    purpose: string
    model?: LlmModelId
    system?: string
    messages: LlmMessage[]
    tools: LlmToolDef[]
    maxTokens?: number
    /** Upper bound on model↔tool round-trips before the loop gives up (default 6). */
    maxTurns?: number
    /** APP-supplied tool executor. The port relays the model's call and takes back the result
     *  STRING; it never runs a tool itself. Throwing here surfaces to the caller. */
    execute: (call: { name: string; input: unknown }) => Promise<string>
}

export interface LlmPort {
    complete(request: LlmRequest): Promise<{ text: string }>
    stream(request: LlmRequest): AsyncIterable<string>
    /**
     * Drive a tool-using conversation to its final text. Returns `text` (the FINAL assistant turn's
     * text) and `turns` — the full conversation: recorded assistant turns (incl. tool_use)
     * interleaved with the live `tool_result` turns produced by `execute`.
     */
    runToolLoop(request: LlmToolLoopRequest): Promise<{ text: string; turns: LlmTurn[] }>
}
