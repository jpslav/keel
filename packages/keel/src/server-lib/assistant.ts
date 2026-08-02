import type { DbPort } from '../ports/db'
import type { LlmToolDef } from '../ports/llm'

/**
 * The assistant tool-loop contract (framework — ADR-0012). The app registers its assistant purpose,
 * system prompt, and tools (each a MODEL-facing definition + an app-side `execute`) via
 * src/app-config/assistant.ts; the route drives a generic loop over them. This keeps the assistant a
 * registration surface: an adopter swaps the seam's assistantConfig, not the route.
 */

/** The per-request context an assistant tool's `execute` closes over — scoped to THIS caller's session. */
export interface AssistantToolCtx {
    db: DbPort
    tenantId: string
    orgId: string
}

/** One registered tool: its MODEL-facing definition + the app-side executor the loop relays calls to. */
interface AssistantTool {
    def: LlmToolDef
    execute: (input: unknown, ctx: AssistantToolCtx) => Promise<string>
}

/** The app's assistant registration. `purpose`/`system` + the tool defs form the fixture-hashed request. */
export interface AssistantConfig {
    purpose: string
    system: string
    tools: AssistantTool[]
}

/**
 * Build the `execute` callback the llm port's runToolLoop relays each model tool-call to: dispatch by
 * exact tool name to the registered tool, scoped to `ctx`. An unknown tool name returns an error string
 * (never throws) — the model's request is untrusted. Shared by the route and the fixture recorder.
 */
export function assistantExecutor(
    config: AssistantConfig,
    ctx: AssistantToolCtx,
): (call: { name: string; input: unknown }) => Promise<string> {
    return async (call) => {
        const tool = config.tools.find((t) => t.def.name === call.name)
        if (!tool) return `unknown tool: ${call.name}`
        return tool.execute(call.input, ctx)
    }
}
