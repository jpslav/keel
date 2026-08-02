import type { LlmToolDef } from 'keel/ports/llm'
import type { AssistantConfig } from 'keel/server-lib/assistant'

/**
 * The APP's assistant registration (the seam side of the assistant route, ADR-0012). The `system` and
 * each tool's `description`/`inputSchema` are MODEL-facing prompt content (like the framework's, not
 * user next-intl copy), and they are HASHED into the fixture lookup — so any drift here breaks the
 * replay match loudly (the fixture-contract test in ./assistant.test.ts) instead of silently answering
 * from the default entry. A real adopter replaces this file with its own purpose/system/tools.
 *
 * TWO tools, because one tool never shows whether the model can CHOOSE. `list_my_tickets` answers
 * "what's on my plate"; `search_tickets` answers "did anyone report X". They differ in the thing that
 * matters for a tool loop — one takes model-supplied input and the other does not — so the second one
 * is where the input-validation posture is demonstrated rather than assumed.
 *
 * SCOPE. Both tools' `execute` closures capture the CALLER's resolved tenant + org ids (supplied by the
 * route), never model-supplied ones. The model chooses WHEN to call a tool; it can never widen the data
 * a tool reaches beyond the caller's own active team — exactly the scope of GET /api/tickets.
 */

const ASSISTANT_SYSTEM =
    "You are the assistant for a support desk. You can look up the tickets in the caller's own team " +
    'with the list_my_tickets tool, and search them by keyword with the search_tickets tool. ' +
    "Only discuss this team's tickets."

const LIST_MY_TICKETS_TOOL: LlmToolDef = {
    name: 'list_my_tickets',
    description:
        "List the tickets in the caller's active team, newest first. Call this to answer questions " +
        'about the current queue (for example "what tickets are open?").',
    inputSchema: { type: 'object', properties: {}, required: [] },
}

const SEARCH_TICKETS_TOOL: LlmToolDef = {
    name: 'search_tickets',
    description:
        "Search the caller's active team for tickets whose subject or description contains a keyword. " +
        'Call this when the question is about a specific problem rather than the queue as a whole ' +
        '(for example "has anyone reported the scanner dropping out?").',
    inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The keyword or phrase to look for.' } },
        required: ['query'],
    },
}

/** The projection both tools return. Small on purpose: a ticket body can be long, and the model is
 *  being asked to talk about the queue, not to quote it. */
interface TicketFact {
    ref: string
    subject: string
    status: string
    assigned: boolean
}

/** Longest keyword we will run a LIKE over — model-supplied input, validated at the boundary. */
const MAX_QUERY_CHARS = 100

/** Escape the LIKE wildcards so a model-supplied `%` searches for a percent sign, not for everything. */
function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export const assistantConfig: AssistantConfig = {
    purpose: 'assistant-desk',
    system: ASSISTANT_SYSTEM,
    tools: [
        {
            def: LIST_MY_TICKETS_TOOL,
            execute: async (_input, ctx) => {
                const rows = await ctx.db.withTenant(ctx.tenantId, (trx) =>
                    trx
                        .selectFrom('tickets')
                        .select(['ref', 'subject', 'status', 'assignee_user_id'])
                        .where('org_id', '=', ctx.orgId)
                        .orderBy('created_at', 'desc')
                        .execute(),
                )
                const tickets: TicketFact[] = rows.map((r) => ({
                    ref: r.ref,
                    subject: r.subject,
                    status: r.status,
                    assigned: r.assignee_user_id !== null,
                }))
                return JSON.stringify({ tickets })
            },
        },
        {
            def: SEARCH_TICKETS_TOOL,
            // The ONLY tool that takes model-controlled input, so it is where the house rule lives:
            // validate every field before it touches a query. A non-string, an empty string, or an
            // over-long one is REFUSED with a message the model can act on — not coerced, not passed
            // through. The value is then parameterized AND its LIKE wildcards escaped, so the worst a
            // hostile prompt can do is search for a literal percent sign inside its own team.
            execute: async (input, ctx) => {
                const query = (input as { query?: unknown } | null)?.query
                if (typeof query !== 'string' || query.trim() === '') {
                    return JSON.stringify({ error: 'search_tickets requires a non-empty string "query"' })
                }
                if (query.length > MAX_QUERY_CHARS) {
                    return JSON.stringify({ error: `query must be at most ${MAX_QUERY_CHARS} characters` })
                }
                const needle = `%${escapeLike(query.trim())}%`
                const rows = await ctx.db.withTenant(ctx.tenantId, (trx) =>
                    trx
                        .selectFrom('tickets')
                        .select(['ref', 'subject', 'status', 'assignee_user_id'])
                        .where('org_id', '=', ctx.orgId)
                        .where((eb) => eb.or([eb('subject', 'ilike', needle), eb('body', 'ilike', needle)]))
                        .orderBy('created_at', 'desc')
                        .execute(),
                )
                const tickets: TicketFact[] = rows.map((r) => ({
                    ref: r.ref,
                    subject: r.subject,
                    status: r.status,
                    assigned: r.assignee_user_id !== null,
                }))
                return JSON.stringify({ query, tickets })
            },
        },
    ],
}

/**
 * The SECOND pass, and the one that streams. Once the tool loop has gathered facts, the route asks the
 * llm port to compose the reply with `llm.stream()`, so the answer arrives in the browser a chunk at a
 * time instead of after a silent pause. It is a separate fixture PURPOSE because its prompt necessarily
 * carries live ticket data: a request built from real rows can never hash-match a recorded entry, so it
 * resolves to this purpose's DEFAULT entry — deterministic, and authored to read like a real answer,
 * without polluting the tool-loop purpose's own fallback (keel/adapters/fake/llm.ts).
 *
 * Live data still reaches the screen: the route returns the tickets the TOOLS actually read as the
 * answer's sources, so the prose is replayed and the evidence beside it is real.
 */
export const assistantComposePurpose = 'assistant-desk-compose'

export const ASSISTANT_COMPOSE_SYSTEM =
    'You are the assistant for a support desk. Using only the ticket facts you have been given, ' +
    "answer the agent's question in two or three sentences. Refer to tickets by their reference."
