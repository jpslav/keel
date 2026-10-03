/**
 * The fixture's demo presets (keel/core/presets.ts), the seam side of the Snapshots tab's presets list
 * (ADR-0012). It DOES register presets, because their replay is framework code with tests of its own
 * (keel/server-lib/demo-presets.test.ts), and those must replay keel's vocabulary, never an app's.
 *
 * `busy-harbor` exercises every operation kind: an invite (from `depot`'s admin), an inbound email that
 * the fixture's `support` handler turns into a docket — named `crane` with `as` — the fixture's OWN kind,
 * `docket.flag`, acting on that named docket, and a framework flag — then the viewpoint.
 * `busy-harbor-lead` is the same world signed in as someone else: it exists to prove `extends` (the
 * base's script replayed first, the viewpoint overridden) in keel's own vocabulary.
 *
 * It also registers one operation kind of its own (`appPresetOperations`, typed by `AppPresetOperation`),
 * so keel's tests exercise an app kind beside the framework's. Its server half is on the server-only
 * module, `./preset-operations.ts`, which also REPLACES keel's `flag` half. The fixture has no static demo,
 * so it supplies no static halves.
 */

import type { DemoPreset, PresetOperationDefinition } from 'keel/core/presets'
import { docketFlag, type DocketFlagOperation } from './presets/operations/docket-flag/definition'

/** The fixture's operation kinds, as preset authors write them — composed into keel's PresetOperation. */
export type AppPresetOperation = DocketFlagOperation

/** The fixture's operation DEFINITIONS (pure) — composed over keel's by `composePresetOperations`. */
export const appPresetOperations: PresetOperationDefinition[] = [docketFlag]

const busyHarbor: DemoPreset = {
    id: 'busy-harbor',
    titleKey: 'fixture.presetBusyTitle',
    summaryKey: 'fixture.presetBusySummary',
    viewpoint: 'fixture-hand',
    operations: [
        { op: 'invite', by: 'fixture-lead', org: 'depot', email: 'new.hand@example.test', role: 'member' },
        {
            op: 'inbound',
            as: 'crane',
            org: 'depot',
            handler: 'support',
            from: 'bo.deckhand@example.test',
            subject: 'Crane four is stuck',
            body: 'The boom will not lower past half height.',
        },
        { op: 'docket.flag', by: 'fixture-lead', org: 'depot', docket: 'crane' },
        { op: 'flag', flag: 'jobs-held', enabled: true },
        { op: 'actor.hold', actor: 'fixture-tug', held: true },
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
