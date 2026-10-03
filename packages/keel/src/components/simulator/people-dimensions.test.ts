import { describe, expect, it } from 'vitest'
import { peopleDimensions } from './people-dimensions'

const person = (tenantSlug: string, ...orgSlugs: string[]) => ({
    tenantSlug,
    orgs: orgSlugs.map((orgSlug) => ({ orgSlug })),
})

describe('peopleDimensions', () => {
    it('hides tenant and org when everyone shares one tenant and one team', () => {
        expect(peopleDimensions([person('harbor', 'depot'), person('harbor', 'depot')])).toEqual({
            showTenant: false,
            showOrg: false,
        })
    })

    it('shows the org once a second team exists, even inside one tenant', () => {
        expect(peopleDimensions([person('harbor', 'depot'), person('harbor', 'annex')])).toEqual({
            showTenant: false,
            showOrg: true,
        })
        // ...including when the second team is only one person's second membership.
        expect(peopleDimensions([person('harbor', 'depot', 'annex')]).showOrg).toBe(true)
    })

    it('shows the tenant once the rows span two tenants', () => {
        expect(peopleDimensions([person('harbor', 'depot'), person('lakeside', 'wharf')])).toEqual({
            showTenant: true,
            showOrg: true,
        })
    })

    it('treats rows without org data as naming no org', () => {
        expect(peopleDimensions([{ tenantSlug: 'harbor' }, { tenantSlug: 'harbor' }]).showOrg).toBe(false)
    })
})
