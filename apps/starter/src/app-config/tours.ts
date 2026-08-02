import type { TourDefinition } from 'keel/demo-static/tour/contracts'

/**
 * The APP's registered TOURS — scripted walkthroughs the Simulator Tours tab lists and runs
 * (keel/demo-static/tour/contracts, ADR-0012).
 *
 * EMPTY REGISTRATION, and it is a real off-switch rather than an empty list: with no tours registered
 * the panel does not render the Tours tab at all and the engine never mounts a ghost cursor. It is not
 * free in BYTES — the shell imports the engine either way, which is ~11KB of this app's single-file
 * demo — because the alternative is making every app wire the engine itself, and the framework's whole
 * bargain here is that an app inherits the simulated world without assembling it. An adopter who wants
 * a walkthrough writes one here (`/new-tour`); apps/showcase's is the worked example.
 */
export const tours: TourDefinition[] = []
