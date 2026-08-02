/**
 * The Simulator "actors" registry (the app side — ADR-0012). Actors are in-page automations that drive
 * the same service/webhook surfaces a real counterparty would.
 *
 * EMPTY REGISTRATION. This app simulates no counterparties, so the id union is `never` — which is
 * exactly right: an `ActorSlot[]` for this app can only ever be empty, and the compiler says so. The
 * framework imports this module type-only, so registering nothing costs nothing.
 */
export type ActorId = never
