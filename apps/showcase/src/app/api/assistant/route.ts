import { ASSISTANT_COMPOSE_SYSTEM, assistantComposePurpose, assistantConfig } from '@app-config/assistant'
import { analytics, auth, db, llm } from 'keel/adapters/index'
import { assistantExecutor } from 'keel/server-lib/assistant'
import { resolveOrgContext } from '../org-context'
import { withPortErrors } from '../respond'

/**
 * The desk assistant, in two passes and streamed.
 *
 * PASS 1 — GATHER (`llm.runToolLoop`). The model may call the app-registered tools
 * (`list_my_tickets`, `search_tickets`); the app executes each one between turns (the llm port never
 * runs tools — it relays the request and takes back the result). The tools' closures capture the
 * CALLER's resolved tenant + org, so the model chooses WHEN to look but can never widen WHERE.
 *
 * PASS 2 — COMPOSE (`llm.stream`). The facts the tools returned are handed back to the model to turn
 * into prose, and the chunks are forwarded to the browser as they arrive, so the answer types itself
 * out instead of appearing after a silent wait.
 *
 * WHY TWO PASSES. The llm port's streaming method takes no tools — deliberately, because a streaming
 * tool loop is a much larger contract than a template needs. Gathering and composing are therefore
 * separate calls, which is also how the honest determinism story works: pass 1 hash-matches its
 * committed conversation fixture (canned utterances, LIVE tool effects), and pass 2's prompt carries
 * live ticket data so it can never hash-match and resolves to its purpose's DEFAULT entry — the same
 * answer every run. The live data still reaches the screen: `sources` below are the tickets the TOOLS
 * actually read, so the prose is replayed and the evidence beside it is real.
 *
 * TRANSPORT is NDJSON: one JSON object per line. The first line carries the sources (known before a
 * single token streams, because pass 1 has already finished); every line after it is a `{delta}`.
 * Chosen over SSE because there is nothing to reconnect to and no event taxonomy to invent.
 *
 * Authorize-exempt: like GET /api/tickets it only READS the caller's own active-team data under their
 * own session and persists nothing — see the exemption map in authz/authorized-mutations.test.ts.
 */
export async function POST(request: Request): Promise<Response> {
    return withPortErrors(async () => {
        const user = await auth.requireUser()
        if (user.restricted) return Response.json({ error: 'forbidden' }, { status: 403 })
        const { question } = (await request.json()) as { question: string }

        const resolved = await resolveOrgContext(user)
        if (resolved instanceof Response) return resolved
        const { tenantId, orgId } = resolved

        // Pass 1. Wrap the seam's executor so the route can keep what the tools actually returned —
        // the answer's sources. The wrapper only OBSERVES: it never edits a result on its way back to
        // the model.
        const sources: string[] = []
        const executor = assistantExecutor(assistantConfig, { db, tenantId, orgId })
        const { text: gathered } = await llm.runToolLoop({
            purpose: assistantConfig.purpose,
            system: assistantConfig.system,
            messages: [{ role: 'user', content: question }],
            tools: assistantConfig.tools.map((tool) => tool.def),
            execute: async (call) => {
                const result = await executor(call)
                for (const source of ticketSources(result)) {
                    if (!sources.includes(source)) sources.push(source)
                }
                return result
            },
        })

        await analytics.capture('assistant_asked', { tenant: user.tenantSlug })

        // Pass 2. The composer sees the question, what the tools found, and the model's own gathering
        // turn — everything a person would need to write the reply, and nothing about other teams.
        const stream = llm.stream({
            purpose: assistantComposePurpose,
            system: ASSISTANT_COMPOSE_SYSTEM,
            messages: [
                { role: 'user', content: question },
                { role: 'assistant', content: gathered },
                { role: 'user', content: `Ticket facts:\n${sources.join('\n') || '(none found)'}` },
            ],
        })

        const encoder = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
            async start(controller) {
                controller.enqueue(encoder.encode(`${JSON.stringify({ sources })}\n`))
                try {
                    for await (const chunk of stream) {
                        controller.enqueue(encoder.encode(`${JSON.stringify({ delta: chunk })}\n`))
                    }
                } catch (error) {
                    // The stream has already started, so there is no status code left to fail with —
                    // say so in-band and close cleanly rather than truncating and looking like a hang.
                    const message = error instanceof Error ? error.message : 'stream failed'
                    controller.enqueue(encoder.encode(`${JSON.stringify({ error: message })}\n`))
                }
                controller.close()
            },
        })
        return new Response(body, {
            headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
        })
    })
}

/**
 * Pull `REF — subject` lines out of a tool result. Both registered tools return
 * `{ tickets: [{ ref, subject, … }] }`, and anything else (an error object, a future tool) simply
 * contributes no sources — the route never assumes a shape it did not get.
 */
function ticketSources(result: string): string[] {
    try {
        const parsed = JSON.parse(result) as { tickets?: { ref?: unknown; subject?: unknown }[] }
        if (!Array.isArray(parsed.tickets)) return []
        return parsed.tickets
            .filter((t) => typeof t.ref === 'string' && typeof t.subject === 'string')
            .map((t) => `${String(t.ref)} — ${String(t.subject)}`)
    } catch {
        return []
    }
}
