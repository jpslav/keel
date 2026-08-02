import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { LlmMessage, LlmPort, LlmRequest, LlmToolDef, LlmToolLoopRequest, LlmTurn } from '../../ports/llm'

/**
 * Deterministic replay of versioned fixtures (ADR-0009). Fixture files live in fixtures/llm/
 * (committed).
 *
 * Single-turn (`complete`/`stream`): lookup by exact hash of {model, system, messages} -> the
 * entry's `response`; else the purpose's default `response`; else a loud "record" error.
 *
 * Tool loops (`runToolLoop`): entries grow an optional `conversation` — the recorded
 * sequence of model outputs (assistant turns, incl. tool_use requests). REPLAY drives those turns
 * one at a time; between them the APP's `execute` runs LIVE against the fake world, so the tool
 * RESULTS are real even though the model's utterances are canned (the replay-honesty split). The
 * fixture never stores tool results. Matching is the same purpose+hash idea, extended to cover the
 * tools + messages shape, with the same default-entry fallback (a `response`-only default becomes
 * a one-turn text conversation).
 */

interface LlmFixtureEntry {
    name: string
    /** Free-form provenance (e.g. "hand-authored pending re-record") — ignored by replay. */
    note?: string
    /** null request = the purpose's default/fallback. */
    request: { model?: string; system?: string; messages: LlmMessage[]; tools?: LlmToolDef[] } | null
    /** Single-turn answer for complete/stream. */
    response: string | null
    /** Recorded model outputs for a tool loop (assistant turns incl. tool_use), turn by turn. */
    conversation?: LlmTurn[] | null
}

export interface LlmFixtureFile {
    purpose: string
    entries: LlmFixtureEntry[]
}

function hashLlmRequest(request: LlmRequest): string {
    const canonical = JSON.stringify({
        model: request.model ?? null,
        system: request.system ?? null,
        messages: request.messages,
    })
    return createHash('sha256').update(canonical).digest('hex')
}

/** Tool loops hash the tools + messages shape too, so an entry is matched to the request that
 *  built its tool set. Tools are canonicalized to their serializable {name, description,
 *  inputSchema} so the app's `execute` closure never enters the hash. */
function hashToolLoop(request: {
    model?: string
    system?: string
    messages: LlmMessage[]
    tools?: LlmToolDef[]
}): string {
    const canonical = JSON.stringify({
        model: request.model ?? null,
        system: request.system ?? null,
        messages: request.messages,
        tools: (request.tools ?? []).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
        })),
    })
    return createHash('sha256').update(canonical).digest('hex')
}

function fixturePath(purpose: string): string {
    if (!/^[a-z0-9-]+$/.test(purpose)) throw new Error(`invalid llm purpose: ${purpose}`)
    // Fixtures are app-scoped (apps/<app>/fixtures), and the working directory IS the app for every
    // command that runs the app (next dev/build, pnpm llm:record). APP_FIXTURES_DIR overrides that for
    // runners whose cwd is the repo root — the unit suite runs every app's tests in one pass from
    // there. Same override shape as APP_DATA_DIR.
    const root = process.env.APP_FIXTURES_DIR ?? path.join(process.cwd(), 'fixtures')
    return path.join(root, 'llm', `${purpose}.json`)
}

function readFixture(purpose: string): LlmFixtureFile {
    const file = fixturePath(purpose)
    if (!existsSync(file)) {
        throw new Error(`no llm fixtures for purpose "${purpose}" — create ${file} and run pnpm llm:record`)
    }
    return JSON.parse(readFileSync(file, 'utf8')) as LlmFixtureFile
}

function lookup(request: LlmRequest): string {
    const fixture = readFixture(request.purpose)
    const hash = hashLlmRequest(request)
    for (const entry of fixture.entries) {
        if (entry.request && entry.response !== null) {
            const entryHash = hashLlmRequest({ ...entry.request, purpose: request.purpose } as LlmRequest)
            if (entryHash === hash) return entry.response
        }
    }
    const fallback = fixture.entries.find((e) => e.request === null && e.response !== null)
    if (fallback?.response) return fallback.response
    throw new Error(
        `no matching llm fixture in ${fixturePath(request.purpose)} (hash ${hash.slice(0, 12)}…) and no default entry`,
    )
}

/** Resolve the recorded conversation (assistant model-outputs) for a tool-loop request. A default
 *  entry may carry a full `conversation` OR a single `response`, which becomes a one-turn text
 *  conversation — so a general question (no matching entry) still replays the deterministic answer. */
function lookupToolLoop(request: LlmToolLoopRequest): LlmTurn[] {
    const fixture = readFixture(request.purpose)
    const hash = hashToolLoop(request)
    for (const entry of fixture.entries) {
        if (entry.request && entry.conversation && entry.conversation.length > 0) {
            if (hashToolLoop(entry.request) === hash) return entry.conversation
        }
    }
    const fallback = fixture.entries.find((e) => e.request === null)
    if (fallback?.conversation && fallback.conversation.length > 0) return fallback.conversation
    if (fallback?.response) return [{ role: 'assistant', content: [{ type: 'text', text: fallback.response }] }]
    throw new Error(
        `no matching llm tool-loop fixture in ${fixturePath(request.purpose)} (hash ${hash.slice(0, 12)}…) and no default entry`,
    )
}

function textOf(turn: LlmTurn): string {
    return turn.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('')
}

export const fakeLlm: LlmPort = {
    async complete(request) {
        return { text: lookup(request) }
    },

    async *stream(request) {
        // Word-chunked so streaming UIs exercise their incremental path deterministically.
        for (const chunk of lookup(request).split(/(?<= )/)) yield chunk
    },

    async runToolLoop(request) {
        const conversation = lookupToolLoop(request)
        const turns: LlmTurn[] = []
        const maxTurns = request.maxTurns ?? 6
        for (let i = 0; i < conversation.length && i < maxTurns; i++) {
            const assistantTurn = conversation[i]!
            turns.push(assistantTurn)
            const toolUses = assistantTurn.content.filter(
                (b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use',
            )
            if (toolUses.length === 0) return { text: textOf(assistantTurn), turns }
            // Relay each tool_use to the app's executor LIVE — the result is real, not canned.
            const resultBlocks: LlmTurn['content'] = []
            for (const call of toolUses) {
                // Defense-in-depth: a tool_use naming a tool the app never supplied (a hand-edited
                // fixture, say) is refused here, before any execute dispatch could mis-route it.
                const known = request.tools.some((t) => t.name === call.name)
                const result = known
                    ? await request.execute({ name: call.name, input: call.input })
                    : `unknown tool: ${call.name}`
                resultBlocks.push({ type: 'tool_result', toolUseId: call.id, content: result })
            }
            turns.push({ role: 'user', content: resultBlocks })
        }
        // Ran out of recorded turns (or hit maxTurns) with no terminal text-only turn: return the
        // last assistant text we have rather than throwing — a truncated replay is still honest.
        const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')
        return { text: lastAssistant ? textOf(lastAssistant) : '', turns }
    },
}
