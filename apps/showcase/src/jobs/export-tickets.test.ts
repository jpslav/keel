import type { DbPort } from 'keel/ports/db'
import type { StoragePort } from 'keel/ports/storage'
import { describe, expect, test } from 'vitest'
import { exportTicketsHandler } from './export-tickets'

/**
 * CSV ESCAPING IS APP CODE, so it is tested app-side.
 *
 * These assertions used to live in keel/adapters/fake/jobs.test.ts, where they rode along with the
 * framework's "did the jobs adapter dispatch, record a timeline and store an artifact" case. That
 * suite now runs against keel's own fixture app, whose export handler writes a deliberately plain
 * two-column file — so the RFC-4180 quoting and the CSV-formula neutralization moved here, to the
 * handler that actually implements them.
 *
 * The handler is driven DIRECTLY with stub ports rather than through the fake adapters: nothing here
 * needs a migrated pglite world, and the escaping is a pure function of the rows it is handed.
 */

interface TicketRow {
    ref: string
    subject: string
    status: string
    assignee_user_id: string | null
    created_at: string
}

/**
 * The thinnest DbPort that satisfies the handler: `withTenant` hands the callback a builder whose
 * only reachable path is selectFrom('tickets')…execute(). Typed through `unknown` because a faithful
 * Kysely transaction is far more surface than this test exercises.
 */
function stubDb(rows: TicketRow[]): DbPort {
    const chain = {
        select: () => chain,
        where: () => chain,
        orderBy: () => chain,
        execute: async () => rows,
    }
    const trx = { selectFrom: () => chain }
    return {
        getDb: () => {
            throw new Error('the export handler must not reach past withTenant')
        },
        withTenant: (async (_tenantId: string, fn: (t: unknown) => unknown) => fn(trx)) as DbPort['withTenant'],
        ready: async () => undefined,
        migrateToLatest: async () => undefined,
    } as unknown as DbPort
}

function stubStorage(): { storage: StoragePort; written: Map<string, string> } {
    const written = new Map<string, string>()
    const storage = {
        put: async (key: string, body: string) => {
            written.set(key, body)
        },
    } as unknown as StoragePort
    return { storage, written }
}

function row(overrides: Partial<TicketRow> = {}): TicketRow {
    return {
        ref: 'NW-1',
        subject: 'plain subject',
        status: 'open',
        assignee_user_id: null,
        created_at: '2026-01-01T00:00:00.000Z',
        ...overrides,
    }
}

async function runExport(rows: TicketRow[], orgId: string | null = 'org-1'): Promise<string> {
    const { storage, written } = stubStorage()
    const result = await exportTicketsHandler(
        {},
        {
            db: stubDb(rows),
            storage,
            email: {} as never,
            llm: {} as never,
            tenantId: 'tenant-1',
            orgId,
            jobId: 'job-1',
        },
    )
    expect(result.resultKey).toBe(`exports/tenant-1/${orgId ?? 'no-org'}/job-1.csv`)
    return written.get(result.resultKey!)!
}

describe('exportTicketsHandler', () => {
    test('writes the header row and one line per ticket, under the job export key', async () => {
        const csv = await runExport([row({ ref: 'NW-1', subject: 'first' }), row({ ref: 'NW-2', subject: 'second' })])
        expect(csv.split('\n')[0]).toBe('ref,subject,status,assignee,created_at')
        expect(csv.split('\n')).toHaveLength(3)
        expect(csv).toContain('NW-1,first,open,,2026-01-01T00:00:00.000Z')
    })

    test('escapes commas and quotes RFC-4180 style', async () => {
        const csv = await runExport([row({ subject: 'exported, "quoted", subject' })])
        expect(csv).toContain('"exported, ""quoted"", subject"')
    })

    test('neutralizes CSV formula injection with a leading apostrophe', async () => {
        // Subjects are written by CUSTOMERS, so a `=…` cell is not theoretical: quoting alone does
        // not stop Excel/Sheets evaluating it.
        const csv = await runExport([row({ subject: '=HYPERLINK("http://evil","x")' })])
        expect(csv).toContain(`'=HYPERLINK`)
        expect(csv).not.toContain('\n=HYPERLINK')
    })

    test('every formula trigger is neutralized, not just `=`', async () => {
        // The apostrophe goes immediately before the value, inside any RFC-4180 quoting the field
        // then needs (the \r case is quoted; the others are not).
        for (const subject of ['+1', '-1', '@SUM(A1)', '\tlead tab', '\rlead cr']) {
            const csv = await runExport([row({ subject })])
            expect(csv, JSON.stringify(subject)).toContain(`'${subject}`)
        }
    })

    test('a job with no active team still produces a valid header-only file', async () => {
        const csv = await runExport([], null)
        expect(csv).toBe('ref,subject,status,assignee,created_at')
    })
})
