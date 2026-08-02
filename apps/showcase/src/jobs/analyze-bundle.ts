import { exportKeyPrefix } from 'keel/core/jobs'
import type { JobHandler } from 'keel/ports/jobs'
import { ANALYZABLE_KIND } from '@/domain/attachments'

/** How much of a bundle is shown to the model. A ceiling, not a guess: a log bundle can be megabytes,
 *  and the prompt is a cost and a latency, so the handler reads the head and says that it did. */
const BUNDLE_PROMPT_CHARS = 4_000

const ANALYSIS_SYSTEM =
    'You are a support engineer reading a diagnostic bundle from a customer system. ' +
    'Summarize what failed and suggest one concrete next step. Be brief and concrete; ' +
    'if the bundle is inconclusive, say so rather than guessing.'

/**
 * The desk's SECOND job kind, and the point of having a second one: it has a materially different
 * shape from `export-tickets`. Where the export reads app rows and writes a file, this one reads an
 * app row, reads BYTES out of storage, calls the LLM PORT, and writes the model's answer back as an
 * artifact. Same JobHandler contract, three ports instead of two — which is what proves the registry
 * composes rather than merely existing.
 *
 * It is also the only caller of `llm.complete()`. Determinism is unchanged: in simulated mode the port
 * replays a committed fixture, and because the prompt carries LIVE bundle bytes it will not hash-match
 * a recorded entry, so replay falls through to the purpose's DEFAULT entry — which is authored to read
 * like a real analysis. That fall-through is the fixture mechanism working as designed (see
 * keel/adapters/fake/llm.ts): a canned utterance over a live effect.
 *
 * The payload names WHICH attachment to analyze: `{ attachmentId }`. An absent or foreign id is a
 * handler ERROR (the job fails and says why) rather than a silent empty analysis — a job that reports
 * success having analyzed nothing is worse than one that fails.
 */
export const analyzeBundleHandler: JobHandler = async (payload, ctx) => {
    const { db, storage, llm, tenantId, orgId, jobId } = ctx
    const attachmentId = (payload as { attachmentId?: unknown } | null)?.attachmentId
    if (typeof attachmentId !== 'string' || orgId === null) {
        throw new Error('analyze-bundle requires an attachmentId and an org-scoped job')
    }

    // Org-scoped read, exactly like the attachments route: another team's bundle is indistinguishable
    // from a missing one, so a job payload can never be used to reach across the team boundary.
    const row = await db.withTenant(tenantId, (trx) =>
        trx
            .selectFrom('attachments')
            .select(['filename', 'kind', 'storage_key', 'status'])
            .where('id', '=', attachmentId)
            .where('org_id', '=', orgId)
            .executeTakeFirst(),
    )
    if (!row || row.status !== 'ready') throw new Error(`no ready attachment ${attachmentId} for this team`)
    if (row.kind !== ANALYZABLE_KIND) throw new Error(`attachment ${attachmentId} is not a ${ANALYZABLE_KIND}`)

    const object = await storage.get(row.storage_key)
    if (!object) throw new Error(`attachment ${attachmentId} has no stored bytes`)
    const text = new TextDecoder().decode(object.body)
    const excerpt = text.slice(0, BUNDLE_PROMPT_CHARS)
    const truncated = text.length > BUNDLE_PROMPT_CHARS

    // TRUST: the bundle is customer-supplied content flowing into the model's context, so its output is
    // UNTRUSTED — the handler only STORES it (it never branches on it, and no privileged action reads
    // it). See the trust model in keel/ports/llm.ts.
    const { text: analysis } = await llm.complete({
        purpose: 'bundle-analysis',
        system: ANALYSIS_SYSTEM,
        messages: [
            {
                role: 'user',
                content: `Diagnostic bundle "${row.filename}"${truncated ? ' (first part only)' : ''}:\n\n${excerpt}`,
            },
        ],
    })

    const document = [`# Bundle analysis — ${row.filename}`, '', analysis].join('\n')
    const resultKey = `${exportKeyPrefix(tenantId, orgId)}${jobId}.md`
    await storage.put(resultKey, document, 'text/markdown')
    return { resultKey }
}
