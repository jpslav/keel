import type { SeedAgreement, SeedJobSchedule, SeedOrg, SeedPerson, SeedTenant } from 'keel/seed/contracts'

/**
 * The starter's seed world — two tenants, two teams, three people.
 *
 * WHY IT LIVES INSIDE THE APP (and not in a `packages/*-seed` workspace like the showcase's
 * `@app/seed`): the seed IS app content. The framework never imports it directly — it reads
 * `@app-config/seed`, which re-exports this file — so its location is entirely the app's choice, and
 * an app-local module is one fewer workspace for an adopter to find, rename and repoint. It also
 * proves `keel/seed/contracts` is a real published surface rather than a private arrangement with one
 * package: this world fills the same contracts with no `@app/seed` anywhere in sight.
 *
 * Deliberately smaller than the showcase's: two tenants (the minimum that makes tenant isolation
 * observable), one team each, and the roles the framework's own screens need to stay interesting —
 * an admin who can invite, a plain member, and a restricted member whose authoring surface is
 * reduced. `preAcceptedByAllInTenant` is unused because the starter seeds no agreements.
 */

export type {
    PersonRole,
    SeedAgreement,
    SeedAgreementGating,
    SeedAgreementKind,
    SeedJobSchedule,
    SeedMembership,
    SeedOrg,
    SeedPerson,
    SeedScheduleSpec,
    SeedTenant,
} from 'keel/seed/contracts'

export const tenants: SeedTenant[] = [
    { slug: 'northwind', name: 'Northwind', themePrimaryColor: 'teal', themeRadius: 'sm' },
    { slug: 'westgate', name: 'Westgate', themePrimaryColor: 'grape', themeRadius: 'xl' },
]

/**
 * One team per tenant. `ops` doubles as the operator org (see `staffOrgSlug` in
 * ../app-config/abilities.ts): the two slugs must agree, and this is the whole of that agreement.
 */
export const organizations: SeedOrg[] = [
    { slug: 'ops', name: 'Operations', tenantSlug: 'northwind' },
    { slug: 'field', name: 'Field Team', tenantSlug: 'westgate' },
]

export const people: SeedPerson[] = [
    {
        id: 'person-owner',
        name: 'Nadia Owner',
        email: 'nadia.owner@example.test',
        locale: 'en',
        tenantSlug: 'northwind',
        memberships: [{ orgSlug: 'ops', role: 'admin' }],
        restricted: false,
    },
    {
        id: 'person-teammate',
        name: 'Tomás Compañero',
        email: 'tomas.companero@example.test',
        locale: 'es',
        tenantSlug: 'northwind',
        memberships: [{ orgSlug: 'ops', role: 'member' }],
        restricted: false,
    },
    {
        // The other tenant, and the star of the tenancy e2e: whatever Nadia writes, Wes cannot see.
        id: 'person-other-tenant',
        name: 'Wes Westgate',
        email: 'wes.westgate@example.test',
        locale: 'en',
        tenantSlug: 'westgate',
        memberships: [{ orgSlug: 'field', role: 'admin' }],
        restricted: false,
    },
]

/** No agreements: the access-gate capability is registered-but-empty, like most of this app's seam. */
export const agreements: SeedAgreement[] = []

/** No recurring work: the starter registers no job kinds, so nothing is scheduled. */
export const jobSchedules: SeedJobSchedule[] = []

export function findTenant(slug: string): SeedTenant | undefined {
    return tenants.find((t) => t.slug === slug)
}

export function findOrg(slug: string): SeedOrg | undefined {
    return organizations.find((o) => o.slug === slug)
}
