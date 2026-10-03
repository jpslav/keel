import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import { orgIdForSlug } from './org-lookup'
import { tenantIdForSlug } from './tenant-lookup'
import { InvalidTransitionError } from '../core/state-machine'
import { NotFoundError } from '../ports/errors'
import type { JobsPort, SubmittedJob } from '../ports/jobs'

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

// Point all fake-adapter state at a throwaway dir BEFORE importing anything that touches pglite.
const tmp = makeTestTmpDir('app-jobs-db-')
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

/** A JobsPort that records every start() call and never advances the job — keeps it 'queued'. */
function stubJobs(): { port: JobsPort; calls: SubmittedJob[] } {
    const calls: SubmittedJob[] = []
    return {
        port: {
            async start(job) {
                calls.push(job)
            },
        },
        calls,
    }
}

async function ids(slug: string, orgSlug: string): Promise<{ tenantId: string; orgId: string }> {
    const { fakeDb } = await import('../adapters/fake/db')
    await fakeDb.ready()
    const tenantId = await tenantIdForSlug(fakeDb, slug)
    if (!tenantId) throw new Error(`no tenant: ${slug}`)
    const orgId = await orgIdForSlug(fakeDb, tenantId, orgSlug)
    if (!orgId) throw new Error(`no org: ${orgSlug}`)
    return { tenantId, orgId }
}

describe('submitJob', () => {
    test('persists the job + a queued timeline entry, then calls the port with the submitted job', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { submitJob, listJobs } = await import('./jobs')
        const { tenantId, orgId } = await ids('harbor', 'depot')
        const jobs = stubJobs()

        const { id } = await submitJob(fakeDb, jobs.port, {
            tenantId,
            orgId,
            kind: 'export-dockets',
            payload: { a: 1 },
        })

        expect(jobs.calls).toHaveLength(1)
        expect(jobs.calls[0]).toEqual({ id, kind: 'export-dockets', tenantId, orgId, payload: { a: 1 } })

        const views = await listJobs(fakeDb, tenantId, orgId)
        const view = views.find((v) => v.id === id)
        expect(view).toBeDefined()
        expect(view!.status).toBe('queued')
        expect(view!.timeline.map((t) => t.status)).toEqual(['queued'])
    })
})

describe('recordJobStatus', () => {
    test('rejects an illegal transition and allows the legal path', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { submitJob, recordJobStatus, listJobs } = await import('./jobs')
        const { tenantId, orgId } = await ids('harbor', 'depot')
        const jobs = stubJobs()

        const { id } = await submitJob(fakeDb, jobs.port, { tenantId, orgId, kind: 'export-dockets', payload: {} })

        // queued -> completed is not in the machine
        await expect(recordJobStatus(fakeDb, tenantId, id, 'completed')).rejects.toThrow(InvalidTransitionError)

        // queued -> running -> completed is
        await recordJobStatus(fakeDb, tenantId, id, 'running')
        await recordJobStatus(fakeDb, tenantId, id, 'completed', { resultKey: 'exports/x.csv' })

        const view = (await listJobs(fakeDb, tenantId, orgId)).find((v) => v.id === id)!
        expect(view.status).toBe('completed')
        expect(view.resultKey).toBe('exports/x.csv')
        expect(view.timeline.map((t) => t.status)).toEqual(['queued', 'running', 'completed'])
    })
})

describe('listJobs', () => {
    test('filters by org, orders newest-first, and embeds each timeline', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { submitJob, listJobs } = await import('./jobs')
        const primary = await ids('harbor', 'depot')
        const sibling = await ids('harbor', 'annex')
        const jobs = stubJobs()

        const first = await submitJob(fakeDb, jobs.port, {
            tenantId: primary.tenantId,
            orgId: primary.orgId,
            kind: 'export-dockets',
            payload: {},
        })
        await new Promise((r) => setTimeout(r, 5))
        const second = await submitJob(fakeDb, jobs.port, {
            tenantId: primary.tenantId,
            orgId: primary.orgId,
            kind: 'export-dockets',
            payload: {},
        })
        // A job in a different org of the same tenant must not leak into the primary org's listing.
        const other = await submitJob(fakeDb, jobs.port, {
            tenantId: sibling.tenantId,
            orgId: sibling.orgId,
            kind: 'export-dockets',
            payload: {},
        })

        const views = await listJobs(fakeDb, primary.tenantId, primary.orgId)
        // org filter: the sibling org's job is absent from the primary org's listing
        expect(views.some((v) => v.id === other.id)).toBe(false)
        // ordering: the two primary-org jobs come back newest-first (5ms gap guarantees distinct times)
        const relevant = views.filter((v) => v.id === first.id || v.id === second.id)
        expect(relevant.map((v) => v.id)).toEqual([second.id, first.id])
        // every returned job carries its embedded timeline
        expect(views.every((v) => v.timeline.length >= 1)).toBe(true)
        expect(views.find((v) => v.id === first.id)!.timeline.map((t) => t.status)).toEqual(['queued'])
    })
})

describe('listServiceJobs', () => {
    test('includes payload, omits timelines, and filters by status', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { submitJob, recordJobStatus, listServiceJobs } = await import('./jobs')
        const { tenantId, orgId } = await ids('harbor', 'depot')
        const jobs = stubJobs()

        const running = await submitJob(fakeDb, jobs.port, {
            tenantId,
            orgId,
            kind: 'export-dockets',
            payload: { n: 1 },
        })
        const queued = await submitJob(fakeDb, jobs.port, { tenantId, orgId, kind: 'export-dockets', payload: {} })
        await recordJobStatus(fakeDb, tenantId, running.id, 'running')

        const all = await listServiceJobs(fakeDb, tenantId, orgId)
        const view = all.find((j) => j.id === running.id)!
        expect(view.payload).toEqual({ n: 1 })
        // the service view is deliberately timeline-free (light polling)
        expect('timeline' in view).toBe(false)

        const onlyRunning = await listServiceJobs(fakeDb, tenantId, orgId, { status: 'running' })
        expect(onlyRunning.some((j) => j.id === running.id)).toBe(true)
        expect(onlyRunning.some((j) => j.id === queued.id)).toBe(false)
    })
})

describe('jobForOrg', () => {
    test('resolves an own-org job but returns null for another org or an absent id', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { submitJob, jobForOrg } = await import('./jobs')
        const primary = await ids('harbor', 'depot')
        const sibling = await ids('harbor', 'annex')
        const jobs = stubJobs()

        const { id } = await submitJob(fakeDb, jobs.port, {
            tenantId: primary.tenantId,
            orgId: primary.orgId,
            kind: 'export-dockets',
            payload: {},
        })

        expect(await jobForOrg(fakeDb, primary.tenantId, primary.orgId, id)).toEqual({ id, status: 'queued' })
        // same tenant, different org — indistinguishable from absent
        expect(await jobForOrg(fakeDb, sibling.tenantId, sibling.orgId, id)).toBeNull()
        expect(await jobForOrg(fakeDb, primary.tenantId, primary.orgId, NIL_UUID)).toBeNull()
    })
})

describe('recordWebhookCompletion', () => {
    test('walks a queued job through running to completed with the webhook message', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { submitJob, recordWebhookCompletion, listJobs } = await import('./jobs')
        const { tenantId, orgId } = await ids('harbor', 'depot')
        const jobs = stubJobs()
        const { id } = await submitJob(fakeDb, jobs.port, { tenantId, orgId, kind: 'export-dockets', payload: {} })

        const resultKey = `exports/${tenantId}/${orgId}/${id}.csv`
        const outcome = await recordWebhookCompletion(fakeDb, { tenantId, jobId: id, status: 'completed', resultKey })
        expect(outcome).toBe('applied')

        const view = (await listJobs(fakeDb, tenantId, orgId)).find((v) => v.id === id)!
        expect(view.status).toBe('completed')
        expect(view.resultKey).toBe(resultKey)
        expect(view.timeline.map((t) => t.status)).toEqual(['queued', 'running', 'completed'])
        expect(view.timeline.find((t) => t.status === 'running')!.message).toBe('completion webhook')
    })

    test("a resultKey outside the job's own org namespace is refused without any write", async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { submitJob, recordWebhookCompletion, listJobs } = await import('./jobs')
        const { tenantId, orgId } = await ids('harbor', 'depot')
        const sibling = await ids('harbor', 'annex')
        const jobs = stubJobs()
        const { id } = await submitJob(fakeDb, jobs.port, { tenantId, orgId, kind: 'export-dockets', payload: {} })

        // same tenant, foreign org — the org half of the namespace comes from the JOB ROW, so a
        // vendor-side payload can't point this job's signed download at another org's artifact
        for (const planted of [
            `exports/${tenantId}/${sibling.orgId}/x.csv`,
            `exports/${tenantId}/x.csv`,
            'exports/other-tenant/x.csv',
        ]) {
            expect(
                await recordWebhookCompletion(fakeDb, { tenantId, jobId: id, status: 'completed', resultKey: planted }),
            ).toBe('invalid-result-key')
        }

        const view = (await listJobs(fakeDb, tenantId, orgId)).find((v) => v.id === id)!
        expect(view.status).toBe('queued')
        expect(view.resultKey).toBeNull()
    })

    test('does not re-walk running when the job is already running', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { submitJob, recordJobStatus, recordWebhookCompletion, listJobs } = await import('./jobs')
        const { tenantId, orgId } = await ids('harbor', 'depot')
        const jobs = stubJobs()
        const { id } = await submitJob(fakeDb, jobs.port, { tenantId, orgId, kind: 'export-dockets', payload: {} })
        await recordJobStatus(fakeDb, tenantId, id, 'running')

        expect(await recordWebhookCompletion(fakeDb, { tenantId, jobId: id, status: 'completed' })).toBe('applied')
        const view = (await listJobs(fakeDb, tenantId, orgId)).find((v) => v.id === id)!
        expect(view.timeline.map((t) => t.status)).toEqual(['queued', 'running', 'completed'])
    })

    test('a redelivery of an already-terminal job is idempotent and appends nothing', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { submitJob, recordWebhookCompletion, listJobs } = await import('./jobs')
        const { tenantId, orgId } = await ids('harbor', 'depot')
        const jobs = stubJobs()
        const { id } = await submitJob(fakeDb, jobs.port, { tenantId, orgId, kind: 'export-dockets', payload: {} })

        expect(await recordWebhookCompletion(fakeDb, { tenantId, jobId: id, status: 'failed', error: 'boom' })).toBe(
            'applied',
        )
        expect(await recordWebhookCompletion(fakeDb, { tenantId, jobId: id, status: 'failed', error: 'again' })).toBe(
            'idempotent',
        )

        const view = (await listJobs(fakeDb, tenantId, orgId)).find((v) => v.id === id)!
        expect(view.status).toBe('failed')
        expect(view.error).toBe('boom')
        expect(view.timeline.map((t) => t.status)).toEqual(['queued', 'running', 'failed'])
    })

    test('a CONFLICTING terminal redelivery throws immediately — the genuine 409, never retried', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { submitJob, recordWebhookCompletion } = await import('./jobs')
        const { tenantId, orgId } = await ids('harbor', 'depot')
        const jobs = stubJobs()
        const { id } = await submitJob(fakeDb, jobs.port, { tenantId, orgId, kind: 'export-dockets', payload: {} })

        expect(await recordWebhookCompletion(fakeDb, { tenantId, jobId: id, status: 'completed' })).toBe('applied')
        await expect(recordWebhookCompletion(fakeDb, { tenantId, jobId: id, status: 'failed' })).rejects.toThrow(
            InvalidTransitionError,
        )
    })

    test('an unknown job in the tenant throws NotFoundError', async () => {
        const { fakeDb } = await import('../adapters/fake/db')
        const { recordWebhookCompletion } = await import('./jobs')
        const { tenantId } = await ids('harbor', 'depot')

        await expect(
            recordWebhookCompletion(fakeDb, { tenantId, jobId: NIL_UUID, status: 'completed' }),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})
