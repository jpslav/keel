import { type AcceptanceView, type AgreementView, isAgreementGating, isAgreementKind } from '../core/agreements'
import type { DbPort } from '../ports/db'
import { toIso } from './jobs'

/**
 * The agreements DB layer. Every function goes through db.withTenant — the tenant is the
 * WHOLE isolation boundary here (agreements are tenant-level, NOT org-scoped; migration 0013). Reads
 * feed the gate seam: the protected layout assembles a user's pending agreements from
 * listAgreementsForTenant + readAcceptancesForUser and hands them to packages/keel/src/core/gates.ts. Writes are the
 * append-only acceptance (recordAcceptance) and the version bump (bumpAgreementVersion) that re-arms
 * the gate for everyone.
 */

/** Map a DB agreements row to the core AgreementView, validating the two text-typed enums at the
 *  boundary (unknown kind/gating rows are dropped defensively — a stale row can't widen the type). */
function toAgreementView(row: {
    id: string
    kind: string
    version: number
    title: string
    body_md: string
    gating: string
}): AgreementView | null {
    if (!isAgreementKind(row.kind) || !isAgreementGating(row.gating)) return null
    return {
        id: row.id,
        kind: row.kind,
        version: Number(row.version),
        title: row.title,
        bodyMd: row.body_md,
        gating: row.gating,
    }
}

/** All current agreements for a tenant (the universe the gate registry is built from). */
export async function listAgreementsForTenant(db: DbPort, tenantId: string): Promise<AgreementView[]> {
    return db.withTenant(tenantId, async (trx) => {
        const rows = await trx
            .selectFrom('agreements')
            .select(['id', 'kind', 'version', 'title', 'body_md', 'gating'])
            .orderBy('created_at', 'asc')
            .execute()
        return rows.flatMap((r) => {
            const view = toAgreementView(r)
            return view ? [view] : []
        })
    })
}

/** One agreement by id (the accept route reads the CURRENT version to denormalize onto the acceptance —
 *  never trusting a client-supplied version). Null when absent in the tenant. */
export async function readAgreement(db: DbPort, tenantId: string, agreementId: string): Promise<AgreementView | null> {
    return db.withTenant(tenantId, async (trx) => {
        const row = await trx
            .selectFrom('agreements')
            .select(['id', 'kind', 'version', 'title', 'body_md', 'gating'])
            .where('id', '=', agreementId)
            .executeTakeFirst()
        return row ? toAgreementView(row) : null
    })
}

/** A user's acceptance rows (agreementId + the version they accepted), for the pending computation. */
export async function readAcceptancesForUser(db: DbPort, tenantId: string, userId: string): Promise<AcceptanceView[]> {
    return db.withTenant(tenantId, async (trx) => {
        const rows = await trx
            .selectFrom('agreement_acceptances')
            .select(['agreement_id', 'agreement_version', 'accepted_at'])
            .where('user_id', '=', userId)
            .execute()
        return rows.map((r) => ({
            agreementId: r.agreement_id,
            version: Number(r.agreement_version),
            acceptedAt: toIso(r.accepted_at),
        }))
    })
}

/** One acceptance joined to its agreement (title/kind), for the profile "which have I accepted" list.
 *  Newest first. A user only ever reads their OWN acceptances (the user_id filter + route authorize). */
export interface AcceptanceRecord {
    agreementId: string
    title: string
    kind: string
    version: number
    acceptedAt: string
}

export async function listUserAcceptanceRecords(
    db: DbPort,
    tenantId: string,
    userId: string,
): Promise<AcceptanceRecord[]> {
    return db.withTenant(tenantId, async (trx) => {
        const rows = await trx
            .selectFrom('agreement_acceptances as a')
            .innerJoin('agreements as g', 'g.id', 'a.agreement_id')
            .select([
                'a.agreement_id as agreement_id',
                'a.agreement_version as agreement_version',
                'a.accepted_at as accepted_at',
                'g.title as title',
                'g.kind as kind',
            ])
            .where('a.user_id', '=', userId)
            .orderBy('a.accepted_at', 'desc')
            .execute()
        return rows.map((r) => ({
            agreementId: r.agreement_id,
            title: r.title,
            kind: r.kind,
            version: Number(r.agreement_version),
            acceptedAt: toIso(r.accepted_at),
        }))
    })
}

/**
 * Record a user's acceptance of an agreement at a version (APPEND-ONLY — SELECT/INSERT grant only, no
 * update path). `agreementVersion` is the agreement's CURRENT version, read server-side by the caller;
 * the client never supplies it. `metadata` is minimal capture context (user-agent). Returns the new
 * acceptance id (for the audit subject).
 */
export async function recordAcceptance(
    db: DbPort,
    input: {
        tenantId: string
        agreementId: string
        agreementVersion: number
        userId: string
        metadata: Record<string, unknown>
    },
): Promise<{ id: string }> {
    return db.withTenant(input.tenantId, (trx) =>
        trx
            .insertInto('agreement_acceptances')
            .values({
                tenant_id: input.tenantId,
                agreement_id: input.agreementId,
                agreement_version: input.agreementVersion,
                user_id: input.userId,
                metadata: input.metadata,
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
    )
}

/**
 * Bump an agreement's version IN PLACE (version + 1, effective_at = now) — the demo story: re-arms the
 * gate for EVERYONE whose latest acceptance is now below the new version. Exercises the app_user UPDATE
 * grant through withTenant (the shape a real admin agreements UI would use). Returns the new version, or
 * null when the agreement is absent in the tenant.
 */
export async function bumpAgreementVersion(
    db: DbPort,
    tenantId: string,
    agreementId: string,
    now: Date,
): Promise<{ version: number } | null> {
    return db.withTenant(tenantId, async (trx) => {
        const current = await trx
            .selectFrom('agreements')
            .select('version')
            .where('id', '=', agreementId)
            .executeTakeFirst()
        if (!current) return null
        const nextVersion = Number(current.version) + 1
        await trx
            .updateTable('agreements')
            .set({ version: nextVersion, effective_at: now.toISOString() })
            .where('id', '=', agreementId)
            .execute()
        return { version: nextVersion }
    })
}
