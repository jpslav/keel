/**
 * The fixture's demo presets (keel/core/presets.ts), the seam side of the Snapshots tab's presets list
 * (ADR-0012). It DOES register presets, because their replay is framework code with tests of its own
 * (keel/server-lib/demo-presets.test.ts), and those must replay keel's vocabulary, never an app's.
 *
 * `busy-harbor` exercises every operation kind: an invite (from `depot`'s admin), an inbound email that
 * the fixture's `support` handler turns into a docket, and a framework flag — then the viewpoint.
 * `busy-harbor-lead` is the same world signed in as someone else: it exists to prove `extends` (the
 * base's script replayed first, the viewpoint overridden) in keel's own vocabulary.
 */

import type { DemoPreset } from 'keel/core/presets'

const busyHarbor: DemoPreset = {
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
}

const busyHarborLead: DemoPreset = {
    id: 'busy-harbor-lead',
    titleKey: 'fixture.presetBusyLeadTitle',
    summaryKey: 'fixture.presetBusyLeadSummary',
    extends: 'busy-harbor',
    viewpoint: 'fixture-lead',
}

export const presets: DemoPreset[] = [busyHarbor, busyHarborLead]
