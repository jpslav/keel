/**
 * The APP's demo presets (keel/core/presets.ts) — the seam side of the Snapshots tab's "Start from a
 * preset" list (ADR-0012). EMPTY REGISTRATION: no presets, so the tab shows no presets section, and a
 * tour can still start from `'reset'`, the one world start every host has. Add one file per preset and
 * list it here (see `apps/showcase/src/app-config/presets.ts`).
 */

import type { DemoPreset } from 'keel/core/presets'

export const presets: DemoPreset[] = []
