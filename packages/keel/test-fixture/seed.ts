import type { SeedAgreement, SeedJobSchedule, SeedOrg, SeedPerson, SeedTenant } from 'keel/seed/contracts'

/**
 * THE FIXTURE WORLD — the seed keel's own test suite runs against.
 *
 * Its vocabulary is deliberately NOT the showcase's and NOT the starter's (`harbor`/`lakeside`,
 * `depot`/`annex`/`steward`/`wharf`, `fixture-*` people, `dockets`). That is the whole point: if a
 * framework test ever re-acquires a dependency on a HOST APP's world, it fails here loudly instead of
 * passing quietly because two worlds happened to share a slug.
 *
 * Every row below exists because a test needs the PROPERTY it carries. Deleting one is a test failure,
 * not a tidy-up:
 *  1. EXACTLY TWO TENANTS — `adapters/fake/fake-adapters.test.ts` asserts the sorted slug list.
 *  2. `harbor` has THREE orgs — `db/jobs.test.ts` proves a job in a SIBLING org of the same tenant does
 *     not leak into another org's listing, which needs two ordinary orgs; `steward` is the third.
 *  3. `lakeside` has ONE org whose slug differs from every `harbor` slug — `adapters/fake/service-auth
 *     .test.ts` needs the happy-path org slug to be UNIQUE ACROSS TENANTS (it manufactures the
 *     same-slug-two-tenants collision itself, mid-test, by inserting a duplicate).
 *  4. `fixture-lead` has TWO memberships and `annex` is NOT the first — `adapters/fake/auth.test.ts`
 *     restores a remembered active org that is not the fallback.
 *  5. `fixture-hand`'s memberships EXCLUDE `wharf` — the same test proves a stale/foreign remembered
 *     org falls back to the first membership.
 *  6. `fixture-limited` is `restricted: true` and ACTIVE in `wharf` — `inbound-email/intake.test.ts`
 *     proves email authoring grants no more than the UI.
 *  7. `steward` is a real org because `app-config/abilities.ts` names it as `staffOrgSlug`.
 *  8. No org is slugged `no-such-org` — several tests rely on that slug resolving to nothing.
 */

/**
 * Re-exported so consumers keep importing the seed vocabulary from one place. The list is exactly what
 * keel reads back through `@app-config/seed` — a real app re-exports the whole contract because its
 * own screens use more of it, but an unused re-export here is dead code the gate would (rightly) flag.
 */
export type { PersonRole, SeedAgreement, SeedJobSchedule, SeedOrg, SeedPerson, SeedTenant } from 'keel/seed/contracts'

/** Two tenants, sorted `['harbor', 'lakeside']` — the list fake-adapters.test.ts asserts verbatim. */
export const tenants: SeedTenant[] = [
    { slug: 'harbor', name: 'Harbor Works', themePrimaryColor: 'teal', themeRadius: 'sm' },
    { slug: 'lakeside', name: 'Lakeside Mill', themePrimaryColor: 'grape', themeRadius: 'xl' },
]

/**
 * `depot` is the fixture's primary org and the one `app-config/jobs.ts` marks service-managed, so the
 * build pool must exclude it; `annex` is its sibling inside the same tenant; `steward` is the operator
 * org `staffOrgSlug` names; `wharf` is the second tenant's only org.
 */
export const organizations: SeedOrg[] = [
    { slug: 'depot', name: 'Harbor Depot', tenantSlug: 'harbor' },
    { slug: 'annex', name: 'Harbor Annex', tenantSlug: 'harbor' },
    { slug: 'steward', name: 'Harbor Steward', tenantSlug: 'harbor' },
    { slug: 'wharf', name: 'Lakeside Wharf', tenantSlug: 'lakeside' },
]

/** Low-entropy, obviously-fake ids and addresses (gitleaks): no hex, no UUIDs, no token-like values. */
export const people: SeedPerson[] = [
    {
        id: 'fixture-lead',
        name: 'Ada Keeper',
        email: 'ada.keeper@example.test',
        locale: 'en',
        tenantSlug: 'harbor',
        // Two memberships, `depot` first: the auth suite remembers `annex` and expects it restored.
        memberships: [
            { orgSlug: 'depot', role: 'admin' },
            { orgSlug: 'annex', role: 'admin' },
        ],
        restricted: false,
    },
    {
        id: 'fixture-hand',
        name: 'Bo Deckhand',
        email: 'bo.deckhand@example.test',
        locale: 'en',
        tenantSlug: 'harbor',
        // No `wharf` membership: a remembered `wharf` must fall back to `depot`, the first membership.
        memberships: [
            { orgSlug: 'depot', role: 'staff' },
            { orgSlug: 'annex', role: 'member' },
        ],
        restricted: false,
    },
    {
        id: 'fixture-crew',
        name: 'Cy Rigger',
        email: 'cy.rigger@example.test',
        locale: 'es',
        tenantSlug: 'harbor',
        memberships: [{ orgSlug: 'depot', role: 'member' }],
        restricted: false,
    },
    {
        id: 'fixture-steward',
        name: 'Di Steward',
        email: 'di.steward@example.test',
        locale: 'en',
        tenantSlug: 'harbor',
        // The operator seam (`staffOrgSlug`): a real member keeps that registration honest.
        memberships: [{ orgSlug: 'steward', role: 'admin' }],
        restricted: false,
    },
    {
        id: 'fixture-limited',
        name: 'Eli Landsman',
        email: 'eli.landsman@example.test',
        locale: 'en',
        tenantSlug: 'lakeside',
        memberships: [{ orgSlug: 'wharf', role: 'restricted' }],
        restricted: true,
    },
]

/** No agreements: keel's suite exercises the access gate through core/agreements, never the seed. */
export const agreements: SeedAgreement[] = []

/**
 * No seeded schedules ON PURPOSE: `db/schedules.test.ts` inserts the rows it asserts on, and a seeded
 * schedule that happened to be due would add spawns its counts must then work around.
 */
export const jobSchedules: SeedJobSchedule[] = []

export function findTenant(slug: string): SeedTenant | undefined {
    return tenants.find((t) => t.slug === slug)
}

export function findOrg(slug: string): SeedOrg | undefined {
    return organizations.find((o) => o.slug === slug)
}
