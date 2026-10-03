/**
 * The APP's Simulator registrations (the seam side of the panel's tab strip + the Snapshots flag list,
 * ADR-0012). The framework panel owns its subsystem tabs and its own feature flags.
 *
 * EMPTY REGISTRATION on every count: no extra tabs, no app feature flags, no demo presets. The panel still ships every
 * framework tab; `flags` is composed into KNOWN_FLAGS (keel/adapters/fake/analytics.ts) and an empty
 * list simply adds nothing. `tabs` is not exported at all — nothing would read it, and an export with
 * no consumer is dead code the gate would (rightly) flag.
 */

import type { DemoPreset } from 'keel/core/presets'

/** One app-registered Snapshots feature flag. `labelKey` resolves in the `simulator` i18n namespace. */
interface AppSimulatorFlag {
    id: string
    labelKey: string
}

export const flags: AppSimulatorFlag[] = []

/** Demo presets (keel/core/presets.ts) — none. The Snapshots tab then shows no presets section, and a
 *  tour can still start from `'reset'`, the one world start every host has. */
export const presets: DemoPreset[] = []
