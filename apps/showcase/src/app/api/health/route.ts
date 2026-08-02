import { appMode } from 'keel/adapters/index'

/** Liveness probe for the load balancer / CloudFront origin checks and the deploy runbook. */
export async function GET(): Promise<Response> {
    return Response.json({ ok: true, mode: appMode, at: new Date().toISOString() })
}
