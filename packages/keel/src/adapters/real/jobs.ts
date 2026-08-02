import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild'
import type { JobsPort } from '../../ports/jobs'

/**
 * AUTHORED — CUTOVER (`job-runner`): typechecked against @aws-sdk/client-codebuild, never run
 * against a real project. Starting the build is ALL this seam does — the job stays 'queued' until
 * the build's FINAL step POSTs /api/webhooks/jobs with `Authorization: Bearer $WEBHOOK_SECRET` and
 * `{ jobId, tenantId, status: 'completed' | 'failed', resultKey?, error? }`, which records the
 * terminal transition via packages/keel/src/db/jobs.recordWebhookCompletion (idempotent under redelivery). The
 * build receives its context through environment overrides, mirroring the fake handler's args —
 * including JOB_TENANT_ID, which the webhook echoes back as `tenantId` so the completion is scoped
 * to the right tenant without the build having to look it up.
 */
export function createRealJobs(project: string, region: string): JobsPort {
    const client = new CodeBuildClient({ region })

    return {
        async start(job) {
            await client.send(
                new StartBuildCommand({
                    projectName: project,
                    environmentVariablesOverride: [
                        { name: 'JOB_ID', value: job.id, type: 'PLAINTEXT' },
                        { name: 'JOB_KIND', value: job.kind, type: 'PLAINTEXT' },
                        { name: 'JOB_TENANT_ID', value: job.tenantId, type: 'PLAINTEXT' },
                        { name: 'JOB_PAYLOAD', value: JSON.stringify(job.payload ?? {}), type: 'PLAINTEXT' },
                    ],
                }),
            )
        },
    }
}
