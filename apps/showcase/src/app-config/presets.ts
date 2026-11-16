/**
 * DEMO PRESETS (keel/core/presets.ts) — the APP's registration, on the ADR-0012 seam: named starting
 * points every host can restore. The Snapshots tab lists them, and a tour may name one as its `snapshot`.
 * A preset is the seed plus a script of world operations, replayed by the server through its fake
 * adapters and by the `file://` twin through its in-memory world, so "restore mid-demo" works wherever
 * the demo runs, which a saved `.data/` snapshot never can.
 *
 * Every operation is one the product would allow (keel's seam-conformance suite holds them to it):
 * Dana manages the Frontline Desk and the Platform Team, so she does the inviting; tickets arrive the
 * way the desk's real front door receives them, as email from a member.
 *
 * ONE FILE PER PRESET, in `./presets/`, listed here — the registry is expected to grow, and a preset is
 * its own subject. A preset may `extends` another (single inheritance): `mid-demo` builds on `fresh`,
 * `multi-tenant` on `mid-demo`, so a variant states only what differs. List a base anywhere in the array;
 * order here is the order the Snapshots tab shows. PURE TypeScript — shared by the server glue and the
 * static-demo twin, which is why nothing here may reach a server half.
 *
 * The app's own OPERATION KINDS register here too, beside keel's `invite`/`inbound`/`flag`/`actor.hold`: one directory
 * per kind under `./presets/operations/`, whose `definition.ts` is listed in `appPresetOperations` and
 * typed into `AppPresetOperation`. Its server half registers on the server-only `./preset-operations.ts`
 * and its static half in the static composition root (src/demo-static/app.tsx) — `/new-preset-operation`
 * scaffolds all three.
 */

import type { DemoPreset, PresetOperationDefinition } from 'keel/core/presets'
import { fresh } from './presets/fresh'
import { midDemo } from './presets/mid-demo'
import { multiTenant } from './presets/multi-tenant'
import { ticketAssign, type TicketAssignOperation } from './presets/operations/ticket-assign/definition'

/** The app's operation kinds, as preset authors write them — composed into keel's PresetOperation. */
export type AppPresetOperation = TicketAssignOperation

/** The app's operation DEFINITIONS — composed over keel's by kind (`composePresetOperations`). */
export const appPresetOperations: PresetOperationDefinition[] = [ticketAssign]

export const presets: DemoPreset[] = [fresh, midDemo, multiTenant]
