import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

// Point all fake-adapter state at a throwaway dir BEFORE importing the adapters.
const tmp = mkdtempSync(path.join(tmpdir(), 'app-jobs-fake-'))
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

async function orgIds(tenantSlug: string, orgSlug: string): Promise<{ tenantId: string; orgId: string }> {
    const { fakeDb } = await import('./db')
    await fakeDb.ready()
    const tenant = await fakeDb
        .getDb()
        .selectFrom('tenants')
        .select('id')
        .where('slug', '=', tenantSlug)
        .executeTakeFirstOrThrow()
    const org = await fakeDb
        .getDb()
        .selectFrom('organizations')
        .select('id')
        .where('tenant_id', '=', tenant.id)
        .where('slug', '=', orgSlug)
        .executeTakeFirstOrThrow()
    return { tenantId: tenant.id, orgId: org.id }
}

function depotIds(): Promise<{ tenantId: string; orgId: string }> {
    return orgIds('harbor', 'depot')
}

describe('fake jobs (instant mode)', () => {
    test('runs an app job kind end-to-end: artifact in storage, queued->running->completed timeline', async () => {
        const { fakeDb } = await import('./db')
        const { fakeStorage } = await import('./storage')
        const { fakeJobs, listWorldJobs } = await import('./jobs')
        const { submitJob, listJobs } = await import('../../db/jobs')
        const { tenantId, orgId } = await depotIds()

        // A row so the export has real content. WHAT the handler writes is the app's business (the
        // fixture's is a two-column CSV; the showcase's escapes RFC-4180 and neutralizes formulas, and
        // is tested beside it) — what the FRAMEWORK owes is that the handler ran, its key was recorded,
        // and the bytes landed in storage.
        const label = `docket-${Date.now()}`
        await fakeDb.withTenant(tenantId, (trx) =>
            trx
                .insertInto('dockets')
                .values({
                    tenant_id: tenantId,
                    org_id: orgId,
                    label,
                    body: 'body',
                    created_by_user_id: 'fixture-lead',
                })
                .execute(),
        )

        const { id } = await submitJob(fakeDb, fakeJobs, { tenantId, orgId, kind: 'export-dockets', payload: {} })

        const view = (await listJobs(fakeDb, tenantId, orgId)).find((v) => v.id === id)!
        expect(view.status).toBe('completed')
        expect(view.resultKey).toBe(`exports/${tenantId}/${orgId}/${id}.csv`)
        expect(view.timeline.map((t) => t.status)).toEqual(['queued', 'running', 'completed'])

        const object = await fakeStorage.get(view.resultKey!)
        expect(object).not.toBeNull()
        const csv = new TextDecoder().decode(object!.body)
        expect(csv.split('\n')[0]).toBe('label,status')
        expect(csv).toContain(label)

        // the cross-tenant world view surfaces the completed job with resolved slugs
        const world = await listWorldJobs()
        const worldJob = world.find((w) => w.id === id)!
        expect(worldJob.tenantSlug).toBe('harbor')
        expect(worldJob.orgSlug).toBe('depot')
        expect(worldJob.status).toBe('completed')
    })

    test('unknown kind fails with a descriptive message', async () => {
        const { fakeDb } = await import('./db')
        const { fakeJobs } = await import('./jobs')
        const { submitJob, listJobs } = await import('../../db/jobs')
        const { tenantId, orgId } = await depotIds()

        const { id } = await submitJob(fakeDb, fakeJobs, { tenantId, orgId, kind: 'not-a-real-kind', payload: {} })

        const view = (await listJobs(fakeDb, tenantId, orgId)).find((v) => v.id === id)!
        expect(view.status).toBe('failed')
        expect(view.error).toContain('unknown job kind')
        expect(view.timeline.map((t) => t.status)).toEqual(['queued', 'running', 'failed'])
    })
})

describe('fake jobs (held world)', () => {
    test('a job already claimed by another runner is skipped, not a thrown error', async () => {
        const { fakeDb } = await import('./db')
        const { fakeJobs, runPendingJobs, JOBS_HELD_FLAG } = await import('./jobs')
        const { setFlag } = await import('./analytics')
        const { submitJob, listJobs, recordJobStatus } = await import('../../db/jobs')
        const { tenantId, orgId } = await depotIds()

        setFlag(JOBS_HELD_FLAG, true)
        try {
            const { id } = await submitJob(fakeDb, fakeJobs, { tenantId, orgId, kind: 'export-dockets', payload: {} })
            // simulate a concurrent runner having already claimed the job
            await recordJobStatus(fakeDb, tenantId, id, 'running')

            const count = await runPendingJobs()
            expect(count).toBe(0)

            // still 'running', still exactly two timeline entries — the losing runner wrote nothing
            const view = (await listJobs(fakeDb, tenantId, orgId)).find((v) => v.id === id)!
            expect(view.status).toBe('running')
            expect(view.timeline.map((t) => t.status)).toEqual(['queued', 'running'])
            // finish it so later tests never see a stray queued/running job
            await recordJobStatus(fakeDb, tenantId, id, 'failed', { error: 'test cleanup' })
        } finally {
            setFlag(JOBS_HELD_FLAG, false)
        }
    })

    test('held submissions stay queued; runPendingJobs steps them forward', async () => {
        const { fakeDb } = await import('./db')
        const { fakeJobs, runPendingJobs, JOBS_HELD_FLAG } = await import('./jobs')
        const { setFlag } = await import('./analytics')
        const { submitJob, listJobs } = await import('../../db/jobs')
        const { tenantId, orgId } = await depotIds()

        setFlag(JOBS_HELD_FLAG, true)
        try {
            const { id } = await submitJob(fakeDb, fakeJobs, { tenantId, orgId, kind: 'export-dockets', payload: {} })
            expect((await listJobs(fakeDb, tenantId, orgId)).find((v) => v.id === id)!.status).toBe('queued')

            const count = await runPendingJobs()
            expect(count).toBe(1)

            const view = (await listJobs(fakeDb, tenantId, orgId)).find((v) => v.id === id)!
            expect(view.status).toBe('completed')
            expect(view.timeline.map((t) => t.status)).toEqual(['queued', 'running', 'completed'])
        } finally {
            setFlag(JOBS_HELD_FLAG, false)
        }
    })
})

describe('listPendingBuilds (builder-console pool)', () => {
    test('excludes service-managed orgs and terminal jobs, oldest-first, across tenants', async () => {
        const { fakeDb } = await import('./db')
        const { fakeJobs, listPendingBuilds, JOBS_HELD_FLAG } = await import('./jobs')
        const { setFlag } = await import('./analytics')
        const { submitJob, recordJobStatus } = await import('../../db/jobs')
        const managed = await orgIds('harbor', 'depot')
        const sibling = await orgIds('harbor', 'annex')
        const other = await orgIds('lakeside', 'wharf')

        setFlag(JOBS_HELD_FLAG, true)
        try {
            // Held → each submission parks in `queued`. Created in this order, so createdAt is
            // monotonic and the oldest-first assertion is deterministic.
            const managedJob = (
                await submitJob(fakeDb, fakeJobs, {
                    tenantId: managed.tenantId,
                    orgId: managed.orgId,
                    kind: 'export-dockets',
                    payload: {},
                })
            ).id
            const siblingJob = (
                await submitJob(fakeDb, fakeJobs, {
                    tenantId: sibling.tenantId,
                    orgId: sibling.orgId,
                    kind: 'export-dockets',
                    payload: {},
                })
            ).id
            const otherJob = (
                await submitJob(fakeDb, fakeJobs, {
                    tenantId: other.tenantId,
                    orgId: other.orgId,
                    kind: 'export-dockets',
                    payload: {},
                })
            ).id
            // A fourth sibling-org job driven to a terminal state — must NOT appear in the pool.
            const terminalJob = (
                await submitJob(fakeDb, fakeJobs, {
                    tenantId: sibling.tenantId,
                    orgId: sibling.orgId,
                    kind: 'export-dockets',
                    payload: {},
                })
            ).id
            await recordJobStatus(fakeDb, sibling.tenantId, terminalJob, 'failed', { error: 'terminal fixture' })

            const builds = await listPendingBuilds()
            const ids = builds.map((b) => b.jobId)

            expect(ids).toContain(siblingJob)
            expect(ids).toContain(otherJob)
            // service-managed org excluded, terminal job excluded
            expect(ids).not.toContain(managedJob)
            expect(ids).not.toContain(terminalJob)
            // never surfaces a service-managed org, and every row is non-terminal
            expect(builds.every((b) => b.orgSlug !== 'depot')).toBe(true)
            expect(builds.every((b) => b.status === 'queued' || b.status === 'running')).toBe(true)
            // joined slugs come through; oldest-first (createdAt non-decreasing)
            expect(builds.find((b) => b.jobId === otherJob)?.tenantSlug).toBe('lakeside')
            expect(builds.find((b) => b.jobId === otherJob)?.orgSlug).toBe('wharf')
            const times = builds.map((b) => b.createdAt)
            expect([...times].sort()).toEqual(times)
        } finally {
            setFlag(JOBS_HELD_FLAG, false)
        }
    })
})

describe('produceJobArtifact (artifact-only, no status write)', () => {
    test('writes the CSV and records NO status change; re-run is idempotent', async () => {
        const { fakeDb } = await import('./db')
        const { fakeStorage } = await import('./storage')
        const { fakeJobs, produceJobArtifact, JOBS_HELD_FLAG } = await import('./jobs')
        const { setFlag } = await import('./analytics')
        const { submitJob, listJobs } = await import('../../db/jobs')
        const { tenantId, orgId } = await depotIds()

        setFlag(JOBS_HELD_FLAG, true)
        try {
            const label = `artifact-${Date.now()}`
            await fakeDb.withTenant(tenantId, (trx) =>
                trx
                    .insertInto('dockets')
                    .values({
                        tenant_id: tenantId,
                        org_id: orgId,
                        label,
                        body: 'artifact body',
                        created_by_user_id: 'fixture-lead',
                    })
                    .execute(),
            )
            const { id } = await submitJob(fakeDb, fakeJobs, { tenantId, orgId, kind: 'export-dockets', payload: {} })

            const result = await produceJobArtifact(tenantId, id)
            expect(result).toEqual({ resultKey: `exports/${tenantId}/${orgId}/${id}.csv` })

            const object = await fakeStorage.get(`exports/${tenantId}/${orgId}/${id}.csv`)
            expect(object).not.toBeNull()
            expect(new TextDecoder().decode(object!.body)).toContain(label)

            // Crucially: producing the artifact wrote NO status change — the job is still queued.
            const view = (await listJobs(fakeDb, tenantId, orgId)).find((v) => v.id === id)!
            expect(view.status).toBe('queued')
            expect(view.timeline.map((t) => t.status)).toEqual(['queued'])

            // Re-running overwrites the same key — still exactly one artifact, still no status change.
            expect(await produceJobArtifact(tenantId, id)).toEqual({
                resultKey: `exports/${tenantId}/${orgId}/${id}.csv`,
            })
            expect((await listJobs(fakeDb, tenantId, orgId)).find((v) => v.id === id)!.timeline).toHaveLength(1)
        } finally {
            setFlag(JOBS_HELD_FLAG, false)
        }
    })

    test('unknown kind returns an error string', async () => {
        const { fakeDb } = await import('./db')
        const { fakeJobs, produceJobArtifact, JOBS_HELD_FLAG } = await import('./jobs')
        const { setFlag } = await import('./analytics')
        const { submitJob } = await import('../../db/jobs')
        const { tenantId, orgId } = await depotIds()

        setFlag(JOBS_HELD_FLAG, true)
        try {
            const { id } = await submitJob(fakeDb, fakeJobs, { tenantId, orgId, kind: 'not-a-real-kind', payload: {} })
            const result = await produceJobArtifact(tenantId, id)
            expect(result).toHaveProperty('error')
            expect((result as { error: string }).error).toContain('unknown job kind')
        } finally {
            setFlag(JOBS_HELD_FLAG, false)
        }
    })

    test('an unknown job is a NotFoundError', async () => {
        const { produceJobArtifact } = await import('./jobs')
        const { NotFoundError } = await import('../../ports/errors')
        const { tenantId } = await depotIds()
        await expect(produceJobArtifact(tenantId, '00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })
})
