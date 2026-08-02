import { after } from 'next/server'
import { analytics, isSimulated } from '../adapters/index'

/**
 * Deferred-work seam — a thin, systematized convention over Next's `after()` so slices don't
 * each hand-roll "run this side effect once the response is out".
 * The canonical use is notification email: send it AFTER the response is flushed, so a slow mail
 * provider never adds latency to the user's request. When work outgrows the request lifecycle, this is
 * the on-ramp to the jobs port — the same call site becomes `jobs.start(...)`.
 *
 * Two behaviours, one signature:
 *
 * - **Real mode**: `after(work)` — the work runs in a post-response continuation.
 *   A throw inside it is caught and reported via analytics (`deferred_work_failed`), never surfaced —
 *   the response has already been sent, so there is nothing to fail.
 *
 * - **Simulated mode** (dev, e2e, demo): run the work INLINE (awaited) instead — deliberately, for
 *   determinism, in the same spirit as every other fake here. A hermetic e2e that sends an invite and polls
 *   the fake mailbox must find the mail without racing a post-response microtask; running inline keeps
 *   that ordering exactly as it was before this seam existed. It ALSO captures a `deferred_work` event
 *   first, so the deferred work is VISIBLE in the Simulator Events tab (proof the seam fired at all),
 *   and captures `deferred_work_failed` on error — again without ever throwing into the caller.
 *
 * Errors are always swallowed after being recorded: a failing side effect must never crash the
 * response (real) or the calling handler (fake).
 */
export async function deferAfterResponse(label: string, work: () => Promise<void>): Promise<void> {
    if (isSimulated) {
        // Visible-in-Simulator marker first, then run inline so the world is deterministic.
        await analytics.capture('deferred_work', { label })
        try {
            await work()
        } catch (error) {
            await captureFailure(label, error)
        }
        return
    }
    // Real mode: schedule after the response is flushed. A rejection here can't propagate to a caller
    // that has already returned, so record it and move on.
    after(async () => {
        try {
            await work()
        } catch (error) {
            await captureFailure(label, error)
        }
    })
}

async function captureFailure(label: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    // Best-effort telemetry — if capture itself fails there is nothing left to do but not crash.
    await analytics.capture('deferred_work_failed', { label, message }).catch(() => {})
}
