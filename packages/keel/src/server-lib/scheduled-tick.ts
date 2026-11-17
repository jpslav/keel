import { worldNow } from '../adapters/fake/clock'
import { db, isSimulated, jobs } from '../adapters/index'
import { runDueSchedules } from '../db/schedules'
import { runDueDeliveries } from '../db/webhooks'
import { dispatchWebhook } from './webhook-dispatch'

/**
 * The scheduled-work tick: drains every due `job_schedules` row (spawning its job) and every due outbound
 * webhook delivery, and says how many of each. It is the whole body of an app's `/api/webhooks/cron` route, so
 * that route is a three-line wrapper (`withWebhookSecret(async () => Response.json({ ok: true, ...(await
 * runScheduledTick()) }))`) and an app that takes keel as a package gets the same behaviour as a fork.
 *
 * Real world: an EventBridge rule POSTs that route on a fixed cadence with `Authorization: Bearer $WEBHOOK_SECRET`
 * (cutover row `scheduled-tick`). Nothing else ticks the scheduler: in `pnpm dev` an app with no Simulator has no
 * tick source until something POSTs the route (docs/adopting.md, "The scheduled tick").
 *
 * "Now" is the trigger source's clock: real time in a real build; in a simulated world the Simulator's world clock
 * (real time plus the offset a demo advanced), so a tick honours a clock the demo moved. `worldNow()` is called
 * only behind `isSimulated`, so that offset is structurally unreachable in a real build.
 *
 * The same tick drains due webhook deliveries: a scheduled digest that spawns a job whose status change
 * enqueues a delivery, and any retry whose backoff has elapsed, both fire from one tick.
 */
export interface ScheduledTickResult {
    /** Jobs spawned from due schedules. */
    spawned: number
    /** Due schedules whose spawn failed (retried on the next tick). */
    failed: number
    /** What the delivery drain did (`runDueDeliveries`'s own result). */
    deliveries: Awaited<ReturnType<typeof runDueDeliveries>>
}

export async function runScheduledTick(): Promise<ScheduledTickResult> {
    const now = isSimulated ? worldNow() : new Date()
    const { spawned, failed } = await runDueSchedules(db, jobs, now)
    const deliveries = await runDueDeliveries(db, now, dispatchWebhook)
    return { spawned, failed, deliveries }
}
