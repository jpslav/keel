/**
 * The APP's demo presets (keel/core/presets.ts) — the seam side of the Snapshots tab's "Start from a
 * preset" list (ADR-0012). EMPTY REGISTRATION: no presets, so the tab shows no presets section, and a
 * tour can still start from `'reset'`, the one world start every host has. Add one file per preset and
 * list it here (see `apps/showcase/src/app-config/presets.ts`).
 *
 * No operation kinds of its own either: a preset here can use keel's (`invite`, `inbound`, `flag`). Add
 * one with `/new-preset-operation`, which registers its definition below and its server half in
 * `./preset-operations.ts`.
 */

import type { DemoPreset, PresetOperationDefinition } from 'keel/core/presets'

export type AppPresetOperation = never

export const appPresetOperations: PresetOperationDefinition[] = []

export const presets: DemoPreset[] = []
