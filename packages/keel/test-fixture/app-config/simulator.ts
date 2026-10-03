/**
 * The APP's Simulator registrations (the seam side of the panel's tab strip + the Snapshots flag list,
 * ADR-0012). EMPTY REGISTRATION for tabs and feature flags: the fixture renders no panel. It DOES
 * register one demo preset, because the presets' server replay is framework code with a test of its own
 * (keel/server-lib/demo-presets.test.ts), and that test must replay keel's vocabulary, never an app's. `flags` is still composed into KNOWN_FLAGS (keel/adapters/fake/analytics.ts),
 * where an empty list adds nothing.
 */

import type { DemoPreset } from 'keel/core/presets'

/** One app-registered Snapshots feature flag. `labelKey` resolves in the `simulator` i18n namespace. */
interface AppSimulatorFlag {
    id: string
    labelKey: string
}

export const flags: AppSimulatorFlag[] = []

/**
 * One preset exercising every operation kind: an invite (from `depot`'s admin), an inbound email that
 * the fixture's `support` handler turns into a docket, and a framework flag — then the viewpoint.
 */
export const presets: DemoPreset[] = [
    {
        id: 'busy-harbor',
        titleKey: 'fixture.presetBusyTitle',
        summaryKey: 'fixture.presetBusySummary',
        viewpoint: 'fixture-hand',
        operations: [
            { op: 'invite', by: 'fixture-lead', org: 'depot', email: 'new.hand@example.test', role: 'member' },
            {
                op: 'inbound',
                org: 'depot',
                handler: 'support',
                from: 'bo.deckhand@example.test',
                subject: 'Crane four is stuck',
                body: 'The boom will not lower past half height.',
            },
            { op: 'flag', flag: 'jobs-held', enabled: true },
        ],
    },
]
