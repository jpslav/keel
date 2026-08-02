import { loadAppMessages } from '@app-config/messages'
import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import { loadFrameworkMessages, mergeMessages } from './messages'
import { routing } from './routing'

/**
 * next-intl's request config — registered from next.config.ts, which points the plugin at this file's
 * path inside the package. The catalog is COMPOSED at load: the framework's namespaces merged with the
 * app's, which arrive through the ADR-0012 seam (`@app-config/messages`) — the framework never reaches
 * the host's `messages/*.json` directly.
 */
// The merged tree is a pure function of the locale and the underlying JSON is static per build, so
// merge once per locale per process instead of re-walking the whole catalog on every request.
const mergedByLocale = new Map<string, ReturnType<typeof mergeMessages>>()

async function messagesFor(locale: string): Promise<ReturnType<typeof mergeMessages>> {
    const cached = mergedByLocale.get(locale)
    if (cached) return cached
    const [framework, app] = await Promise.all([loadFrameworkMessages(locale), loadAppMessages(locale)])
    const merged = mergeMessages(framework, app)
    mergedByLocale.set(locale, merged)
    return merged
}

export default getRequestConfig(async ({ requestLocale }) => {
    const requested = await requestLocale
    const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale

    return {
        locale,
        messages: await messagesFor(locale),
    }
})
