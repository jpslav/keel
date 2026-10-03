/**
 * The CONTRACT an app's tours are written against (ADR-0012 seam, `@app-config/tours`).
 *
 * A **snapshot** snapshots world STATE; a **tour** is its temporal sibling — a scripted walkthrough that
 * drives the running app for a watcher, with narration. A tour declares the snapshot it starts from, the
 * framework restores it, and then the ghost cursor drives real controls: real clicks, real typing, real
 * navigation. Nothing here is app vocabulary: a tour is selectors, i18n keys and timing, so keel can
 * host tours for any app without learning what a ticket is.
 *
 * Kept as its own module for the same reason ../contracts.ts is: it is the surface a second app codes
 * against, and it should read end to end without scrolling through an implementation.
 */

/**
 * One action in a tour's script. A tuple rather than an object because a script is read as a
 * storyboard — twenty lines you can scan — and the driver (./driver.ts) is the only thing that
 * executes them.
 *
 * SELECTOR CONVENTION: any CSS selector resolves, but prefer a role-named hook that survives a
 * restyle. Existing `data-testid` attributes ARE such hooks and are reused rather than duplicated;
 * `data-tour="..."` is added only where a screen has no stable hook (see docs/recipes or /new-tour).
 */
export type TourAction =
    /** Glide the ghost cursor to an element (scrolls it into view first). */
    | ['move', string]
    /** Move, ripple, pause, then fire a REAL click — React handles it exactly like a user's. */
    | ['click', string]
    /** Move, focus, hide the cursor, and type character by character (native setter + input event, so
     *  controlled components update). */
    | ['type', string, string]
    /** Set a NATIVE `<select>` and fire `change`. Mantine's combobox is not a native select — open and
     *  pick it with two `click`s instead, which is also the better thing to watch. */
    | ['select', string, string]
    /**
     * Drive the Simulator panel to a tab through its OWN controls: expand it if collapsed, then click
     * the tab. Idempotent, so a tour never has to know how the viewer left the panel. With no argument
     * it collapses the panel instead (ending on the product).
     */
    | ['panel', string?]
    /** Assert an element is on screen, waiting for it. A miss fails the tour (and CI). */
    | ['expect', string]
    /** Assert an element CONTAINS text, waiting for it. The needle is tour-local simulated content
     *  (a subject the tour itself typed), never UI copy — UI copy is translated, this is not. */
    | ['expectText', string, string]
    /** Smooth-scroll an element into view without touching it. */
    | ['scrollTo', string]
    /** Scroll the page back to the top. */
    | ['scrollTop']
    /** Wait, in milliseconds (scaled by the speed control). */
    | ['pause', number]

/** One beat of the story: what the viewer reads, and what the cursor does while they read it. */
export interface TourStep {
    /**
     * Fully-qualified key into the APP's catalog (`namespace.key`), resolved with the root translator —
     * the same shape an app-registered Simulator flag's `labelKey` uses, and for the same reason: a tour
     * is app vocabulary, so its narration ships in the app's messages, not keel's. `<b>` is supported
     * (next-intl rich text) for the one term that matters.
     */
    textKey: string
    /** Runs on ENTRY to the step, while the viewer reads the narration. */
    script?: TourAction[]
    /**
     * Runs when the viewer presses Next, BEFORE the story moves on. **Every submit belongs here** —
     * that is what keeps a tour watchable rather than a video: nothing mutates the world until the
     * person watching decides it is time.
     */
    advance?: TourAction[]
    /** A selector to vignette: the page dims and the target haloes. One target per step, at most. */
    spotlight?: string
}

/** A registered tour — what the Simulator Tours tab lists, and what Start runs. */
export interface TourDefinition {
    /** Stable id: the tab's testids and the resume marker are built from it. */
    id: string
    /** Fully-qualified keys into the APP's catalog (see TourStep.textKey). */
    titleKey: string
    summaryKey: string
    /**
     * The world state this tour assumes, restored before step 1. `'reset'` (the seeded world) and the id
     * of any registered demo preset (`@app-config/presets`, keel/core/presets.ts) work on
     * EVERY host; a saved snapshot name works only on a server host, and the `file://` walkthrough gate
     * records it as a miss. Omit for a tour that runs from wherever the viewer happens to be.
     */
    snapshot?: string
    steps: TourStep[]
}

/** Something a script asked for and did not get. Surfaced in the bar while a tour runs, counted in its
 *  end-of-run report, and asserted to be zero by the CI walkthrough — this is what stops tours rotting. */
export interface TourMiss {
    /** The action that missed, e.g. `click`. */
    action: string
    /** The selector (or, for `expectText`, `selector — needle`) that never resolved. */
    target: string
}
