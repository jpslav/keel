import { isSimulated } from 'keel/adapters/index'
import { readFlags } from 'keel/adapters/fake/analytics'
import { readActorHolds } from 'keel/adapters/fake/simulator'
import { isActorId } from '@app-config/actors'
import { actorsHeldFlag } from '@app-config/simulator'
import { withPortErrors } from '../../../respond'

/**
 * Whether the world holds ONE actor — the question each actor frame asks before every autonomous tick
 * (`?actor=<id>`). The answer is the world-wide `actors-held` flag OR that actor's own hold (a demo
 * preset's `actor.hold`, .data/simulator/actor-holds.json), so a frame makes one request and gets exactly
 * what it needs, rather than fetching every flag and every hold and picking its own out. The static twin
 * answers the same question in memory (src/demo-static/app.tsx). Mode-only, no auth, like the rest of
 * /api/simulator/*: the actor frame runs signed-out. An actor id the registry lacks is a 400.
 */
export async function GET(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const actor = new URL(request.url).searchParams.get('actor')
        if (actor === null || !isActorId(actor)) return Response.json({ error: 'unknown actor' }, { status: 400 })
        const held = (readFlags()[actorsHeldFlag] ?? false) || (readActorHolds()[actor] ?? false)
        return Response.json({ held })
    })
}
