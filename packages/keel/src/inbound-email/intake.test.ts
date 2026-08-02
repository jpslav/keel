import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { DEMO_INBOUND_DOMAIN, formatInboundRecipient } from '../core/inbound-email'

// Point fake-adapter state at a throwaway dir BEFORE importing pglite-backed modules (the webhooks.test
// precedent). Simulated mode is the default, so intake runs against the seeded fake db + fake auth.
const tmp = mkdtempSync(path.join(tmpdir(), 'app-inbound-intake-'))
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

const ADA = 'ada.keeper@example.test' // seed admin of the `depot` org (tenant `harbor`)
const DEPOT_SUPPORT = formatInboundRecipient('depot', 'support', DEMO_INBOUND_DOMAIN)

async function depotIds(): Promise<{ tenantId: string; orgId: string }> {
    const { fakeDb } = await import('../adapters/fake/db')
    await fakeDb.ready()
    const tenant = await fakeDb
        .getDb()
        .selectFrom('tenants')
        .select('id')
        .where('slug', '=', 'harbor')
        .executeTakeFirstOrThrow()
    const org = await fakeDb
        .getDb()
        .selectFrom('organizations')
        .select('id')
        .where('tenant_id', '=', tenant.id)
        .where('slug', '=', 'depot')
        .executeTakeFirstOrThrow()
    return { tenantId: tenant.id, orgId: org.id }
}

describe('intakeInboundEmail', () => {
    test('email from a member opens a row attributed to them, status handled', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { fakeAuth } = await import('../adapters/fake/auth')
        const { intakeInboundEmail } = await import('./intake')
        const { tenantId, orgId } = await depotIds()

        const outcome = await intakeInboundEmail(fakeDb, fakeAuth, {
            to: DEPOT_SUPPORT,
            from: `"Ada Keeper" <${ADA}>`,
            subject: 'Buy milk',
            bodyText: 'from the store\n\nOn Mon, someone wrote:\n> old quoted stuff',
        })

        expect(outcome.status).toBe('handled')
        expect(outcome.handler).toBe('support')
        expect(outcome.stored).toBe(true)

        // the docket exists in the depot org: subject line -> label, normalized (quote-stripped) text
        // -> body, and it lands OPEN
        const docket = await fakeDb.withTenant(tenantId, (trx) =>
            trx
                .selectFrom('dockets')
                .select(['label', 'body', 'status'])
                .where('org_id', '=', orgId)
                .where('label', '=', 'Buy milk')
                .executeTakeFirst(),
        )
        expect(docket?.body).toBe('from the store')
        expect(docket?.status).toBe('open')

        // the inbound row is 'handled'
        const row = await fakeDb.withTenant(tenantId, (trx) =>
            trx
                .selectFrom('inbound_emails')
                .select(['status', 'handler'])
                .where('id', '=', outcome.id!)
                .executeTakeFirstOrThrow(),
        )
        expect(row.status).toBe('handled')
        expect(row.handler).toBe('support')

        // audit trail carries the intake event beside the handler's own domain verb
        const audit = await fakeDb.withTenant(tenantId, (trx) =>
            trx.selectFrom('audit_events').select('action').where('subject_id', '=', outcome.id!).execute(),
        )
        expect(audit.map((a) => a.action)).toContain('inbound-email.received')
    })

    test('an unmatched sender is filed unmatched with no row created', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { fakeAuth } = await import('../adapters/fake/auth')
        const { intakeInboundEmail } = await import('./intake')
        const { tenantId, orgId } = await depotIds()

        const before = await fakeDb.withTenant(tenantId, (trx) =>
            trx.selectFrom('dockets').select('id').where('org_id', '=', orgId).execute(),
        )

        const outcome = await intakeInboundEmail(fakeDb, fakeAuth, {
            to: DEPOT_SUPPORT,
            from: 'stranger@nowhere.test',
            subject: 'let me in',
            bodyText: 'body',
        })

        expect(outcome.status).toBe('unmatched')
        expect(outcome.handler).toBe('support') // the handler ran and declined
        expect(outcome.stored).toBe(true)

        const after = await fakeDb.withTenant(tenantId, (trx) =>
            trx.selectFrom('dockets').select('id').where('org_id', '=', orgId).execute(),
        )
        expect(after.length).toBe(before.length) // nothing created
    })

    test('a restricted member is refused: email authoring grants no more than the UI', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { fakeAuth } = await import('../adapters/fake/auth')
        const { intakeInboundEmail } = await import('./intake')

        // Eli is an ACTIVE member of wharf but holds the `restricted` role, which the ability model
        // denies Docket.create in the product UI — the email path must deny it too (pre-merge review
        // finding: the handler originally matched on membership alone).
        const demoTenant = await fakeDb
            .getDb()
            .selectFrom('tenants')
            .select('id')
            .where('slug', '=', 'lakeside')
            .executeTakeFirstOrThrow()
        const demoOrg = await fakeDb
            .getDb()
            .selectFrom('organizations')
            .select('id')
            .where('tenant_id', '=', demoTenant.id)
            .where('slug', '=', 'wharf')
            .executeTakeFirstOrThrow()
        const docketsBefore = await fakeDb.withTenant(demoTenant.id, (trx) =>
            trx.selectFrom('dockets').select('id').where('org_id', '=', demoOrg.id).execute(),
        )

        const outcome = await intakeInboundEmail(fakeDb, fakeAuth, {
            to: formatInboundRecipient('wharf', 'support', DEMO_INBOUND_DOMAIN),
            from: 'eli.landsman@example.test',
            subject: 'sneaking one in',
            bodyText: 'via email',
        })

        expect(outcome.status).toBe('unmatched')
        const docketsAfter = await fakeDb.withTenant(demoTenant.id, (trx) =>
            trx.selectFrom('dockets').select('id').where('org_id', '=', demoOrg.id).execute(),
        )
        expect(docketsAfter.length).toBe(docketsBefore.length)
    })

    test('an unknown handler slug is filed unmatched with handler NULL', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { fakeAuth } = await import('../adapters/fake/auth')
        const { intakeInboundEmail } = await import('./intake')
        const { tenantId } = await depotIds()

        const outcome = await intakeInboundEmail(fakeDb, fakeAuth, {
            to: formatInboundRecipient('depot', 'bogus', DEMO_INBOUND_DOMAIN),
            from: `<${ADA}>`,
            subject: 'hi',
            bodyText: 'body',
        })

        expect(outcome.status).toBe('unmatched')
        expect(outcome.handler).toBeNull()
        expect(outcome.stored).toBe(true)

        const row = await fakeDb.withTenant(tenantId, (trx) =>
            trx
                .selectFrom('inbound_emails')
                .select(['status', 'handler', 'error'])
                .where('id', '=', outcome.id!)
                .executeTakeFirstOrThrow(),
        )
        expect(row.status).toBe('unmatched')
        expect(row.handler).toBeNull()
        expect(row.error).toContain('bogus')
    })

    test('an unresolvable org is unmatched and unstored (no tenant to anchor)', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { fakeAuth } = await import('../adapters/fake/auth')
        const { intakeInboundEmail } = await import('./intake')

        const outcome = await intakeInboundEmail(fakeDb, fakeAuth, {
            to: formatInboundRecipient('no-such-org', 'support', DEMO_INBOUND_DOMAIN),
            from: ADA,
            subject: 'hi',
            bodyText: 'body',
        })
        expect(outcome.status).toBe('unmatched')
        expect(outcome.stored).toBe(false)
        expect(outcome.id).toBeNull()
    })

    test('an unparseable recipient is unmatched and unstored', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { fakeAuth } = await import('../adapters/fake/auth')
        const { intakeInboundEmail } = await import('./intake')

        const outcome = await intakeInboundEmail(fakeDb, fakeAuth, {
            to: 'no-plus-tag@wherever.test',
            from: ADA,
            subject: 'hi',
            bodyText: 'body',
        })
        expect(outcome.status).toBe('unmatched')
        expect(outcome.stored).toBe(false)
    })
})
