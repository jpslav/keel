import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import type { Membership } from '../ports/auth'

// Mock the defer seam: it imports '@/adapters' (server-only), and the deferred channels (email/sms)
// are out of scope here — this file asserts on the SYNCHRONOUS in_app rows only (the route-test dodge
// documented in api/service/jobs/route.test.ts).
vi.mock('./defer', () => ({ deferAfterResponse: async () => undefined }))

// Point all fake-adapter state at a throwaway dir BEFORE importing anything that touches pglite.
const tmp = makeTestTmpDir('app-notify-')
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

/**
 * Covers the recipient-selection logic the e2e can't reach cheaply (pre-merge review finding):
 * notifyJobTerminal's kind allowlist / unknown-job no-ops and notifyAdmins' active+managing filter.
 * Assertions target the DURABLE in_app rows (the notifications table) — the email/sms channels are
 * deferred, capture-only, and already proven by the destructive e2e; here they get inert stubs.
 */

function member(id: string, role: string, status: 'active' | 'pending'): Membership {
    return { id, email: `${id}@example.test`, name: id, role, status } as Membership
}

const MEMBERS: Membership[] = [
    member('admin-active', 'admin', 'active'),
    member('member-active', 'member', 'active'),
    member('admin-pending', 'admin', 'pending'),
]

async function makeTestDeps() {
    const { fakeDb } = await import('../adapters/fake/db')
    await fakeDb.ready()
    return {
        db: fakeDb,
        email: {
            async send() {
                /* inert — the email channel is e2e-proven */
            },
        },
        sms: async () => {
            /* inert */
        },
    }
}

async function primaryOrgIds(): Promise<{ tenantId: string; orgId: string }> {
    const { fakeDb } = await import('../adapters/fake/db')
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

async function insertJob(kind: string): Promise<string> {
    const { fakeDb } = await import('../adapters/fake/db')
    const { tenantId, orgId } = await primaryOrgIds()
    const row = await fakeDb
        .getDb()
        .insertInto('jobs')
        .values({ tenant_id: tenantId, org_id: orgId, kind, payload: {} })
        .returning('id')
        .executeTakeFirstOrThrow()
    return row.id
}

async function inAppRowsFor(jobId: string): Promise<{ recipient: string; kind: string }[]> {
    const { fakeDb } = await import('../adapters/fake/db')
    const rows = await fakeDb
        .getDb()
        .selectFrom('notifications')
        .select(['recipient_user_id', 'kind', 'payload'])
        .where('kind', '=', 'job.completed')
        .execute()
    return rows
        .filter((r) => (r.payload as { jobId?: string }).jobId === jobId)
        .map((r) => ({ recipient: r.recipient_user_id, kind: r.kind }))
}

describe('notifyJobTerminal', () => {
    test('an APP job kind reaching a terminal state notifies exactly the active managing members', async () => {
        const { notifyJobTerminal } = await import('./notify')
        const deps = await makeTestDeps()
        const { tenantId } = await primaryOrgIds()
        const jobId = await insertJob('export-dockets')

        await notifyJobTerminal(deps, { listMembers: async () => MEMBERS } as never, {
            tenantId,
            jobId,
            status: 'completed',
        })

        const rows = await inAppRowsFor(jobId)
        expect(rows.map((r) => r.recipient).sort()).toEqual(['admin-active'])
    })

    test('internal job kinds are a no-op', async () => {
        const { notifyJobTerminal } = await import('./notify')
        const deps = await makeTestDeps()
        const { tenantId } = await primaryOrgIds()
        const jobId = await insertJob('digest-email')

        await notifyJobTerminal(deps, { listMembers: async () => MEMBERS } as never, {
            tenantId,
            jobId,
            status: 'completed',
        })
        expect(await inAppRowsFor(jobId)).toEqual([])
    })

    test('an unknown job id is a silent no-op, and a listMembers failure never throws', async () => {
        const { notifyJobTerminal } = await import('./notify')
        const deps = await makeTestDeps()
        const { tenantId } = await primaryOrgIds()
        const missing = '00000000-0000-4000-8000-000000000000'

        await expect(
            notifyJobTerminal(deps, { listMembers: async () => MEMBERS } as never, {
                tenantId,
                jobId: missing,
                status: 'failed',
            }),
        ).resolves.toBeUndefined()

        const jobId = await insertJob('export-dockets')
        await expect(
            notifyJobTerminal(
                deps,
                {
                    listMembers: async () => {
                        throw new Error('idp down')
                    },
                } as never,
                { tenantId, jobId, status: 'completed' },
            ),
        ).resolves.toBeUndefined()
        expect(await inAppRowsFor(jobId)).toEqual([])
    })
})

describe('notifyAdmins fault isolation', () => {
    test('one bad recipient does not stall the rest', async () => {
        const { notifyAdmins } = await import('./notify')
        const deps = await makeTestDeps()
        const { tenantId, orgId } = await primaryOrgIds()

        // A prefs read that throws for the FIRST admin only — the second must still be notified.
        let first = true
        const throwingDb = new Proxy(deps.db, {
            get(target, prop) {
                if (prop === 'withTenant') {
                    return async (tid: string, fn: (trx: unknown) => unknown) => {
                        if (first) {
                            first = false
                            throw new Error('transient')
                        }
                        return (target.withTenant as (t: string, f: (trx: unknown) => unknown) => unknown)(tid, fn)
                    }
                }
                return (target as unknown as Record<string | symbol, unknown>)[prop]
            },
        })

        const reached = await notifyAdmins(
            { ...deps, db: throwingDb as typeof deps.db },
            {
                members: [member('admin-a', 'admin', 'active'), member('admin-b', 'admin', 'active')],
                tenantId,
                orgId,
                // An APP-registered kind (the fixture seam's), not a framework one: the fan-out has to
                // resolve copy for kinds the framework has never heard of.
                kind: 'docket.flagged',
                payload: { docketId: 'd1', label: 'l', orgName: 'x' },
            },
        )
        expect(reached).toBe(1)
    })
})
