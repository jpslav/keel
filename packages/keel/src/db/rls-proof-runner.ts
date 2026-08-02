import { appRlsProofs } from '@app-config/db/rls-proofs'
import type { Kysely } from 'kysely'
import type { DbPort } from '../ports/db'
import { proveRlsCoverage } from './rls-coverage'
import { frameworkRlsProofs, type ProofExpectation } from './rls-proofs'
import type { DB } from './schema'
import { runWithTenant } from './with-tenant'

/**
 * The composition root of THE tenant-isolation proof suite (ADR-0004): framework proofs ∪ app proofs,
 * over one shared set of fixtures, as a single call both engines make.
 *
 * WHY IT LIVES IN THE PACKAGE. The suite has two consumers on opposite sides of the framework/app line —
 * packages/keel/src/db/rls-pglite.test.ts (unit, pglite) and tests/contract/rls-contract.test.ts
 * (contract, real Postgres) — and they must run the IDENTICAL assertions or the anti-drift guarantee is
 * gone. A repo-root composition point would force the package's own test to escape its tree with a
 * relative `../../../../` import, which is precisely the wart ADR-0012 recorded and this file closes.
 * So the framework owns the composition and reads the app's half through the seam: `@app-config/db/
 * rls-proofs` joins the short enumerated list of framework→seam VALUE imports (ability rules,
 * migrations, the job/actor/flag registries, the inbound-email handlers, the seed re-export, the
 * assistant config, identity, the message loader).
 *
 * Deleting the demo app therefore never breaks keel's own tenancy proof: `frameworkRlsProofs` names no
 * app table, and an adopter with no tenant tables of its own registers an empty `appRlsProofs`.
 */
export async function runRlsProofs(db: Kysely<DB>, expect: (actual: unknown) => ProofExpectation): Promise<void> {
    // The shared fixtures, seeded as the privileged migration user: two tenants to isolate against, and
    // one organization inside each. Both halves need a valid org id on the right tenant AND one on the
    // wrong tenant, so their cross-tenant WITH CHECK proofs fail on the tenant boundary rather than on a
    // fabricated foreign key. Slugs carry a timestamp because a contract run may reuse a live database.
    const stamp = Date.now()
    const [alpha] = await db
        .insertInto('tenants')
        .values({ slug: `alpha-${stamp}`, name: 'Alpha Proof' })
        .returning('id')
        .execute()
    const [demo] = await db
        .insertInto('tenants')
        .values({ slug: `demo-${stamp}`, name: 'Demo Proof' })
        .returning('id')
        .execute()
    const [alphaOrg] = await db
        .insertInto('organizations')
        .values({ tenant_id: alpha!.id, slug: `alpha-org-${stamp}`, name: 'Alpha Proof Org' })
        .returning('id')
        .execute()
    const [demoOrg] = await db
        .insertInto('organizations')
        .values({ tenant_id: demo!.id, slug: `demo-org-${stamp}`, name: 'Demo Proof Org' })
        .returning('id')
        .execute()

    // The raw handle wearing the port's face, so both halves can drive REAL product code paths
    // (`keysetPage`, which takes a DbPort and opens `withTenant` itself) rather than a re-implementation
    // of them. Migration/ready are not this suite's business — it is handed an already-migrated engine.
    const dbPort: DbPort = {
        getDb: () => db,
        withTenant: (tenantId, fn) => runWithTenant(db, tenantId, fn),
        ready: () => Promise.resolve(),
        migrateToLatest: () => Promise.resolve(),
    }

    const context = {
        db,
        dbPort,
        expect,
        alphaTenantId: alpha!.id,
        demoTenantId: demo!.id,
        alphaOrgId: alphaOrg!.id,
        demoOrgId: demoOrg!.id,
    }

    // Coverage BEFORE behaviour, and deliberately not part of either half: it asks whether every
    // tenant_id table the registered migrations created is protected at all, which is a question
    // neither half can answer about the other. Reading the catalog rather than a list is what makes
    // an adopter's own new table covered without them registering anything — see ./rls-coverage.
    await proveRlsCoverage(db, expect)

    // Sequential, not concurrent: several proofs assert exact row COUNTS under RLS, so the two halves
    // must not be interleaving inserts into the same tenants.
    await frameworkRlsProofs(context)
    await appRlsProofs(context)
}
