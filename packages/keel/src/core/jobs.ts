import { appJobKinds, type AppJobKind } from '@app-config/jobs'
import { defineStateMachine } from './state-machine'

export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/**
 * The job lifecycle. No queued -> completed shortcut on purpose: even an instant fake records the
 * full story (queued -> running -> completed), so the timeline reads identically whether the work
 * ran in-process (fake) or on CodeBuild (real). Both terminal states have no outgoing transitions.
 */
export const jobStatusMachine = defineStateMachine<JobStatus>({
    queued: ['running', 'failed'],
    running: ['completed', 'failed'],
    completed: [],
    failed: [],
})

// The FRAMEWORK's own job kinds. digest-email: the scheduled-work worked example — a
// scheduler (packages/keel/src/db/schedules.ts) spawns it through this same jobs machinery, and its handler composes
// an org digest and sends it via the email port. App kinds register through the seam
// (src/app-config/jobs.ts appJobKinds), composed below exactly like the migration registry — a
// new kind is how instances extend jobs (ADR-0012; "one worked example per class").
export const FRAMEWORK_JOB_KINDS = ['digest-email'] as const
type FrameworkJobKind = (typeof FRAMEWORK_JOB_KINDS)[number]

/** The full kind union: framework base + the app's registered kinds. */
export type JobKind = FrameworkJobKind | AppJobKind

export function isJobKind(value: string): value is JobKind {
    // Composed lazily (never a top-level spread) so the core↔seam value cycle stays safe: appJobKinds
    // is only read when isJobKind is CALLED (request time), never at module-init. See ADR-0012 risks.
    return (
        (FRAMEWORK_JOB_KINDS as readonly string[]).includes(value) || (appJobKinds as readonly string[]).includes(value)
    )
}

export function isJobStatus(value: string): value is JobStatus {
    return (JOB_STATUSES as readonly string[]).includes(value)
}

/**
 * The storage namespace a job's export artifacts must live in. Encodes BOTH tenant AND org because
 * storage isolation is purely by key convention: the service/webhook boundaries prefix-lock a
 * caller-supplied resultKey to this, so a planted key can never point a signed download at another
 * org's (or tenant's) artifact. Jobs with no active team use a reserved literal segment — org ids
 * are uuids, so 'no-org' cannot collide with a real org's namespace.
 */
export function exportKeyPrefix(tenantId: string, orgId: string | null): string {
    return `exports/${tenantId}/${orgId ?? 'no-org'}/`
}
