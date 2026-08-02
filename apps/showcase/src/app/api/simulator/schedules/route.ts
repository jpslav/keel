import { db, isSimulated } from 'keel/adapters/index'
import { readClockOffsetMs, worldNow } from 'keel/adapters/fake/clock'
import { listSchedulesForWorld } from 'keel/db/schedules'
import { withPortErrors } from '../../respond'

/**
 * The Simulator Jobs tab's schedule + world-clock read (simulated-mode-only; 404 in real). Returns every
 * schedule across tenants joined to slugs, plus the current world-clock offset and the world's "now"
 * so the panel can show how far ahead of real time the demo has advanced.
 */
export async function GET(): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const schedules = await listSchedulesForWorld(db)
        return Response.json({ schedules, clockOffsetMs: readClockOffsetMs(), worldNow: worldNow().toISOString() })
    })
}
