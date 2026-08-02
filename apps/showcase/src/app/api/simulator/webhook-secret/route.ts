import { isSimulated } from 'keel/adapters/index'
import { devWebhookSecret } from 'keel/adapters/fake/service-auth'
import { withPortErrors } from '../../respond'

/**
 * Simulator-mode gate, not a role gate (design invariant): 404s outside simulated mode, first line.
 * Reveals the per-checkout inbound-webhook secret so the operator can hand-POST /api/webhooks/jobs
 * as the real CodeBuild build would. Simulated-mode only — the real secret lives in the environment.
 */
export async function GET(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => Response.json({ secret: devWebhookSecret() }))
}
