/**
 * The APP's Simulator registrations (the seam side of the panel's tab strip + the Snapshots flag list,
 * ADR-0012). EMPTY REGISTRATION on both counts: the fixture renders no panel, so it registers no tabs
 * and no feature flags. `flags` is still composed into KNOWN_FLAGS (keel/adapters/fake/analytics.ts),
 * where an empty list adds nothing.
 */

/** One app-registered Snapshots feature flag. `labelKey` resolves in the `simulator` i18n namespace. */
interface AppSimulatorFlag {
    id: string
    labelKey: string
}

export const flags: AppSimulatorFlag[] = []
