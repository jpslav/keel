import type { ServerPresetOperationHandler } from 'keel/server-lib/preset-operations'

/**
 * The SERVER halves of the app's demo-preset operation kinds (keel/server-lib/demo-presets.ts composes
 * them over keel's own) — a server-only seam module (ADR-0012), separate from `./presets.ts` because the
 * static demo bundles that one and must never bundle a server half. EMPTY REGISTRATION: this app adds no
 * kinds, so keel's `invite`, `inbound` and `flag` are the whole registry.
 */
export const appPresetOperationHandlers: Record<string, ServerPresetOperationHandler> = {}
