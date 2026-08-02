import type { Kysely } from 'kysely'
import type { AgreementGating, AgreementKind } from '../core/agreements'
import type { Locale } from '../core/locale'
import type { Role } from '../core/roles'
import type { ScheduleSpec } from '../core/schedules'
import type { DB } from '../db/schema'
import type { EmailPort } from '../ports/email'
import type { StoragePort } from '../ports/storage'

/**
 * The SEED CONTRACT — the shapes the framework's seeder (db/seed.ts), fake auth adapter and per-tenant
 * theming read out of an app's seed package. ADR-0012 puts these types in the framework,
 * so `packages/seed` (and any adopter's replacement for it) is a DATA package that conforms to a
 * framework contract rather than the accidental source of truth for it.
 *
 * Data only: no runtime values here, and the seed package that implements these stays import-free at
 * runtime (it imports types, which erase).
 *
 * The agreement/schedule shapes are ALIASES of the canonical core types rather than copies — the seed
 * package used to inline them to stay import-free, which meant a core change could silently drift from
 * the seed data. Type-only imports keep it import-free at runtime AND keep the shapes welded together.
 */

export interface SeedTenant {
    slug: string
    name: string
    /** Mantine primary color name; the app's getTenantTheme() maps tokens to a real theme. */
    themePrimaryColor: string
    /** Mantine radius token — a second, shape-level signal that per-tenant theming is real. */
    themeRadius: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
}

/** Alias of the canonical core union (same weld as the agreement/schedule shapes above). */
export type PersonRole = Role

/**
 * An organization (product copy: "team") groups users WITHIN one tenant site — the Clerk
 * Organization analog. Slugs are globally unique for now: while the clerk-dev instance is shared
 * across tenants, every org lands in one Clerk org namespace (see cutover checklist).
 */
export interface SeedOrg {
    slug: string
    name: string
    /** The tenant (site) this org belongs to. Orgs never span tenants. */
    tenantSlug: string
}

/** A person's role within one org — role is per-membership, mirroring Clerk org-membership roles. */
export interface SeedMembership {
    orgSlug: string
    role: PersonRole
}

export interface SeedPerson {
    id: string
    name: string
    email: string
    locale: Locale
    /** Home site (ambient) — a person's tenant never changes and is never user-switchable. */
    tenantSlug: string
    /** Orgs this person belongs to, each with its own role. Always at least one. */
    memberships: SeedMembership[]
    /** Restricted members exercise the limited-access seam (reduced feature surface). */
    restricted: boolean
}

/** Agreement kind / gating, from the canonical core vocabulary (core/agreements.ts). */
export type SeedAgreementKind = AgreementKind
export type SeedAgreementGating = AgreementGating

/**
 * A seed agreement — TENANT-scoped world content (like note bodies, not UI copy). `bodyMd`
 * is markdown, rendered simply. `preAcceptedByAllInTenant` encodes the seed-shape decision that keeps
 * every existing e2e green: an agreement can arrive already accepted by everyone in its tenant (so
 * nothing is blocked until a Simulator version bump re-arms the gate) or accepted by nobody (so it
 * demonstrates the advisory banner). See the decision log.
 */
export interface SeedAgreement {
    /** Tenant (site) this agreement governs — agreements are tenant-level, not per-team. */
    tenantSlug: string
    kind: SeedAgreementKind
    version: number
    title: string
    bodyMd: string
    gating: SeedAgreementGating
    preAcceptedByAllInTenant: boolean
}

/** A recurring schedule spec, from the canonical core vocabulary (core/schedules.ts). */
export type SeedScheduleSpec = ScheduleSpec

/**
 * A seeded recurring job schedule — WHICH org gets WHICH schedule is app/demo content, so it
 * lives in the seed package rather than hard-coded in the framework seeder (db/seed.ts), which only
 * takes what the data says. `kind` names a job kind the schedule fires; `createdBy` is a marker, not a
 * real user id.
 */
export interface SeedJobSchedule {
    tenantSlug: string
    orgSlug: string
    kind: string
    spec: SeedScheduleSpec
    createdBy: string
}

/**
 * What an app's product-row seeder is handed, once the framework's own tables (tenants, orgs,
 * agreements, schedules) exist. The db handle is the PRIVILEGED migration-user connection the framework
 * seeder itself uses, not a tenant-scoped one — seeding predates any session, so it writes rows for
 * every tenant and RLS is not in tour. `storage` and `email` are here because a believable starting
 * world is not only rows: an attachment needs its bytes on disk or its download link is dead, and a
 * demo that opens with an empty outbox has to be talked into looking used.
 */
export interface AppSeedContext {
    db: Kysely<DB>
    storage: StoragePort
    email: EmailPort
}

/**
 * The OPTIONAL app half of the seeder (ADR-0012). An app with product rows exports `appSeedRows` from
 * `@app-config/seed`; the framework seeder looks for it and calls it last. An app with nothing to seed
 * omits the export entirely — the registration is absent rather than empty, because there is no shape
 * for "no rows" that is more honest than not having the function.
 *
 * The implementation owns its own idempotence: the seeder runs on EVERY boot and after every Simulator
 * world reset, so it must decide for itself whether this world has already been furnished.
 */
export type AppSeedRows = (ctx: AppSeedContext) => Promise<void>
