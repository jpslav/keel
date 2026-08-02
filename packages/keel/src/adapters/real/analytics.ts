import { PostHog } from 'posthog-node'
import type { AnalyticsPort } from '../../ports/analytics'

/**
 * AUTHORED — CUTOVER (`analytics`): typechecked, never run against a real project. Enabled in
 * staging/prod only (ADR-0010); everywhere else the no-op fake is wired even in real mode.
 */
export function createRealAnalytics(apiKey: string, host: string): AnalyticsPort {
    const client = new PostHog(apiKey, { host, flushAt: 1, flushInterval: 5_000 })

    return {
        async capture(event, properties, distinctId = 'server') {
            client.capture({ distinctId, event, properties })
        },

        async isFlagEnabled(flag, defaultValue = false) {
            // A flag read is never load-bearing: a PostHog outage degrades to the default rather
            // than throwing into whatever screen asked (the protected layout reads flags on every
            // authenticated render).
            try {
                const enabled = await client.isFeatureEnabled(flag, 'server')
                return enabled ?? defaultValue
            } catch {
                return defaultValue
            }
        },
    }
}
