import { exportKeyPrefix } from 'keel/core/jobs'
import { toIso } from 'keel/db/jobs'
import type { JobHandler } from 'keel/ports/jobs'

/**
 * RFC-4180 field escaping: quote when the value contains a comma, quote, CR, or LF. Fields opening
 * with a formula trigger (= + - @, tab, CR) get a leading apostrophe first — quoting alone does NOT
 * stop Excel/Sheets from evaluating `=…` in user-controlled cells (CSV formula injection). Ticket
 * subjects and bodies are written by CUSTOMERS, so this is not theoretical here.
 */
function csvField(value: string): string {
    const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
    return /[",\r\n]/.test(neutralized) ? `"${neutralized.replace(/"/g, '""')}"` : neutralized
}

/**
 * Exports the active team's queue as CSV to storage and returns the key — the desk's nightly SLA sweep
 * (the seeded `daily` schedule fires exactly this) and the on-demand button on the dashboard. Reads
 * tickets with the same tenant-scoped, org-filtered shape as GET /api/tickets. A null org (no active
 * team) has no queue to export, so it still produces a valid header-only file.
 */
export const exportTicketsHandler: JobHandler = async (_payload, ctx) => {
    const { db, storage, tenantId, orgId, jobId } = ctx
    const rows =
        orgId === null
            ? []
            : await db.withTenant(tenantId, (trx) =>
                  trx
                      .selectFrom('tickets')
                      .select(['ref', 'subject', 'status', 'assignee_user_id', 'created_at'])
                      .where('org_id', '=', orgId)
                      .orderBy('created_at', 'desc')
                      .execute(),
              )

    const header = 'ref,subject,status,assignee,created_at'
    const lines = rows.map((r) =>
        [
            csvField(r.ref),
            csvField(r.subject),
            csvField(r.status),
            csvField(r.assignee_user_id ?? ''),
            csvField(toIso(r.created_at)),
        ].join(','),
    )
    const csv = [header, ...lines].join('\n')

    const resultKey = `${exportKeyPrefix(tenantId, orgId)}${jobId}.csv`
    await storage.put(resultKey, csv, 'text/csv')
    return { resultKey }
}
