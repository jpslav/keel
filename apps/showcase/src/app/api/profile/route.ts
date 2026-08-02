import { auth } from 'keel/adapters/index'
import { LOCALES, type Locale } from 'keel/core/locale'
import { withPortErrors } from '../respond'

export async function POST(request: Request): Promise<Response> {
    return withPortErrors(async () => {
        const body = (await request.json()) as { name?: string; locale?: string }
        const locale = body.locale && LOCALES.includes(body.locale as Locale) ? (body.locale as Locale) : undefined
        const user = await auth.updateProfile({ name: body.name, locale })
        return Response.json({ user })
    })
}
