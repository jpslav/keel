/**
 * The APP's Simulator registrations (the seam side of the panel's tab strip + the Snapshots flag list,
 * ADR-0012). EMPTY REGISTRATION: the fixture renders no panel. `flags` is still composed into
 * KNOWN_FLAGS (keel/adapters/fake/analytics.ts), where an empty list adds nothing. Its demo presets are
 * a seam module of their own (`./presets.ts`).
 */

/** One app-registered Snapshots feature flag. `labelKey` resolves in the `simulator` i18n namespace. */
interface AppSimulatorFlag {
    id: string
    labelKey: string
}

export const flags: AppSimulatorFlag[] = []
