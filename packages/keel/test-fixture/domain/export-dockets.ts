import { exportKeyPrefix } from 'keel/core/jobs'
import type { JobHandler } from 'keel/ports/jobs'

/**
 * The fixture's ONE app job kind, `export-dockets`: read the active team's rows, write a CSV artifact
 * to storage under the framework's export namespace, return the key.
 *
 * It is the smallest handler that still exercises everything keel's job machinery has to do — a
 * tenant-scoped read through `withTenant`, a storage write, and a `resultKey` the adapter records on
 * the completed job. `adapters/fake/jobs.test.ts` drives it end to end (timeline, artifact,
 * re-runnable artifact production) and `server-lib/notify.test.ts` needs it to exist at all, because
 * NOTIFIED_JOB_KINDS is built from `appJobKinds`: without one app kind, "an app kind notifies while the
 * framework's own digest-email does not" is not a distinction the suite can make.
 *
 * Deliberately NOT a copy of the showcase's CSV escaping: the artifact's exact bytes are the app's
 * business, and the fixture only needs the file to exist and to carry a row it can recognise.
 */
export const exportDocketsHandler: JobHandler = async (_payload, ctx) => {
    const { db, storage, tenantId, orgId, jobId } = ctx
    const rows =
        orgId === null
            ? []
            : await db.withTenant(tenantId, (trx) =>
                  trx
                      .selectFrom('dockets')
                      .select(['label', 'status'])
                      .where('org_id', '=', orgId)
                      .orderBy('created_at', 'desc')
                      .execute(),
              )

    const csv = ['label,status', ...rows.map((r) => `${r.label},${r.status}`)].join('\n')
    const resultKey = `${exportKeyPrefix(tenantId, orgId)}${jobId}.csv`
    await storage.put(resultKey, csv, 'text/csv')
    return { resultKey }
}
