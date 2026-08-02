import type { DigestBodySource } from 'keel/jobs/digest-email'

/**
 * The APP's digest source (the seam side of keel/jobs/digest-email.ts, ADR-0012).
 *
 * EMPTY REGISTRATION: the framework's scheduled digest still composes and sends — with its empty-state
 * copy — which is all `db/schedules.test.ts` needs from it.
 */
export const digestBodies: DigestBodySource = async () => []
