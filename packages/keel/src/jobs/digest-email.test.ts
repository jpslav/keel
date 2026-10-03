// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { orgIdForSlug } from '../db/org-lookup'
import { tenantIdForSlug } from '../db/tenant-lookup'
import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'

/**
 * The digest handler's sending branch, run for real. `db/schedules.test.ts` proves a due schedule
 * SPAWNS a `digest-email` job, but it stubs the jobs port, so `digestEmailHandler` itself never runs
 * there; this file calls it directly against the fake db and the fake email catch-store.
 */

/**
 * `getTranslations` from `next-intl/server` refuses to run outside a React Server Component render, and
 * plain vitest is not one. This stand-in resolves the SAME merged catalog (framework + the fixture's own)
 * that the real call would, descending into the requested namespace first because the handler asks for
 * `namespace: 'email'` and then looks keys up unqualified — so the copy asserted below is the real copy.
 */
vi.mock('next-intl/server', () => ({
    getTranslations: async ({ namespace }: { locale?: string; namespace?: string } = {}) => {
        const { mergeMessages } = await import('../i18n/messages')
        const { loadAppMessages } = await import('@app-config/messages')
        const framework = (await import('../i18n/messages/en.json')).default
        const merged = mergeMessages(framework, await loadAppMessages('en'))
        const lookup = (tree: unknown, dotted: string): unknown =>
            dotted
                .split('.')
                .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree)
        const scope = namespace ? lookup(merged, namespace) : merged
        return (key: string, values?: Record<string, string | number>) => {
            const message = lookup(scope, key)
            if (typeof message !== 'string') throw new Error(`missing message "${namespace ?? ''}.${key}"`)
            return message.replace(/\{(\w+)\}/g, (_match, name: string) => String(values?.[name] ?? `{${name}}`))
        }
    },
}))

/**
 * The fixture registers an empty digest source (`test-fixture/app-config/digest.ts`), which only reaches
 * the empty-state branch. Replacing the registration here lets one test drive the populated branch —
 * counting past the recent-items cap, snipping a long body — without giving the fixture a table to read.
 * Every test here therefore runs against this replacement, never the fixture's own registration.
 *
 * Not covered: the recipient's seed locale choosing the copy. The translation stand-in above ignores
 * `locale` and always reads the English catalog, and every recipient these tests reach is English.
 */
const digest = vi.hoisted(() => ({ bodies: [] as string[] }))
vi.mock('@app-config/digest', () => ({ digestBodies: async () => digest.bodies }))

// Fake-adapter state goes to a throwaway dir before anything opens pglite or the email catch-store.
const tmp = makeTestTmpDir('digest-email-')
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

beforeEach(async () => {
    digest.bodies = []
    const { clearCaughtEmails } = await import('../adapters/fake/email')
    clearCaughtEmails()
})

async function depotIds(): Promise<{ tenantId: string; orgId: string }> {
    const { fakeDb } = await import('../adapters/fake/db')
    await fakeDb.ready()
    const tenantId = (await tenantIdForSlug(fakeDb, 'harbor'))!
    const orgId = (await orgIdForSlug(fakeDb, tenantId, 'depot'))!
    return { tenantId, orgId }
}

async function runHandler(tenantId: string, orgId: string) {
    const { fakeDb } = await import('../adapters/fake/db')
    const { fakeStorage } = await import('../adapters/fake/storage')
    const { fakeEmail } = await import('../adapters/fake/email')
    const { fakeLlm } = await import('../adapters/fake/llm')
    const { digestEmailHandler } = await import('./digest-email')
    return digestEmailHandler(
        {},
        { db: fakeDb, storage: fakeStorage, email: fakeEmail, llm: fakeLlm, tenantId, orgId, jobId: 'digest-test' },
    )
}

async function sentEmails() {
    const { listCaughtEmails } = await import('../adapters/fake/email')
    return listCaughtEmails()
}

describe('digestEmailHandler', () => {
    it("sends the empty-state digest to the org's admin, named for the org", async () => {
        const { tenantId, orgId } = await depotIds()

        await runHandler(tenantId, orgId)

        // `depot`'s seeded admin is Ada Keeper; the org is 'Harbor Depot'.
        const caught = await sentEmails()
        expect(caught).toHaveLength(1)
        expect(caught[0]?.to).toBe('ada.keeper@example.test')
        expect(caught[0]?.subject).toBe('Your Harbor Depot digest')
        expect(caught[0]?.text).toContain('Nothing to report.')
        expect(caught[0]?.text).toContain('Your team has 0 open items.')
    })

    it('counts every body but lists only the recent-items cap, snipping a long one', async () => {
        const { tenantId, orgId } = await depotIds()
        digest.bodies = ['A'.repeat(80), 'Second item', 'Third item', 'Fourth item', 'Fifth item', 'Sixth item']

        await runHandler(tenantId, orgId)

        const [sent] = await sentEmails()
        expect(sent?.text).toContain('Your team has 6 open items.')
        expect(sent?.text).not.toContain('Nothing to report.')
        expect(sent?.text).toContain(`${'A'.repeat(59)}…`)
        expect(sent?.text).not.toContain('A'.repeat(60))
        expect(sent?.text).toContain('Fifth item')
        expect(sent?.text).not.toContain('Sixth item')
    })

    it('falls back to a synthetic per-org address when the org has no seeded person', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { tenantId } = await depotIds()
        const slug = 'fixture-unstaffed'
        const org = await fakeDb
            .getDb()
            .insertInto('organizations')
            .values({ tenant_id: tenantId, slug, name: 'Unstaffed Berth' })
            .returning('id')
            .executeTakeFirstOrThrow()

        await runHandler(tenantId, org.id)

        const [sent] = await sentEmails()
        expect(sent?.to).toBe(`${slug}@digest.example`)
        expect(sent?.subject).toBe('Your Unstaffed Berth digest')
    })
})
