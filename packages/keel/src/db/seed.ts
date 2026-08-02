import * as appSeed from '@app-config/seed'
import {
    agreements as seedAgreementRows,
    jobSchedules as seedJobScheduleRows,
    organizations as seedOrgs,
    people as seedPeople,
    tenants as seedTenants,
} from '@app-config/seed'
import type { Kysely } from 'kysely'
import { computeNextRunAt, type ScheduleSpec } from '../core/schedules'
import type { AppSeedRows } from '../seed/contracts'
import type { EmailPort } from '../ports/email'
import type { StoragePort } from '../ports/storage'
import type { DB } from './schema'

/**
 * The app's OPTIONAL product-row seeder (../seed/contracts.ts). Looked up rather than imported by name
 * because it is genuinely optional: an app with no product corpus — apps/starter — exports nothing, and
 * a named import would make the absence a build error instead of a no-op. The lookup is the one place
 * the framework tolerates not knowing whether the seam exports something, and it is narrowed to exactly
 * one contract-typed function.
 */
const appSeedRows = (appSeed as Record<string, unknown>).appSeedRows as AppSeedRows | undefined

/** What the seeder needs beyond the database to furnish a world (see AppSeedContext). */
export interface SeedDeps {
    storage: StoragePort
    email: EmailPort
}

/** Idempotent: dev and demo boots run this on every start, and so does every Simulator world reset. */
export async function seedDb(db: Kysely<DB>, deps: SeedDeps): Promise<void> {
    for (const tenant of seedTenants) {
        await db
            .insertInto('tenants')
            .values({ slug: tenant.slug, name: tenant.name })
            .onConflict((oc) => oc.column('slug').doUpdateSet({ name: tenant.name }))
            .execute()
    }

    for (const org of seedOrgs) {
        const tenant = await db.selectFrom('tenants').select('id').where('slug', '=', org.tenantSlug).executeTakeFirst()
        if (!tenant) continue
        await db
            .insertInto('organizations')
            .values({ tenant_id: tenant.id, slug: org.slug, name: org.name })
            .onConflict((oc) => oc.columns(['tenant_id', 'slug']).doUpdateSet({ name: org.name }))
            .execute()
    }

    await seedJobSchedules(db)
    await seedAgreements(db)

    // LAST, and only if the app registered one: the framework's tables must all exist (and its orgs be
    // resolvable by slug) before an app can hang product rows off them.
    await appSeedRows?.({ db, storage: deps.storage, email: deps.email })
}

/**
 * Seed the access-gate worked example: one agreement per tenant that has one, plus the
 * pre-acceptances that keep every existing flow green. Idempotent by check-then-insert — the agreement
 * row is created ONCE (its version is thereafter owned by the world: a Simulator bump must survive a
 * reboot, so we never re-set it), and each pre-acceptance is inserted at most once. The alpha ToS is
 * pre-accepted by every person in tenant alpha so nothing blocks until an operator bumps the version;
 * the demo-org privacy notice is accepted by nobody so its advisory banner shows out of the box.
 */
async function seedAgreements(db: Kysely<DB>): Promise<void> {
    for (const seed of seedAgreementRows) {
        const tenant = await db
            .selectFrom('tenants')
            .select('id')
            .where('slug', '=', seed.tenantSlug)
            .executeTakeFirst()
        if (!tenant) continue

        // The agreement row: created once, version thereafter owned by the world (never reset on boot).
        let agreement = await db
            .selectFrom('agreements')
            .select('id')
            .where('tenant_id', '=', tenant.id)
            .where('kind', '=', seed.kind)
            .executeTakeFirst()
        if (!agreement) {
            agreement = await db
                .insertInto('agreements')
                .values({
                    tenant_id: tenant.id,
                    kind: seed.kind,
                    version: seed.version,
                    title: seed.title,
                    body_md: seed.bodyMd,
                    gating: seed.gating,
                })
                .returning('id')
                .executeTakeFirstOrThrow()
        }

        if (!seed.preAcceptedByAllInTenant) continue

        // Pre-accept at the seed version for every person whose home tenant is this one. Idempotent by
        // (agreement_id, user_id, agreement_version) — the append-only table gets each seed row once.
        const tenantPeople = seedPeople.filter((person) => person.tenantSlug === seed.tenantSlug)
        for (const person of tenantPeople) {
            const existing = await db
                .selectFrom('agreement_acceptances')
                .select('id')
                .where('agreement_id', '=', agreement.id)
                .where('user_id', '=', person.id)
                .where('agreement_version', '=', seed.version)
                .executeTakeFirst()
            if (existing) continue
            await db
                .insertInto('agreement_acceptances')
                .values({
                    tenant_id: tenant.id,
                    agreement_id: agreement.id,
                    agreement_version: seed.version,
                    user_id: person.id,
                })
                .execute()
        }
    }
}

/**
 * Seed the demo's recurring job schedules from packages/seed data, so the scheduled-work demo
 * works out of the box: advancing the Simulator world clock past a schedule's next_run_at fires its job
 * (the seeded weekly digest lands a digest email in the Mail tab). This framework mechanism takes only
 * what the data says — WHICH org gets WHICH schedule is app content (@app-config/seed), never an org slug
 * hard-coded here (ADR-0012). Idempotent by check-then-insert — job_schedules has no natural unique key to
 * onConflict against (over-constraining the table just for the seed would be wrong), and next_run_at must
 * be set once at creation and thereafter owned by the scheduler, never reset on every boot.
 */
async function seedJobSchedules(db: Kysely<DB>): Promise<void> {
    for (const seed of seedJobScheduleRows) {
        const tenant = await db
            .selectFrom('tenants')
            .select('id')
            .where('slug', '=', seed.tenantSlug)
            .executeTakeFirst()
        if (!tenant) continue
        const org = await db
            .selectFrom('organizations')
            .select('id')
            .where('tenant_id', '=', tenant.id)
            .where('slug', '=', seed.orgSlug)
            .executeTakeFirst()
        if (!org) continue

        const existing = await db
            .selectFrom('job_schedules')
            .select('id')
            .where('tenant_id', '=', tenant.id)
            .where('org_id', '=', org.id)
            .where('kind', '=', seed.kind)
            .executeTakeFirst()
        if (existing) continue

        // The inlined seed spec is structurally ScheduleSpec — bridge it at this boundary. next_run_at is
        // the next matching instant after boot (genuinely future), so the demo/e2e advances the clock to
        // cross it (a +1w advance always does for the weekly digest).
        const spec: ScheduleSpec = seed.spec
        await db
            .insertInto('job_schedules')
            .values({
                tenant_id: tenant.id,
                org_id: org.id,
                kind: seed.kind,
                spec,
                next_run_at: computeNextRunAt(spec, new Date()),
                enabled: true,
                created_by: seed.createdBy,
            })
            .execute()
    }
}
