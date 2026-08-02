import type { LlmPort } from 'keel/ports/llm'

/**
 * FIXTURE ROUTE — SCANNED, NEVER SERVED. See ../dockets/route.ts for what this tree is.
 *
 * THIS FILE backs the `assistant/route.ts` EXACT exemption: a stateless LLM call creates no persisted,
 * org-scoped resource to authorize, and any read tools it exposes stay inside the caller's own session
 * scope. The gate is a call on the LLM port (`llm.complete` / `llm.stream` / `llm.runToolLoop`).
 *
 * Be honest about what that gate proves: it proves the route IS the model-calling route, not that the
 * route persists nothing — ADR-0012 says so in as many words. It is still the difference
 * between "exempt because someone named a file `assistant/route.ts`" and "exempt because the file
 * demonstrably talks to the model port".
 *
 * Local stand-in typed against the port, for the reason given in ../profile/route.ts.
 */
const llm: Pick<LlmPort, 'complete'> = { complete: async () => ({ text: '' }) }

export async function POST(): Promise<Response> {
    const { text } = await llm.complete({ purpose: 'fixture-echo', messages: [{ role: 'user', content: 'ping' }] })
    return Response.json({ text })
}
