import { sql, type Kysely } from 'kysely'
import { KEYSET_MAX_LIMIT, encodeKeysetCursor } from '../core/keyset'
import type { DbPort } from '../ports/db'
import { jsonb } from './jsonb'
import { keysetPage, parseDbKeysetCursor } from './keyset'
import type { DB } from './schema'
import { runWithTenant } from './with-tenant'

/**
 * THE tenant-isolation proof suite (ADR-0004) — the FRAMEWORK half. Engine-agnostic on purpose: the
 * pglite unit test and the embedded-postgres/CI-service contract test run these exact assertions
 * against the real migrations, so if the fakes ever drift from real Postgres, one of the two breaks.
 *
 * FRAMEWORK/APP LINE (ADR-0012): this file touches ONLY framework tables (migrations 0001–0999) and
 * FRAMEWORK vocabulary — the job kind `digest-email`, the audit verb `membership.invited`, the
 * notification kind `org.invited`, the webhook event kind `job.status_changed`. That is what makes it
 * a framework asset: delete the demo app and keel still proves its own tenancy. The app's own tables
 * are proved by its seam module (src/app-config/db/rls-proofs.ts, conforming to `RlsProofSuite`
 * below); ./rls-proof-runner composes the two and runs them as ONE suite on both engines.
 *
 * Returns nothing; throws (via the injected expect) on any violation.
 */
export interface ProofExpectation {
    toBe(expected: unknown): void
}

/**
 * The fixtures both halves share, seeded by the runner as the privileged migration user before either
 * half runs. Two tenants to isolate against, plus one organization inside EACH: the org-scoped tables
 * on both sides of the line need a valid org id on the right tenant, and their cross-tenant WITH CHECK
 * proofs need a valid org id on the WRONG tenant — so that the rejection is attributable to the tenant
 * boundary and not to a fabricated foreign key.
 */
export interface RlsProofContext {
    db: Kysely<DB>
    /**
     * The same handle behind the `DbPort` interface, so a proof can drive PRODUCT code that takes the
     * port — `keysetPage`, which opens its own `withTenant` transaction — instead of re-implementing it
     * and proving a copy. Built by the runner.
     */
    dbPort: DbPort
    /** Injected, not imported, so one suite runs unchanged under both vitest configs (unit + contract). */
    expect: (actual: unknown) => ProofExpectation
    alphaTenantId: string
    demoTenantId: string
    /** An organization under `alphaTenantId`. */
    alphaOrgId: string
    /** An organization under `demoTenantId` — a VALID org id on the WRONG tenant. */
    demoOrgId: string
}

/**
 * The contract an RLS proof suite conforms to: the framework's half below, and the app's half on the
 * seam (src/app-config/db/rls-proofs.ts). An adopter with no tenant tables of its own registers a
 * no-op — "unused capability = empty registration" (ADR-0012).
 */
export type RlsProofSuite = (context: RlsProofContext) => Promise<void>

export const frameworkRlsProofs: RlsProofSuite = async ({
    db,
    dbPort,
    expect,
    alphaTenantId,
    demoTenantId,
    alphaOrgId,
    demoOrgId,
}) => {
    // ---- jobs + job_status_changes: tenant isolation, plus an append-only history ----
    //
    // The framework's first-class tenant-scoped table (0004), and therefore where the BASE guarantees
    // are proved: read isolation both directions, the negative control that proves those reads aren't
    // passing vacuously, fail-closed with the role set but no tenant context, and WITH CHECK on write.
    // `digest-email` is the framework's own job kind (keel/core/jobs.ts FRAMEWORK_JOB_KINDS) — the kind
    // is incidental to the isolation being proved, and app kinds are the app suite's business.

    // seed one job + its opening timeline row per tenant, as the privileged migration user
    const [alphaJob] = await db
        .insertInto('jobs')
        .values({ tenant_id: alphaTenantId, kind: 'digest-email', payload: { scope: 'alpha' } })
        .returning('id')
        .execute()
    const [demoJob] = await db
        .insertInto('jobs')
        .values({ tenant_id: demoTenantId, kind: 'digest-email', payload: { scope: 'demo' } })
        .returning('id')
        .execute()
    await db
        .insertInto('job_status_changes')
        .values([
            { tenant_id: alphaTenantId, job_id: alphaJob!.id, status: 'queued', message: null },
            { tenant_id: demoTenantId, job_id: demoJob!.id, status: 'queued', message: null },
        ])
        .execute()

    // jsonb payload round-trips as a parsed object (read as the privileged user)
    const [alphaJobRow] = await db.selectFrom('jobs').select('payload').where('id', '=', alphaJob!.id).execute()
    expect((alphaJobRow!.payload as { scope: string }).scope).toBe('alpha')

    // read isolation, both directions, on BOTH tables, via UNFILTERED selects under RLS
    const alphaJobs = await runWithTenant(db, alphaTenantId, (trx) => trx.selectFrom('jobs').selectAll().execute())
    expect(alphaJobs.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(alphaJobs.filter((r) => r.tenant_id === alphaTenantId).length).toBe(1)
    const demoJobs = await runWithTenant(db, demoTenantId, (trx) => trx.selectFrom('jobs').selectAll().execute())
    expect(demoJobs.filter((r) => r.tenant_id === alphaTenantId).length).toBe(0)
    expect(demoJobs.filter((r) => r.tenant_id === demoTenantId).length).toBe(1)

    // negative control: WITHOUT SET LOCAL ROLE the privileged user bypasses RLS — proves the isolation
    // assertions above aren't passing vacuously
    const allJobs = await db.selectFrom('jobs').selectAll().execute()
    expect(allJobs.length >= 2).toBe(true)

    // fail-closed: role set, no tenant context -> zero rows (and no cast error)
    const noContextJobs = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL ROLE app_user`.execute(trx)
        return trx.selectFrom('jobs').selectAll().execute()
    })
    expect(noContextJobs.length).toBe(0)

    const alphaChanges = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('job_status_changes').selectAll().execute(),
    )
    expect(alphaChanges.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(alphaChanges.filter((r) => r.tenant_id === alphaTenantId).length).toBe(1)
    const demoChanges = await runWithTenant(db, demoTenantId, (trx) =>
        trx.selectFrom('job_status_changes').selectAll().execute(),
    )
    expect(demoChanges.filter((r) => r.tenant_id === alphaTenantId).length).toBe(0)
    expect(demoChanges.filter((r) => r.tenant_id === demoTenantId).length).toBe(1)

    // write isolation on jobs: INSERT carrying the other tenant's id is rejected by WITH CHECK
    let jobWriteRejected = false
    try {
        await runWithTenant(db, alphaTenantId, (trx) =>
            trx.insertInto('jobs').values({ tenant_id: demoTenantId, kind: 'digest-email', payload: {} }).execute(),
        )
    } catch (error) {
        jobWriteRejected = /row-level security/.test(String(error))
    }
    expect(jobWriteRejected).toBe(true)

    // append-only history: as app_user (with tenant context set) an UPDATE on job_status_changes
    // FAILS at the privilege layer — the table's only grants are SELECT, INSERT
    let changeUpdateRejected = false
    try {
        await db.transaction().execute(async (trx) => {
            await sql`SET LOCAL ROLE app_user`.execute(trx)
            await sql`SELECT set_config('app.current_tenant', ${alphaTenantId}, true)`.execute(trx)
            await sql`UPDATE job_status_changes SET message = 'tampered'`.execute(trx)
        })
    } catch (error) {
        changeUpdateRejected = /permission denied/.test(String(error))
    }
    expect(changeUpdateRejected).toBe(true)

    // ...and a DELETE fails the same way — history rows can never be erased
    let changeDeleteRejected = false
    try {
        await db.transaction().execute(async (trx) => {
            await sql`SET LOCAL ROLE app_user`.execute(trx)
            await sql`SELECT set_config('app.current_tenant', ${alphaTenantId}, true)`.execute(trx)
            await sql`DELETE FROM job_status_changes`.execute(trx)
        })
    } catch (error) {
        changeDeleteRejected = /permission denied/.test(String(error))
    }
    expect(changeDeleteRejected).toBe(true)

    // ---- service_keys: infra table (NO RLS), SELECT-only at the privilege layer ----

    // one service key under alpha's org, seeded as the privileged migration user
    await db
        .insertInto('service_keys')
        .values({ tenant_id: alphaTenantId, org_id: alphaOrgId, public_key_pem: '-----BEGIN PUBLIC KEY-----proof' })
        .execute()

    // app_user CAN SELECT service_keys — verification reads these during request auth (no RLS, so
    // the row is visible even with tenant context set to alpha)
    const keyRows = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('service_keys').selectAll().execute(),
    )
    expect(keyRows.some((r) => r.org_id === alphaOrgId)).toBe(true)

    // ...but INSERT fails at the privilege layer — only SELECT is granted (writes are owner-only)
    let keyInsertRejected = false
    try {
        await db.transaction().execute(async (trx) => {
            await sql`SET LOCAL ROLE app_user`.execute(trx)
            await sql`SELECT set_config('app.current_tenant', ${alphaTenantId}, true)`.execute(trx)
            await sql`INSERT INTO service_keys (tenant_id, org_id, public_key_pem)
                      VALUES (${alphaTenantId}, ${alphaOrgId}, 'smuggled')`.execute(trx)
        })
    } catch (error) {
        keyInsertRejected = /permission denied/.test(String(error))
    }
    expect(keyInsertRejected).toBe(true)

    // ...and UPDATE fails the same way — a key row can never be rewritten by the app role
    let keyUpdateRejected = false
    try {
        await db.transaction().execute(async (trx) => {
            await sql`SET LOCAL ROLE app_user`.execute(trx)
            await sql`SELECT set_config('app.current_tenant', ${alphaTenantId}, true)`.execute(trx)
            await sql`UPDATE service_keys SET public_key_pem = 'tampered'`.execute(trx)
        })
    } catch (error) {
        keyUpdateRejected = /permission denied/.test(String(error))
    }
    expect(keyUpdateRejected).toBe(true)

    // ...and DELETE fails the same way — revocation is an owner-only write
    let keyDeleteRejected = false
    try {
        await db.transaction().execute(async (trx) => {
            await sql`SET LOCAL ROLE app_user`.execute(trx)
            await sql`SELECT set_config('app.current_tenant', ${alphaTenantId}, true)`.execute(trx)
            await sql`DELETE FROM service_keys`.execute(trx)
        })
    } catch (error) {
        keyDeleteRejected = /permission denied/.test(String(error))
    }
    expect(keyDeleteRejected).toBe(true)

    // ---- audit_events: tenant-only RLS, org_id NOT NULL, APPEND-ONLY (SELECT/INSERT, no UPDATE/DELETE) ----
    //
    // The compliance-grade product record. Same tenant-only RLS shape as jobs. Two extra guarantees:
    // the audit trail is immutable at the privilege layer (the job_status_changes precedent) — neither
    // an UPDATE nor a DELETE is granted, so a recorded event can never be rewritten or erased.
    // `membership.invited` / `Membership` are FRAMEWORK vocabulary (keel/db/audit.ts,
    // keel/core/abilities.ts); the app's own verbs are exercised by the app suite.

    // One audit event per tenant, seeded as the privileged migration user (using each tenant's org).
    await db
        .insertInto('audit_events')
        .values([
            {
                tenant_id: alphaTenantId,
                org_id: alphaOrgId,
                actor_user_id: 'proof-user',
                action: 'membership.invited',
                subject_type: 'Membership',
                subject_id: 'membership-alpha',
            },
            {
                tenant_id: demoTenantId,
                org_id: demoOrgId,
                actor_user_id: 'proof-user',
                action: 'membership.invited',
                subject_type: 'Membership',
                subject_id: 'membership-demo',
            },
        ])
        .execute()

    // (a) tenant isolation, both directions, via UNFILTERED selects under RLS.
    const alphaAudit = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('audit_events').selectAll().execute(),
    )
    expect(alphaAudit.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(alphaAudit.filter((r) => r.tenant_id === alphaTenantId).length).toBe(1)
    const demoAudit = await runWithTenant(db, demoTenantId, (trx) =>
        trx.selectFrom('audit_events').selectAll().execute(),
    )
    expect(demoAudit.filter((r) => r.tenant_id === alphaTenantId).length).toBe(0)
    expect(demoAudit.filter((r) => r.tenant_id === demoTenantId).length).toBe(1)

    // (a) write isolation: INSERT carrying the OTHER tenant's id is rejected by WITH CHECK, even with a
    // valid demo org id — the tenant, not the org, is the RLS boundary.
    let auditWriteRejected = false
    try {
        await runWithTenant(db, alphaTenantId, (trx) =>
            trx
                .insertInto('audit_events')
                .values({
                    tenant_id: demoTenantId,
                    org_id: demoOrgId,
                    actor_user_id: 'proof-user',
                    action: 'membership.invited',
                    subject_type: 'Membership',
                    subject_id: 'smuggled',
                })
                .execute(),
        )
    } catch (error) {
        auditWriteRejected = /row-level security/.test(String(error))
    }
    expect(auditWriteRejected).toBe(true)

    // (b) append-only: as app_user (with tenant context set) an UPDATE FAILS at the privilege layer —
    // the table's only grants are SELECT, INSERT.
    let auditUpdateRejected = false
    try {
        await db.transaction().execute(async (trx) => {
            await sql`SET LOCAL ROLE app_user`.execute(trx)
            await sql`SELECT set_config('app.current_tenant', ${alphaTenantId}, true)`.execute(trx)
            await sql`UPDATE audit_events SET action = 'tampered'`.execute(trx)
        })
    } catch (error) {
        auditUpdateRejected = /permission denied/.test(String(error))
    }
    expect(auditUpdateRejected).toBe(true)

    // ...and a DELETE fails the same way — audit rows can never be erased.
    let auditDeleteRejected = false
    try {
        await db.transaction().execute(async (trx) => {
            await sql`SET LOCAL ROLE app_user`.execute(trx)
            await sql`SELECT set_config('app.current_tenant', ${alphaTenantId}, true)`.execute(trx)
            await sql`DELETE FROM audit_events`.execute(trx)
        })
    } catch (error) {
        auditDeleteRejected = /permission denied/.test(String(error))
    }
    expect(auditDeleteRejected).toBe(true)

    // ---- job_schedules: tenant-only RLS, full SELECT/INSERT/UPDATE/DELETE grant ----
    //
    // Same tenant-isolation shape as jobs; org_id is an app-level filter, not an RLS anchor. The
    // one extra guarantee proved here is that the scheduler's advance path — a scoped UPDATE of
    // next_run_at — succeeds under RLS (it is how the due-scan marks a schedule fired).
    const [schedOrgAlpha] = await db
        .insertInto('organizations')
        .values({ tenant_id: alphaTenantId, slug: `sched-a-${Date.now()}`, name: 'Sched Org A' })
        .returning('id')
        .execute()
    const [schedOrgDemo] = await db
        .insertInto('organizations')
        .values({ tenant_id: demoTenantId, slug: `sched-d-${Date.now()}`, name: 'Sched Org D' })
        .returning('id')
        .execute()

    const weeklySpec = { type: 'weekly', utcDay: 1, atUtcHour: 13, atUtcMinute: 0 }
    const [alphaSchedule] = await db
        .insertInto('job_schedules')
        .values({
            tenant_id: alphaTenantId,
            org_id: schedOrgAlpha!.id,
            kind: 'digest-email',
            spec: weeklySpec,
            next_run_at: new Date('2026-08-03T13:00:00.000Z'),
            created_by: 'proof',
        })
        .returning('id')
        .execute()
    await db
        .insertInto('job_schedules')
        .values({
            tenant_id: demoTenantId,
            org_id: schedOrgDemo!.id,
            kind: 'digest-email',
            spec: weeklySpec,
            next_run_at: new Date('2026-08-03T13:00:00.000Z'),
            created_by: 'proof',
        })
        .execute()

    // read isolation, both directions, via UNFILTERED selects under RLS
    const alphaScheds = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('job_schedules').selectAll().execute(),
    )
    expect(alphaScheds.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(alphaScheds.filter((r) => r.tenant_id === alphaTenantId).length).toBe(1)
    const demoScheds = await runWithTenant(db, demoTenantId, (trx) =>
        trx.selectFrom('job_schedules').selectAll().execute(),
    )
    expect(demoScheds.filter((r) => r.tenant_id === alphaTenantId).length).toBe(0)
    expect(demoScheds.filter((r) => r.tenant_id === demoTenantId).length).toBe(1)

    // write isolation: INSERT carrying the other tenant's id is rejected by WITH CHECK
    let scheduleWriteRejected = false
    try {
        await runWithTenant(db, alphaTenantId, (trx) =>
            trx
                .insertInto('job_schedules')
                .values({
                    tenant_id: demoTenantId,
                    org_id: schedOrgDemo!.id,
                    kind: 'digest-email',
                    spec: weeklySpec,
                    next_run_at: new Date('2026-08-03T13:00:00.000Z'),
                    created_by: 'smuggled',
                })
                .execute(),
        )
    } catch (error) {
        scheduleWriteRejected = /row-level security/.test(String(error))
    }
    expect(scheduleWriteRejected).toBe(true)

    // the scheduler's advance path: a scoped UPDATE of next_run_at succeeds under RLS
    await runWithTenant(db, alphaTenantId, (trx) =>
        trx
            .updateTable('job_schedules')
            .set({ next_run_at: new Date('2026-08-10T13:00:00.000Z') })
            .where('id', '=', alphaSchedule!.id)
            .execute(),
    )
    const afterAdvance = await runWithTenant(db, alphaTenantId, (trx) =>
        trx
            .selectFrom('job_schedules')
            .select('next_run_at')
            .where('id', '=', alphaSchedule!.id)
            .executeTakeFirstOrThrow(),
    )
    expect(new Date(afterAdvance.next_run_at).toISOString()).toBe('2026-08-10T13:00:00.000Z')

    // ---- webhook_endpoints + webhook_deliveries: tenant-only RLS ----
    //
    // Same tenant-isolation shape as jobs; org_id is an app-level filter, not an RLS anchor.
    // webhook_endpoints has the full CRUD grant (the org-admin card enables/disables/deletes).
    // webhook_deliveries is SELECT/INSERT/UPDATE — the retry drain UPDATEs status/attempts in place —
    // with NO DELETE grant (a delivery is a durable egress record, the audit_events no-DELETE precedent).
    const [hookOrgAlpha] = await db
        .insertInto('organizations')
        .values({ tenant_id: alphaTenantId, slug: `hook-a-${Date.now()}`, name: 'Hook Org A' })
        .returning('id')
        .execute()
    const [hookOrgDemo] = await db
        .insertInto('organizations')
        .values({ tenant_id: demoTenantId, slug: `hook-d-${Date.now()}`, name: 'Hook Org D' })
        .returning('id')
        .execute()

    const [alphaEndpoint] = await db
        .insertInto('webhook_endpoints')
        .values({
            tenant_id: alphaTenantId,
            org_id: hookOrgAlpha!.id,
            url: 'https://alpha.example.test/hook',
            secret: 'alpha-secret',
            event_kinds: jsonb(['job.status_changed']),
            created_by: 'proof',
        })
        .returning('id')
        .execute()
    await db
        .insertInto('webhook_endpoints')
        .values({
            tenant_id: demoTenantId,
            org_id: hookOrgDemo!.id,
            url: 'https://demo.example.test/hook',
            secret: 'demo-secret',
            event_kinds: jsonb(['job.status_changed']),
            created_by: 'proof',
        })
        .execute()

    // read isolation, both directions, via UNFILTERED selects under RLS
    const alphaEndpoints = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('webhook_endpoints').selectAll().execute(),
    )
    expect(alphaEndpoints.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(alphaEndpoints.filter((r) => r.tenant_id === alphaTenantId).length).toBe(1)
    // jsonb event_kinds round-trips as a parsed array (read under RLS)
    expect((alphaEndpoints[0]!.event_kinds as string[])[0]).toBe('job.status_changed')
    const demoEndpoints = await runWithTenant(db, demoTenantId, (trx) =>
        trx.selectFrom('webhook_endpoints').selectAll().execute(),
    )
    expect(demoEndpoints.filter((r) => r.tenant_id === alphaTenantId).length).toBe(0)
    expect(demoEndpoints.filter((r) => r.tenant_id === demoTenantId).length).toBe(1)

    // write isolation: INSERT carrying the other tenant's id is rejected by WITH CHECK
    let endpointWriteRejected = false
    try {
        await runWithTenant(db, alphaTenantId, (trx) =>
            trx
                .insertInto('webhook_endpoints')
                .values({
                    tenant_id: demoTenantId,
                    org_id: hookOrgDemo!.id,
                    url: 'https://smuggled.example.test/hook',
                    secret: 'smuggled',
                    event_kinds: jsonb(['job.status_changed']),
                    created_by: 'smuggled',
                })
                .execute(),
        )
    } catch (error) {
        endpointWriteRejected = /row-level security/.test(String(error))
    }
    expect(endpointWriteRejected).toBe(true)

    // endpoints have a DELETE grant (the org-admin card removes them) — a scoped delete succeeds.
    await runWithTenant(db, alphaTenantId, (trx) =>
        trx.deleteFrom('webhook_endpoints').where('id', '=', alphaEndpoint!.id).execute(),
    )
    // re-seed one for the delivery FK below
    const [alphaEndpoint2] = await db
        .insertInto('webhook_endpoints')
        .values({
            tenant_id: alphaTenantId,
            org_id: hookOrgAlpha!.id,
            url: 'https://alpha.example.test/hook2',
            secret: 'alpha-secret-2',
            event_kinds: jsonb(['job.status_changed']),
            created_by: 'proof',
        })
        .returning('id')
        .execute()

    // one pending delivery per tenant, seeded as the privileged migration user
    const [alphaDelivery] = await db
        .insertInto('webhook_deliveries')
        .values({
            tenant_id: alphaTenantId,
            endpoint_id: alphaEndpoint2!.id,
            event_kind: 'job.status_changed',
            payload: { jobId: 'alpha-job' },
            next_attempt_at: new Date('2026-08-03T13:00:00.000Z'),
        })
        .returning('id')
        .execute()
    const [demoEndpointRow] = await db
        .selectFrom('webhook_endpoints')
        .select('id')
        .where('tenant_id', '=', demoTenantId)
        .execute()
    await db
        .insertInto('webhook_deliveries')
        .values({
            tenant_id: demoTenantId,
            endpoint_id: demoEndpointRow!.id,
            event_kind: 'job.status_changed',
            payload: { jobId: 'demo-job' },
            next_attempt_at: new Date('2026-08-03T13:00:00.000Z'),
        })
        .execute()

    // read isolation, both directions, on deliveries via UNFILTERED selects under RLS
    const alphaDeliveries = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('webhook_deliveries').selectAll().execute(),
    )
    expect(alphaDeliveries.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(alphaDeliveries.filter((r) => r.tenant_id === alphaTenantId).length).toBe(1)
    const demoDeliveries = await runWithTenant(db, demoTenantId, (trx) =>
        trx.selectFrom('webhook_deliveries').selectAll().execute(),
    )
    expect(demoDeliveries.filter((r) => r.tenant_id === alphaTenantId).length).toBe(0)
    expect(demoDeliveries.filter((r) => r.tenant_id === demoTenantId).length).toBe(1)

    // the drain's advance path: a scoped UPDATE of status/attempt_count/next_attempt_at succeeds under RLS
    await runWithTenant(db, alphaTenantId, (trx) =>
        trx
            .updateTable('webhook_deliveries')
            .set({ status: 'delivered', attempt_count: 1, delivered_at: new Date('2026-08-03T13:01:00.000Z') })
            .where('id', '=', alphaDelivery!.id)
            .execute(),
    )
    const afterDeliver = await runWithTenant(db, alphaTenantId, (trx) =>
        trx
            .selectFrom('webhook_deliveries')
            .select(['status', 'attempt_count'])
            .where('id', '=', alphaDelivery!.id)
            .executeTakeFirstOrThrow(),
    )
    expect(afterDeliver.status === 'delivered' && afterDeliver.attempt_count === 1).toBe(true)

    // endpoint delete cascades: removing an endpoint (a granted, tenant-scoped DELETE) also removes its
    // deliveries via ON DELETE CASCADE — under app_user + FORCE RLS, which is exactly why the app role
    // holds the DELETE grant on webhook_deliveries. After deleting alphaEndpoint2, alphaDelivery is gone.
    await runWithTenant(db, alphaTenantId, (trx) =>
        trx.deleteFrom('webhook_endpoints').where('id', '=', alphaEndpoint2!.id).execute(),
    )
    const afterCascade = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('webhook_deliveries').select('id').where('id', '=', alphaDelivery!.id).execute(),
    )
    expect(afterCascade.length).toBe(0)

    // ---- notifications + notification_prefs: tenant-only RLS ----
    //
    // Same tenant-isolation shape as jobs; org_id is an app-level filter, not an RLS anchor, and
    // recipient_user_id / user_id are further app-level scopes on top (a user only sees their own rows —
    // enforced at the route, not by RLS). `notifications` is SELECT/INSERT/UPDATE (mark-read UPDATEs
    // read_at in place) with NO DELETE grant; `notification_prefs` has the full CRUD grant (the profile
    // grid upserts and can clear a pref). `org.invited` is a FRAMEWORK kind (keel/core/notifications.ts).
    // Reuses hookOrgAlpha / hookOrgDemo from the webhook block.
    await db
        .insertInto('notifications')
        .values([
            {
                tenant_id: alphaTenantId,
                org_id: hookOrgAlpha!.id,
                recipient_user_id: 'user-alpha',
                kind: 'org.invited',
                payload: jsonb({ email: 'ada@example.test', role: 'admin', orgName: 'Hook Org A' }),
            },
            {
                tenant_id: demoTenantId,
                org_id: hookOrgDemo!.id,
                recipient_user_id: 'user-demo',
                kind: 'org.invited',
                payload: jsonb({ email: 'gale@example.test', role: 'member', orgName: 'Hook Org D' }),
            },
        ])
        .execute()

    // read isolation, both directions, via UNFILTERED selects under RLS
    const alphaNotifs = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('notifications').selectAll().execute(),
    )
    expect(alphaNotifs.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(alphaNotifs.filter((r) => r.tenant_id === alphaTenantId).length).toBe(1)
    const demoNotifs = await runWithTenant(db, demoTenantId, (trx) =>
        trx.selectFrom('notifications').selectAll().execute(),
    )
    expect(demoNotifs.filter((r) => r.tenant_id === alphaTenantId).length).toBe(0)

    // write isolation: INSERT carrying the other tenant's id is rejected by WITH CHECK
    let notifWriteRejected = false
    try {
        await runWithTenant(db, alphaTenantId, (trx) =>
            trx
                .insertInto('notifications')
                .values({
                    tenant_id: demoTenantId,
                    org_id: hookOrgDemo!.id,
                    recipient_user_id: 'smuggled',
                    kind: 'org.invited',
                    payload: jsonb({}),
                })
                .execute(),
        )
    } catch (error) {
        notifWriteRejected = /row-level security/.test(String(error))
    }
    expect(notifWriteRejected).toBe(true)

    // mark-read: a scoped UPDATE of read_at succeeds under RLS (the granted UPDATE path)
    await runWithTenant(db, alphaTenantId, (trx) =>
        trx
            .updateTable('notifications')
            .set({ read_at: new Date('2026-08-03T13:05:00.000Z') })
            .where('recipient_user_id', '=', 'user-alpha')
            .execute(),
    )
    const afterRead = await runWithTenant(db, alphaTenantId, (trx) =>
        trx
            .selectFrom('notifications')
            .select('read_at')
            .where('recipient_user_id', '=', 'user-alpha')
            .executeTakeFirstOrThrow(),
    )
    expect(afterRead.read_at !== null).toBe(true)

    // notification_prefs: seed one opt-out per tenant, prove read + write isolation and the full CRUD grant
    await db
        .insertInto('notification_prefs')
        .values([
            {
                tenant_id: alphaTenantId,
                org_id: hookOrgAlpha!.id,
                user_id: 'user-alpha',
                kind: 'org.invited',
                channel: 'email',
                enabled: false,
            },
            {
                tenant_id: demoTenantId,
                org_id: hookOrgDemo!.id,
                user_id: 'user-demo',
                kind: 'org.invited',
                channel: 'sms',
                enabled: false,
            },
        ])
        .execute()

    const alphaPrefs = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('notification_prefs').selectAll().execute(),
    )
    expect(alphaPrefs.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(alphaPrefs.filter((r) => r.tenant_id === alphaTenantId).length).toBe(1)

    // prefs hold a DELETE grant (the grid can clear a pref back to default) — a scoped delete succeeds
    await runWithTenant(db, alphaTenantId, (trx) =>
        trx.deleteFrom('notification_prefs').where('user_id', '=', 'user-alpha').execute(),
    )
    const afterPrefDelete = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('notification_prefs').select('id').where('user_id', '=', 'user-alpha').execute(),
    )
    expect(afterPrefDelete.length).toBe(0)

    // ---- inbound_emails: tenant-only RLS, NULLable org_id, SELECT/INSERT/UPDATE (no DELETE) ----
    //
    // Same tenant-isolation shape as jobs; org_id is an app-level filter (and NULLable — a message may
    // fail org resolution while its tenant is known). Grant is SELECT/INSERT (intake files 'received')
    // + UPDATE (intake sets the final status) with NO DELETE — a durable record like audit/notifications.
    // The handler slug in the address is deliberately NEUTRAL (`proof`): handlers are registered by the
    // app (src/app-config/inbound-email.ts), and the isolation proved here is indifferent to which one.
    // Reuses hookOrgAlpha / hookOrgDemo from the webhook block.
    await db
        .insertInto('inbound_emails')
        .values([
            {
                tenant_id: alphaTenantId,
                org_id: hookOrgAlpha!.id,
                from_email: 'ada@example.test',
                to_email: 'hook-a+proof@mail.test',
                subject: 'alpha inbound',
                body_text: 'hello',
                status: 'handled',
                handler: 'proof',
            },
            // A NULL-org row: proves the column accepts null and RLS still contains it (the real
            // multi-domain path files an unresolved-org message under the domain's tenant).
            {
                tenant_id: alphaTenantId,
                org_id: null,
                from_email: 'stranger@example.test',
                to_email: 'nope+proof@mail.test',
                subject: 'alpha unresolved',
                body_text: 'orphan',
                status: 'unmatched',
                error: 'org not resolved',
            },
            {
                tenant_id: demoTenantId,
                org_id: hookOrgDemo!.id,
                from_email: 'gale@example.test',
                to_email: 'hook-d+proof@mail.test',
                subject: 'demo inbound',
                body_text: 'hi',
                status: 'received',
            },
        ])
        .execute()

    // read isolation, both directions, via UNFILTERED selects under RLS
    const alphaInbound = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('inbound_emails').selectAll().execute(),
    )
    expect(alphaInbound.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(alphaInbound.filter((r) => r.tenant_id === alphaTenantId).length).toBe(2)
    // the null-org row is contained by the SAME tenant scope
    expect(alphaInbound.filter((r) => r.org_id === null).length).toBe(1)
    const demoInbound = await runWithTenant(db, demoTenantId, (trx) =>
        trx.selectFrom('inbound_emails').selectAll().execute(),
    )
    expect(demoInbound.filter((r) => r.tenant_id === alphaTenantId).length).toBe(0)

    // write isolation: INSERT carrying the other tenant's id is rejected by WITH CHECK
    let inboundWriteRejected = false
    try {
        await runWithTenant(db, alphaTenantId, (trx) =>
            trx
                .insertInto('inbound_emails')
                .values({
                    tenant_id: demoTenantId,
                    org_id: hookOrgDemo!.id,
                    from_email: 'smuggle@example.test',
                    to_email: 'hook-d+proof@mail.test',
                    subject: 'smuggled',
                    body_text: 'x',
                })
                .execute(),
        )
    } catch (error) {
        inboundWriteRejected = /row-level security/.test(String(error))
    }
    expect(inboundWriteRejected).toBe(true)

    // status update: a scoped UPDATE succeeds under RLS (the granted UPDATE path intake uses)
    await runWithTenant(db, alphaTenantId, (trx) =>
        trx
            .updateTable('inbound_emails')
            .set({ status: 'handled', handler: 'proof' })
            .where('to_email', '=', 'nope+proof@mail.test')
            .execute(),
    )
    const afterStatus = await runWithTenant(db, alphaTenantId, (trx) =>
        trx
            .selectFrom('inbound_emails')
            .select('status')
            .where('to_email', '=', 'nope+proof@mail.test')
            .executeTakeFirstOrThrow(),
    )
    expect(afterStatus.status).toBe('handled')

    // ---- agreements + agreement_acceptances: TENANT-scoped RLS ----
    //
    // The access-gate worked example. Agreements are TENANT-level, NOT org-scoped (no org_id at all) —
    // so tenant isolation is the whole isolation story here, with the same NULLIF policy as jobs.
    // `agreements` is SELECT/INSERT/UPDATE (the version bump is a granted UPDATE) with NO DELETE grant
    // (durable). `agreement_acceptances` is APPEND-ONLY — SELECT/INSERT only, so an acceptance can never
    // be rewritten or erased (the audit_events precedent); prove the UPDATE and DELETE both fail.

    const [alphaAgreement] = await db
        .insertInto('agreements')
        .values({
            tenant_id: alphaTenantId,
            kind: 'tos',
            version: 1,
            title: 'Alpha ToS',
            body_md: '# Alpha ToS\nBe excellent.',
            gating: 'block-all',
        })
        .returning('id')
        .execute()
    await db
        .insertInto('agreements')
        .values({
            tenant_id: demoTenantId,
            kind: 'privacy',
            version: 1,
            title: 'Demo Privacy',
            body_md: 'We respect your data.',
            gating: 'advisory',
        })
        .execute()

    // (a) tenant isolation, both directions, via UNFILTERED selects under RLS.
    const alphaAgreements = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('agreements').selectAll().execute(),
    )
    expect(alphaAgreements.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(alphaAgreements.filter((r) => r.tenant_id === alphaTenantId).length).toBe(1)
    const demoAgreements = await runWithTenant(db, demoTenantId, (trx) =>
        trx.selectFrom('agreements').selectAll().execute(),
    )
    expect(demoAgreements.filter((r) => r.tenant_id === alphaTenantId).length).toBe(0)
    expect(demoAgreements.filter((r) => r.tenant_id === demoTenantId).length).toBe(1)

    // (a) write isolation: INSERT carrying the OTHER tenant's id is rejected by WITH CHECK.
    let agreementWriteRejected = false
    try {
        await runWithTenant(db, alphaTenantId, (trx) =>
            trx
                .insertInto('agreements')
                .values({
                    tenant_id: demoTenantId,
                    kind: 'tos',
                    version: 1,
                    title: 'smuggled',
                    body_md: 'smuggled',
                    gating: 'block-all',
                })
                .execute(),
        )
    } catch (error) {
        agreementWriteRejected = /row-level security/.test(String(error))
    }
    expect(agreementWriteRejected).toBe(true)

    // (b) the version bump: a scoped UPDATE of version succeeds under RLS (the granted UPDATE path).
    await runWithTenant(db, alphaTenantId, (trx) =>
        trx.updateTable('agreements').set({ version: 2 }).where('id', '=', alphaAgreement!.id).execute(),
    )
    const afterBump = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('agreements').select('version').where('id', '=', alphaAgreement!.id).executeTakeFirstOrThrow(),
    )
    expect(Number(afterBump.version)).toBe(2)

    // (c) DELETE denied at the privilege layer — only SELECT, INSERT, UPDATE are granted (durable record).
    let agreementDeleteRejected = false
    try {
        await db.transaction().execute(async (trx) => {
            await sql`SET LOCAL ROLE app_user`.execute(trx)
            await sql`SELECT set_config('app.current_tenant', ${alphaTenantId}, true)`.execute(trx)
            await sql`DELETE FROM agreements`.execute(trx)
        })
    } catch (error) {
        agreementDeleteRejected = /permission denied/.test(String(error))
    }
    expect(agreementDeleteRejected).toBe(true)

    // agreement_acceptances — append-only, tenant-scoped. Seed one acceptance per tenant.
    await db
        .insertInto('agreement_acceptances')
        .values({
            tenant_id: alphaTenantId,
            agreement_id: alphaAgreement!.id,
            agreement_version: 1,
            user_id: 'user-alpha',
        })
        .execute()

    // (a) tenant isolation, both directions, via UNFILTERED selects under RLS.
    const alphaAcceptances = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('agreement_acceptances').selectAll().execute(),
    )
    expect(alphaAcceptances.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(alphaAcceptances.filter((r) => r.tenant_id === alphaTenantId).length).toBe(1)
    const demoAcceptances = await runWithTenant(db, demoTenantId, (trx) =>
        trx.selectFrom('agreement_acceptances').selectAll().execute(),
    )
    expect(demoAcceptances.length).toBe(0)

    // (a) write isolation: INSERT carrying the OTHER tenant's id is rejected by WITH CHECK.
    let acceptanceWriteRejected = false
    try {
        await runWithTenant(db, alphaTenantId, (trx) =>
            trx
                .insertInto('agreement_acceptances')
                .values({
                    tenant_id: demoTenantId,
                    agreement_id: alphaAgreement!.id,
                    agreement_version: 1,
                    user_id: 'smuggled',
                })
                .execute(),
        )
    } catch (error) {
        acceptanceWriteRejected = /row-level security/.test(String(error))
    }
    expect(acceptanceWriteRejected).toBe(true)

    // (b) append-only: as app_user (tenant context set) an UPDATE FAILS at the privilege layer —
    // the table's only grants are SELECT, INSERT.
    let acceptanceUpdateRejected = false
    try {
        await db.transaction().execute(async (trx) => {
            await sql`SET LOCAL ROLE app_user`.execute(trx)
            await sql`SELECT set_config('app.current_tenant', ${alphaTenantId}, true)`.execute(trx)
            await sql`UPDATE agreement_acceptances SET agreement_version = 99`.execute(trx)
        })
    } catch (error) {
        acceptanceUpdateRejected = /permission denied/.test(String(error))
    }
    expect(acceptanceUpdateRejected).toBe(true)

    // ...and a DELETE fails the same way — an acceptance can never be erased.
    let acceptanceDeleteRejected = false
    try {
        await db.transaction().execute(async (trx) => {
            await sql`SET LOCAL ROLE app_user`.execute(trx)
            await sql`SELECT set_config('app.current_tenant', ${alphaTenantId}, true)`.execute(trx)
            await sql`DELETE FROM agreement_acceptances`.execute(trx)
        })
    } catch (error) {
        acceptanceDeleteRejected = /permission denied/.test(String(error))
    }
    expect(acceptanceDeleteRejected).toBe(true)

    // ---- keyset pagination: a cursor is UNTRUSTED INPUT, and cannot widen a scope ----
    //
    // `keysetPage` (./keyset) is the only framework primitive whose input comes from the CLIENT — a
    // cursor arrives on a query string — so it is the only read path where "does RLS still hold?" is a
    // question about attacker-supplied data rather than about our own code. The proofs below run the
    // REAL primitive (through the port, so it opens its own withTenant transaction, exactly as a route
    // does) and attack it three ways: a cursor minted in the OTHER tenant, a cursor hand-crafted to
    // name a row in the other tenant, and cursors that are simply malformed.
    //
    // The structural claim being checked is that a cursor contributes only a CONJUNCT to an
    // already-scoped query — so it can subtract rows and never add them. These assertions are what
    // stop that from being merely an argument.

    const [pageOrgAlpha] = await db
        .insertInto('organizations')
        .values({ tenant_id: alphaTenantId, slug: `page-a-${Date.now()}`, name: 'Page Org A' })
        .returning('id')
        .execute()
    const [pageOrgDemo] = await db
        .insertInto('organizations')
        .values({ tenant_id: demoTenantId, slug: `page-d-${Date.now()}`, name: 'Page Org D' })
        .returning('id')
        .execute()

    // SEVEN alpha jobs sharing ONE created_at, and four demo ones sharing another. Both adversarial
    // properties of that timestamp are deliberate, and both are the cases that break a hand-rolled
    // pager:
    //
    //   - IDENTICAL across the batch, which is what a real batch looks like (one statement is one
    //     transaction, and now() is transaction-start time). A pager ordering on the timestamp alone
    //     has no defined position inside it: page 2 either repeats the batch or skips the rest of it.
    //   - MICROSECOND-precise, with a non-zero sub-millisecond part. `timestamptz` keeps six digits;
    //     the JS `Date` a driver hands back keeps three. A pager that mints its cursor from that Date
    //     asks for `created_at < …123` while the rows all say `…123456`, and page 2 comes back empty
    //     forever. Written EXPLICITLY rather than left to now(), because pglite's now() happens to be
    //     millisecond-precise while real Postgres's is not — so a proof relying on now() would hold the
    //     fake and the real engine to different standards, which is the one thing this suite exists to
    //     prevent.
    const alphaBatchAt = '2020-03-04T05:06:07.123456Z'
    const demoBatchAt = '2020-03-04T05:06:08.654321Z'
    await db
        .insertInto('jobs')
        .values(
            Array.from({ length: 7 }, (_, index) => ({
                tenant_id: alphaTenantId,
                org_id: pageOrgAlpha!.id,
                kind: 'digest-email',
                payload: { scope: 'page-alpha', index },
                created_at: alphaBatchAt,
            })),
        )
        .execute()
    await db
        .insertInto('jobs')
        .values(
            Array.from({ length: 4 }, (_, index) => ({
                tenant_id: demoTenantId,
                org_id: pageOrgDemo!.id,
                kind: 'digest-email',
                payload: { scope: 'page-demo', index },
                created_at: demoBatchAt,
            })),
        )
        .execute()

    /** One page of an org's jobs, through the real primitive. */
    const readJobPage = (tenantId: string, orgId: string, cursor: string | null, limit: number) => {
        const parsed = parseDbKeysetCursor(cursor)
        // A cursor the pager itself minted must always parse; anything else is the proof's own bug.
        expect(parsed.kind === 'invalid').toBe(false)
        return keysetPage(dbPort, { tenantId, after: parsed.position ?? null, limit }, (trx) =>
            trx.selectFrom('jobs').select(['id', 'tenant_id', 'org_id']).where('org_id', '=', orgId),
        )
    }

    /** Walk every page, the way a "load more" button does, and report everything the reader saw. */
    const walkJobs = async (tenantId: string, orgId: string, limit: number) => {
        const seen: Array<{ id: string; tenant_id: string; org_id: string | null }> = []
        let cursor: string | null = null
        for (let guard = 0; guard < 50; guard++) {
            const page = await readJobPage(tenantId, orgId, cursor, limit)
            seen.push(...page.rows)
            if (page.nextCursor === null) return seen
            cursor = page.nextCursor
        }
        throw new Error('keyset proof: the walk did not terminate')
    }

    // (a) the batch really does share one instant — otherwise the walk below proves nothing hard.
    const alphaPageStamps = await runWithTenant(db, alphaTenantId, (trx) =>
        trx.selectFrom('jobs').select('created_at').where('org_id', '=', pageOrgAlpha!.id).execute(),
    )
    expect(new Set(alphaPageStamps.map((r) => String(r.created_at))).size).toBe(1)

    // (b) a full walk at a page size that cuts THROUGH that batch returns all seven, once each, and
    // nothing belonging to the other tenant.
    const alphaWalk = await walkJobs(alphaTenantId, pageOrgAlpha!.id, 2)
    expect(alphaWalk.length).toBe(7)
    expect(new Set(alphaWalk.map((r) => r.id)).size).toBe(7)
    expect(alphaWalk.filter((r) => r.tenant_id !== alphaTenantId).length).toBe(0)

    // ...and the limit reaches SQL: an explicit page size is honoured exactly, and reports more to come.
    const alphaFirstPage = await readJobPage(alphaTenantId, pageOrgAlpha!.id, null, 3)
    expect(alphaFirstPage.rows.length).toBe(3)
    expect(alphaFirstPage.nextCursor !== null).toBe(true)
    // An absurd request is answered with the whole (small) queue, not with an error — the cap is a
    // clamp, not a rejection. KEYSET_MAX_LIMIT itself is pinned by ../core/keyset.test.ts.
    const alphaHugeLimit = await readJobPage(alphaTenantId, pageOrgAlpha!.id, null, KEYSET_MAX_LIMIT * 1_000)
    expect(alphaHugeLimit.rows.length).toBe(7)
    expect(alphaHugeLimit.nextCursor).toBe(null)

    // (c) THE ATTACK: a cursor minted while paging DEMO's queue, replayed against ALPHA's. It decodes
    // fine — it is a well-formed position — and the demo rows are newer, so it does not even narrow
    // alpha's list. What it cannot do is carry demo's scope with it: the tenant comes from the session
    // that opened withTenant, and the org from the query the pager rebuilds on every page.
    const demoFirstPage = await readJobPage(demoTenantId, pageOrgDemo!.id, null, 2)
    expect(demoFirstPage.nextCursor !== null).toBe(true)
    const smuggledPage = await readJobPage(alphaTenantId, pageOrgAlpha!.id, demoFirstPage.nextCursor, 50)
    expect(smuggledPage.rows.length).toBe(7)
    expect(smuggledPage.rows.filter((r) => r.tenant_id === demoTenantId).length).toBe(0)
    expect(smuggledPage.rows.filter((r) => r.org_id === pageOrgDemo!.id).length).toBe(0)
    expect(smuggledPage.rows.every((r) => r.tenant_id === alphaTenantId)).toBe(true)

    // (d) a cursor HAND-CRAFTED to name a specific row in the other tenant, with a timestamp far enough
    // in the future to select everything the predicate can reach. The id is a real demo job's — this is
    // the sharpest form of the attack, an attacker who has somehow learned another tenant's row id —
    // and the answer is still exactly alpha's own seven rows.
    const demoJobIds = demoFirstPage.rows.map((r) => r.id)
    expect(demoJobIds.length > 0).toBe(true)
    const crafted = encodeKeysetCursor({ at: '2999-01-01T00:00:00.000000Z', id: demoJobIds[0]! })
    const craftedPage = await readJobPage(alphaTenantId, pageOrgAlpha!.id, crafted, 50)
    expect(craftedPage.rows.length).toBe(7)
    expect(craftedPage.rows.every((r) => r.tenant_id === alphaTenantId)).toBe(true)
    expect(craftedPage.rows.some((r) => demoJobIds.includes(r.id))).toBe(false)

    /**
     * Wrap an arbitrary payload in the cursor's envelope the way an ATTACKER would — base64url over
     * raw bytes. Not `encodeKeysetCursor`, which validates its input and rightly refuses to mint a
     * hostile position; that refusal is a property worth keeping, so a proof of what happens when
     * someone bypasses it has to bypass it too.
     */
    const forgeCursor = (payload: string) => btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    // (e) fail-closed at the boundary: a malformed cursor never becomes a query at all. Note the last
    // case — a cursor the PURE parser would accept, rejected here because its id is not a uuid and so
    // could only ever have been a cast error inside the statement.
    for (const hostile of [
        'not-a-cursor',
        '../../etc/passwd',
        // A WELL-FORMED envelope carrying SQL in the id half. It dies on the id pattern, before
        // anything could bind it (and it would have been a bound parameter even then). Encoded here
        // rather than pasted as a base64 literal: the payload stays readable, and a high-entropy blob
        // in the source is indistinguishable from a committed credential to a secret scanner.
        forgeCursor("2026-01-01T00:00:00Z|' OR 1=1 --"),
        // A plausible SEED id rather than a uuid: well-formed envelope, non-uuid id half.
        encodeKeysetCursor({ at: '2026-01-01T00:00:00.000Z', id: 'seed-row-3' }),
    ]) {
        expect(parseDbKeysetCursor(hostile).kind).toBe('invalid')
    }
}
