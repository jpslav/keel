/**
 * The Simulator "actors" registry (the app side — ADR-0012). Actors are in-page automations that drive
 * the same service/webhook surfaces a real counterparty would.
 *
 * EMPTY REGISTRATION. This app simulates no counterparties, so the id union is `never` — which is
 * exactly right: an `ActorSlot[]` for this app can only ever be empty, and the compiler says so. The
 * framework imports `ActorId` type-only, so registering nothing costs nothing. The `actors` LIST is a
 * value, read by one framework test only (the seam-conformance suite derives the actor ids a demo
 * preset's `actor.hold` may name from it); an app with actors lists each `{ id, … }` there.
 */
export type ActorId = never

export const actors: readonly { id: string }[] = []
