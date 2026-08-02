/**
 * Analytics + feature flags port (ADR-0010). Real adapter (PostHog) is enabled in staging/prod
 * only; everywhere else the no-op fake keeps the app fully offline.
 */
export interface AnalyticsPort {
    capture(event: string, properties?: Record<string, unknown>, distinctId?: string): Promise<void>
    isFlagEnabled(flag: string, defaultValue?: boolean): Promise<boolean>
}
