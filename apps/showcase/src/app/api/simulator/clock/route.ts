import { db, isSimulated, jobs } from 'keel/adapters/index'
import { advanceClockMs, readClockOffsetMs, resetClock, worldNow } from 'keel/adapters/fake/clock'
import { runDueSchedules } from 'keel/db/schedules'
import { runDueDeliveries } from 'keel/db/webhooks'
import { dispatchWebhook } from 'keel/server-lib/webhook-dispatch'
import { withPortErrors } from '../../respond'

/** Advance is capped at a year of delta per call — a demo control, not an arbitrary time machine. */
const MAX_ADVANCE_MS = 366 * 86_400_000

/**
 * Simulator world-clock control (simulated-mode-only; 404 in real). `{ action: 'advance', deltaMs }` moves
 * the simulated clock forward; `{ action: 'reset' }` returns to real time. Either way the due-scan then
 * runs at the new world "now", so advancing the clock past a schedule's next_run_at makes it fire
 * immediately — the "time jumps forward, the digest appears" demo. Exempt from the per-actor
 * authorize() scan by the simulator/ simulated-mode gate, the simulated-world-surface precedent.
 */
export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
        if (typeof body !== 'object' || body === null)
            return Response.json({ error: 'invalid-payload' }, { status: 400 })

        if (body.action === 'reset') {
            resetClock()
        } else if (body.action === 'advance') {
            const deltaMs = body.deltaMs
            if (typeof deltaMs !== 'number' || !Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > MAX_ADVANCE_MS) {
                return Response.json({ error: 'invalid-delta' }, { status: 400 })
            }
            advanceClockMs(deltaMs)
        } else {
            return Response.json({ error: 'invalid-action' }, { status: 400 })
        }

        const now = worldNow()
        const { spawned, failed } = await runDueSchedules(db, jobs, now)
        // Same tick drains due webhook deliveries — so "advance the clock past a retry's
        // backoff and watch it fire" works alongside "advance past a schedule and watch it fire".
        const deliveries = await runDueDeliveries(db, now, dispatchWebhook)
        return Response.json({ ok: true, clockOffsetMs: readClockOffsetMs(), spawned, failed, deliveries })
    })
}
