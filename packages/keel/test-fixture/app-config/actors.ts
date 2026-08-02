/**
 * The Simulator "actors" registry (the app side — ADR-0012).
 *
 * EMPTY REGISTRATION: the fixture simulates no counterparties, so the id union is `never`. The
 * framework imports this module type-only, so registering nothing costs nothing. (The fixture DOES
 * register a service-managed org in ./jobs.ts — that list is what the build-pool test needs, and it is
 * deliberately independent of whether an actor drives it.)
 */
export type ActorId = never
