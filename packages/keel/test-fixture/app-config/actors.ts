/**
 * The Simulator "actors" registry (the app side — ADR-0012).
 *
 * ONE ACTOR, and it must stay non-empty: keel's demo-preset `actor.hold` kind names an actor id that the
 * registry must contain, and keel's replay test (keel/server-lib/demo-presets.test.ts) cannot prove a hold
 * is written, nor the seam-conformance suite that a known actor passes, against an empty list. The fixture still renders no panel,
 * so nothing hosts this actor — the registration is its id, and nothing else. (The fixture also
 * registers a service-managed org in ./jobs.ts; that list is deliberately independent of whether an
 * actor drives it.)
 *
 * The framework imports `ActorId` type-only; the `actors` list is a value read by the seam-conformance
 * suite alone, which derives `PresetWorld.actors` from it rather than hand-listing ids.
 */
export const actors = [{ id: 'fixture-tug' }] as const

export type ActorId = (typeof actors)[number]['id']
