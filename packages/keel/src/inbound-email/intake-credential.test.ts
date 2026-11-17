import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import { DEMO_INBOUND_DOMAIN, formatInboundRecipient } from '../core/inbound-email'

// The intake records on its `inbound-email.received` row exactly the credential the HANDLER reports, and
// nothing it would have to infer. A handler that attributes a message to a synthetic actor (an open desk's
// public-intake actor) reports none, so the row records none. Before, the intake inferred the email
// credential from "the actor is not the system actor", and recorded it against the synthetic actor.
// The registry is replaced for this file only, so the fixture's own `support` handler is untouched.
vi.mock('./handlers', () => ({
    inboundHandlers: {
        synthetic: async () => ({ status: 'handled', actorUserId: 'desk:public-intake' }),
    },
}))

const tmp = makeTestTmpDir('app-inbound-credential-')
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

describe('intakeInboundEmail: the received row records the credential the handler reports', () => {
    test('a handler naming a synthetic actor and no credential records none', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { fakeAuth } = await import('../adapters/fake/auth')
        const { intakeInboundEmail } = await import('./intake')
        await fakeDb.ready()

        const outcome = await intakeInboundEmail(fakeDb, fakeAuth, {
            to: formatInboundRecipient('depot', 'synthetic', DEMO_INBOUND_DOMAIN),
            from: 'anyone@nowhere.test',
            subject: 'hello',
            bodyText: 'body',
        })
        expect(outcome.status).toBe('handled')

        const tenant = await fakeDb
            .getDb()
            .selectFrom('tenants')
            .select('id')
            .where('slug', '=', 'harbor')
            .executeTakeFirstOrThrow()
        const row = await fakeDb.withTenant(tenant.id, (trx) =>
            trx
                .selectFrom('audit_events')
                .select(['actor_user_id', 'credential_kind', 'credential_id'])
                .where('subject_id', '=', outcome.id!)
                .executeTakeFirstOrThrow(),
        )
        expect(row).toEqual({ actor_user_id: 'desk:public-intake', credential_kind: null, credential_id: null })
    })
})
