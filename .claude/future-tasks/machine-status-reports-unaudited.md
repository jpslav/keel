# A machine's job status report writes no audit row

**Priority:** P3 · **Status:** open
**Found by:** `feat/authorize-non-session-actors`, 2026-11-16.

ADR-0012's naming section says that when an actor claims a job over the service API "it IS the
authorization actor on the resulting audit row". Since that branch, the first half is true: the
showcase's `service/jobs/[id]/status/route.ts` authorizes the caller as a machine actor
(`abilityActorFromService`, `update Job`). The second half is not, and never was. `recordJobStatus`
(`packages/keel/src/db/jobs.ts`) writes the job row and the `job_status_changes` timeline. It does not
write to `audit_events`, so the trail never shows which machine moved a job.

**Why it was left:** auditing it is a slice of its own. It needs a framework audit verb (for example
`job.status-reported`, in `FrameworkAuditAction`, `packages/keel/src/db/audit.ts`) and the
`recordAuditEvent` call after the write. It also needs a static-demo twin: the Actors tab's in-memory
driver advances jobs too, and the doctrine is feature parity. The machine attribution itself is already
solved: `auditActorOf(actor)` gives `actor_user_id` = `service-key:<org slug>` and the credential (which
key) for the 0014 columns.

**Decide first:** whether the timeline, which already records every hop with its message, is the record
for job status. If it is, the fix is to amend the ADR sentence, not to add a write. The webhook completion
path (`webhooks/jobs`, the `system:webhooks` writer) would need the same answer.
