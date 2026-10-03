/**
 * Which identity dimensions the People tab shows. Every keel app HAS a tenant and an org for every
 * person (the auth port requires both), but many apps only ever run one tenant, or one team, and then
 * a chip naming it on every row tells the viewer nothing. So a dimension is shown only when it
 * DISTINGUISHES the rows on screen — computed from the rows themselves, never from app configuration,
 * so the chip appears on its own the day a second tenant or team does. Role is always shown: it is the
 * one per-person fact every app has.
 */
export function peopleDimensions(people: { tenantSlug: string; orgs?: { orgSlug: string }[] }[]): {
    showTenant: boolean
    showOrg: boolean
} {
    const tenants = new Set(people.map((person) => person.tenantSlug))
    const orgs = new Set(people.flatMap((person) => (person.orgs ?? []).map((org) => org.orgSlug)))
    return { showTenant: tenants.size > 1, showOrg: orgs.size > 1 }
}
