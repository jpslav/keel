import type { DigestBodySource } from 'keel/jobs/digest-email'

/**
 * The APP's digest source (the seam side of keel/jobs/digest-email.ts, ADR-0012).
 *
 * EMPTY REGISTRATION: this app has nothing to digest, so the framework's scheduled digest still
 * composes and sends — with its empty-state copy. Removing the capability would mean deleting a
 * framework job kind; leaving it registered-and-empty costs one line.
 */
export const digestBodies: DigestBodySource = async () => []
