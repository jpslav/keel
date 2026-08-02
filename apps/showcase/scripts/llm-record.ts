/**
 * (Re)records LLM fixtures against the real Anthropic API (ADR-0009).
 *
 * WHY IT LIVES IN THE APP rather than in the repo's `scripts/`: it is app code. It reads the APP's
 * assistant registration through the seam (`@app-config/assistant`) and writes the APP's own
 * `fixtures/llm/`, so it belongs to whichever app owns those — and the repo's root TypeScript program
 * (whose `@app-config/*` points at keel's test fixture) has no business compiling one app's seam.
 *
 * Single-turn entries: fills/overwrites `response` (entries with response !== null are skipped
 * unless --all).
 *
 * Tool-loop entries (those carrying a `conversation`): drives the REAL adapter's
 * runToolLoop with the app's tool executor — pulled from TOOL_LOOP_RECORDERS and run against the
 * FAKE adapters (fake db, seeded world) — then writes the model's assistant turns back to
 * `conversation`. This is the replay-honesty split at record time too: the model's utterances come
 * from the live API, the tool RESULTS from the live fake world (never stored in the fixture). Such
 * entries are skipped unless --all so hand-authored conversations survive until a real re-record.
 *
 * AUTHORED — CUTOVER (`llm-key`): unexercised until an ANTHROPIC_API_KEY exists. Honest
 * limits without a key: nothing here runs, so hand-authored conversations stand as-is; and a
 * purpose that has a tool-loop entry but no registered recorder is reported and left untouched
 * (the script can't invent the app's execute for a purpose it doesn't know).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { assistantConfig } from '@app-config/assistant'
import { fakeDb } from 'keel/adapters/fake/db'
import type { LlmFixtureFile } from 'keel/adapters/fake/llm'
import { createRealLlm } from 'keel/adapters/real/llm'
import { listOrgsInTenant, orgIdForSlug } from 'keel/db/org-lookup'
import { tenantIdForSlug } from 'keel/db/tenant-lookup'
import type { LlmRequest, LlmToolLoopRequest } from 'keel/ports/llm'
import { assistantExecutor } from 'keel/server-lib/assistant'

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set — see cutover row `llm-key`.')
    process.exit(1)
}

const recordAll = process.argv.includes('--all')
const llm = createRealLlm(apiKey)
const dir = path.join(process.cwd(), 'fixtures', 'llm')

type ToolLoopExecutor = (call: { name: string; input: unknown }) => Promise<string>

/**
 * Per-purpose tool executors, mirroring the app's route glue but wired to the FAKE adapters. Keyed
 * by fixture purpose. A tool-loop entry whose purpose is absent here is left hand-authored.
 */
const TOOL_LOOP_RECORDERS: Record<string, () => Promise<ToolLoopExecutor>> = {
    // Dispatches over the registered assistantConfig tools (the SAME executor the route builds), wired
    // to the FAKE adapters and resolved against a real caller in the seeded fake world (tenant northwind,
    // its first org). Notes start empty, so a fresh record captures the model summarizing an empty
    // list — the seeded desk queue gives it real rows to talk about.
    [assistantConfig.purpose]: async () => {
        const tenantId = await tenantIdForSlug(fakeDb, 'northwind')
        if (!tenantId) throw new Error('fake world is missing tenant "northwind"')
        const orgs = await listOrgsInTenant(fakeDb, tenantId)
        const orgSlug = orgs[0]?.slug
        const orgId = orgSlug ? await orgIdForSlug(fakeDb, tenantId, orgSlug) : null
        if (!orgId) throw new Error('fake world is missing an org in tenant "northwind"')
        return assistantExecutor(assistantConfig, { db: fakeDb, tenantId, orgId })
    },
}

/**
 * The work lives in `main()` rather than at module level because neither package.json declares
 * `"type": "module"`, so `tsx` transforms this file as CommonJS and esbuild rejects top-level
 * `await` outright — a transform error, thrown before any of this file's own code runs, which made
 * the friendly `ANTHROPIC_API_KEY is not set` message above unreachable. Renaming to `.mts` clears
 * the transform but breaks `@app-config/seed`'s named-export interop; the wrapper is the fix.
 */
async function main() {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        const fixturePath = path.join(dir, file)
        const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as LlmFixtureFile
        let changed = false
        for (const entry of fixture.entries) {
            if (!entry.request) continue

            // Tool-loop entry: drive the real loop with the app's execute against the fake world.
            if (Array.isArray(entry.conversation)) {
                if (entry.conversation.length > 0 && !recordAll) continue
                const makeExecutor = TOOL_LOOP_RECORDERS[fixture.purpose]
                if (!makeExecutor) {
                    console.warn(
                        `skip tool-loop ${fixture.purpose}/${entry.name}: no recorder registered — leaving the hand-authored conversation as-is`,
                    )
                    continue
                }
                const request: LlmToolLoopRequest = {
                    purpose: fixture.purpose,
                    system: entry.request.system,
                    messages: entry.request.messages,
                    tools: entry.request.tools ?? [],
                    execute: await makeExecutor(),
                }
                console.log(`recording tool loop ${fixture.purpose}/${entry.name}…`)
                const result = await llm.runToolLoop(request)
                // Persist ONLY the model's assistant turns; tool results stay live (replay honesty).
                entry.conversation = result.turns.filter((t) => t.role === 'assistant')
                changed = true
                continue
            }

            // Single-turn entry.
            if (entry.response !== null && !recordAll) continue
            const request: LlmRequest = { purpose: fixture.purpose, ...entry.request } as LlmRequest
            console.log(`recording ${fixture.purpose}/${entry.name}…`)
            const { text } = await llm.complete(request)
            entry.response = text
            changed = true
        }
        if (changed) {
            writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 4)}\n`)
            console.log(`wrote ${fixturePath}`)
        }
    }
    console.log('done')
}

void main()
