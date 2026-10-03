import { isSimulated } from 'keel/adapters/index'
import { LOCALES } from 'keel/core/locale'
import { applyDemoPreset } from 'keel/server-lib/demo-presets'
import { withPortErrors } from '../../respond'

/**
 * Loads a registered demo preset (keel/core/presets.ts): resets the world, replays the preset's
 * operations, and signs THIS browser in as the preset's viewpoint. Simulator-mode gate, first line (404
 * in real), no role check — like reset, it must work signed out. Body: `{ name, locale }`; answers the
 * path the glue reloads to: the dashboard when the preset signs someone in, the welcome page otherwise.
 */
export async function POST(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const { name, locale } = (await request.json()) as { name?: unknown; locale?: unknown }
        if (typeof name !== 'string') return Response.json({ error: 'name is required' }, { status: 400 })
        if (typeof locale !== 'string' || !(LOCALES as readonly string[]).includes(locale)) {
            return Response.json({ error: 'unknown locale' }, { status: 400 })
        }

        const { signedIn } = await applyDemoPreset(name, { baseUrl: request.url })
        return Response.json({ redirectTo: signedIn ? `/${locale}/dashboard` : `/${locale}` })
    })
}
