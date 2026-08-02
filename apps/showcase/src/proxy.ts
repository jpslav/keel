import createMiddleware from 'next-intl/middleware'
import { routing } from 'keel/i18n/routing'

// Next 16 renamed middleware.ts -> proxy.ts; next-intl's locale negotiation runs here.
export default createMiddleware(routing)

export const config = {
    matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
}
