/**
 * The APP's demo presets (keel/core/presets.ts) — the seam side of the Snapshots tab's "Start from a
 * preset" list (ADR-0012). EMPTY REGISTRATION: no presets, so the tab shows no presets section, and a
 * tour can still start from `'reset'`, the one world start every host has. To add one, put it in its own
 * file under `./presets/` and list it here — `/new-preset` walks through it.
 *
 * No operation kinds of its own either: a preset here can use keel's (`invite`, `inbound`, `flag`;
 * `actor.hold` needs an actor, and this app registers none). Add one with `/new-preset-operation`, which
 * registers its definition below and its server half in `./preset-operations.ts`.
 */

import type { DemoPreset, PresetOperationDefinition } from 'keel/core/presets'

export type AppPresetOperation = never

export const appPresetOperations: PresetOperationDefinition[] = []

export const presets: DemoPreset[] = []
