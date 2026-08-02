import type { DbPort } from './db'
import type { EmailPort } from './email'
import type { LlmPort } from './llm'
import type { StoragePort } from './storage'

export interface SubmittedJob {
    id: string
    kind: string
    tenantId: string
    orgId: string | null
    payload: unknown
}

/**
 * What a running job handler is given: the ports it may touch plus the job's tenant/org/id context.
 * The framework owns this contract; both framework handlers (packages/keel/src/jobs/digest-email.ts) and
 * app-registered handlers (the seam's src/app-config/jobs.ts) implement JobHandler against it.
 */
interface JobContext {
    db: DbPort
    storage: StoragePort
    /** For handlers that send mail (e.g. digest-email); the export handler ignores it. */
    email: EmailPort
    /**
     * For handlers whose work IS a model call — summarizing, classifying, extracting. Background work
     * is where an LLM call belongs (it is slow, it can fail, and its result is an artifact), so the
     * handler contract carries the port rather than making a handler reach for the adapter registry.
     */
    llm: LlmPort
    tenantId: string
    orgId: string | null
    jobId: string
}

export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<{ resultKey?: string }>

/**
 * Jobs port — the execution SEAM only. The `jobs` row, its status column, and the
 * `job_status_changes` timeline are app-owned in packages/keel/src/db/jobs.ts, where recordJobStatus is the
 * single choke point for every transition (state-machine guarded). This port just kicks the work
 * off: the fake adapter runs a registered in-process handler (instantly by default, or leaves the
 * job 'queued' when the simulated world is held), while the real adapter starts a CodeBuild build
 * and the terminal transition arrives later via the inbound webhook route, which
 * calls back into packages/keel/src/db/jobs.recordJobStatus.
 */
export interface JobsPort {
    start(job: SubmittedJob): Promise<void>
}
