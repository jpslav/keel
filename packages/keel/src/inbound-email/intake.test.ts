import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import { DEMO_INBOUND_DOMAIN, formatInboundRecipient } from '../core/inbound-email'

// Point fake-adapter state at a throwaway dir BEFORE importing pglite-backed modules (the webhooks.test
// precedent). Simulated mode is the default, so intake runs against the seeded fake db + fake auth.
const tmp = makeTestTmpDir('app-inbound-intake-')
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

        // ...whose detail says why it was filed so: its handler handled it
        const handled = await fakeDb.withTenant(tenantId, (trx) =>
            trx
                .selectFrom('audit_events')
                .select('detail')
                .where('subject_id', '=', outcome.id!)
                .where('action', '=', 'inbound-email.received')
                .executeTakeFirstOrThrow(),
        )
        expect(handled.detail).toEqual({ outcome: 'handled' })

        // ...and both rows name the PERSON as the actor and THIS email as the credential they acted with,
        // so a docket filed by email never reads like one filed in the browser.
        const credentialed = await fakeDb.withTenant(tenantId, (trx) =>
            trx
                .selectFrom('audit_events')
                .select(['action', 'actor_user_id', 'credential_kind', 'credential_id'])
                .where('subject_id', 'in', [outcome.id!, outcome.subjectId!])
                .orderBy('action')
                .execute(),
        )
        expect(credentialed).toEqual([
            {
                action: 'docket.created',
                actor_user_id: 'fixture-lead',
                credential_kind: 'inbound-email',
                credential_id: outcome.id,
            },
            {
                action: 'inbound-email.received',
                actor_user_id: 'fixture-lead',
                credential_kind: 'inbound-email',
                credential_id: outcome.id,
            },
        ])
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

        // A stranger's email proved nobody's identity: the system actor's row records no credential.
        const received = await fakeDb.withTenant(tenantId, (trx) =>
            trx
                .selectFrom('audit_events')
                .select(['actor_user_id', 'credential_kind', 'credential_id', 'detail'])
                .where('subject_id', '=', outcome.id!)
                .executeTakeFirstOrThrow(),
        )
        expect(received).toEqual({
            actor_user_id: 'system:inbound-email',
            credential_kind: null,
            credential_id: null,
            // WHY, in the closed vocabulary: the handler declined. Its reason names the sender, so it stays
            // on the inbound row and never reaches the append-only trail.
            detail: { outcome: 'unmatched', cause: 'declined' },
        })
        expect(outcome.reason).toContain('stranger@nowhere.test')
        const trail = await fakeDb.withTenant(tenantId, (trx) =>
            trx.selectFrom('audit_events').selectAll().where('subject_id', '=', outcome.id!).execute(),
        )
        expect(JSON.stringify(trail)).not.toContain('stranger@nowhere.test')
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

        const received = await fakeDb.withTenant(tenantId, (trx) =>
            trx
                .selectFrom('audit_events')
                .select('detail')
                .where('subject_id', '=', outcome.id!)
                .executeTakeFirstOrThrow(),
        )
        expect(received.detail).toEqual({ outcome: 'unmatched', cause: 'no-handler' })
    })

    test('a handler that throws is filed failed, and its audit row says so without the message', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { fakeAuth } = await import('../adapters/fake/auth')
        const { intakeInboundEmail } = await import('./intake')
        const { inboundHandlers } = await import('./handlers')
        const { tenantId } = await depotIds()

        // A poison handler, registered for this test only under a slug no seam uses.
        inboundHandlers['explodes'] = () => Promise.reject(new Error(`cannot parse mail from ${ADA}`))
        try {
            const outcome = await intakeInboundEmail(fakeDb, fakeAuth, {
                to: formatInboundRecipient('depot', 'explodes', DEMO_INBOUND_DOMAIN),
                from: ADA,
                subject: 'hi',
                bodyText: 'body',
            })
            expect(outcome.status).toBe('failed')
            expect(outcome.reason).toContain(ADA)

            const trail = await fakeDb.withTenant(tenantId, (trx) =>
                trx
                    .selectFrom('audit_events')
                    .select(['action', 'actor_user_id', 'detail'])
                    .where('subject_id', '=', outcome.id!)
                    .execute(),
            )
            expect(trail).toEqual([
                {
                    action: 'inbound-email.received',
                    actor_user_id: 'system:inbound-email',
                    detail: { outcome: 'failed', cause: 'handler-threw' },
                },
            ])
        } finally {
            delete inboundHandlers['explodes']
        }
    })

    test("keel's own recording failing after the handler returned is not blamed on the handler", async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { fakeAuth } = await import('../adapters/fake/auth')
        const { intakeInboundEmail } = await import('./intake')
        const { inboundHandlers } = await import('./handlers')
        const { tenantId } = await depotIds()

        // The handler returns 'handled', naming a credential id Postgres cannot store (a NUL), so intake's
        // own audit insert for the handled email throws.
        inboundHandlers['unrecordable'] = () =>
            Promise.resolve({
                status: 'handled',
                actorUserId: 'fixture-lead',
                credential: { kind: 'inbound-email', id: 'bad\u0000id' },
            })
        try {
            const outcome = await intakeInboundEmail(fakeDb, fakeAuth, {
                to: formatInboundRecipient('depot', 'unrecordable', DEMO_INBOUND_DOMAIN),
                from: ADA,
                subject: 'hi',
                bodyText: 'body',
            })
            expect(outcome.status).toBe('failed')

            const trail = await fakeDb.withTenant(tenantId, (trx) =>
                trx
                    .selectFrom('audit_events')
                    .select(['action', 'actor_user_id', 'detail'])
                    .where('subject_id', '=', outcome.id!)
                    .execute(),
            )
            expect(trail).toEqual([
                {
                    action: 'inbound-email.received',
                    actor_user_id: 'system:inbound-email',
                    detail: { outcome: 'failed', cause: 'intake-threw' },
                },
            ])
        } finally {
            delete inboundHandlers['unrecordable']
        }
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
