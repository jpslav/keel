# Record a preset, or a tour, from clicks

**Priority:** P3 · **Status:** open — nothing blocks it, but nothing needs it until presets and tours are
written often enough that typing the script is the bottleneck.
**Found by:** the demo-presets design discussion, 2026-10-03.

## The problem

Authoring a preset today is writing a script of operation objects (`.claude/commands/new-preset.md`);
authoring a tour is writing selectors and actions (`.claude/commands/new-tour.md`). Both are mechanical
enough that "do it once by hand, then save it" is the obvious workflow. They are two different recorders
with very different costs, and conflating them is how this ends up looking bigger than it is.

## Presets: put an observer on the dispatchers

**What is known.** Both hosts already funnel every replay step through one function — `performPresetOperation`
in `packages/keel/src/server-lib/demo-presets.ts` (the server) and its twin inside
`packages/keel/src/demo-static/world.ts` (the static world). A recording mode is an observer on those two
dispatchers: each operation performed while recording is appended as `{ op, as?, ...args }`, which is already
the shape `DemoPreset.operations` holds (`packages/keel/src/core/presets.ts`). The output is a draft for
`apps/<app>/src/app-config/presets/<id>.ts`, and the same gate (`presetProblems`, the server replay and the
static-shell loop) judges it exactly as it judges a hand-written one: a recording is a draft, never an
exemption.

**The hard constraints, in order of how much they bite:**

1. **Only an action that IS an operation is recordable.** A preset step is something the product itself could
   have done through a named function, and a click on a product screen is not one unless its handler calls
   such a function. The Simulator panel's own actions are the cheap half: compose-inbound is `inbound`, a
   flag toggle is `flag`, and routing them through the dispatcher is a small change. Product-screen
   mutations are recordable only once they go through a named core function that a kind's half also calls,
   and that call site must then report to the recorder, because a route calling the function directly never
   touches the dispatcher. `sendOrgInvite` (`packages/keel/src/server-lib/invite.ts`) already is such a
   function, so the org screen's invite is the nearest candidate. `applyTicketChanges`
   (`apps/showcase/src/domain/ticket-changes.ts`) is the worked example of extracting one — the PATCH ticket
   route and the `ticket.assign` half both call it.
2. **Recorded host ids must become named results.** A recording sees a uuid (or a reference like `NW-1042`);
   a preset may only hold names, because ids differ per host and per replay. When a later recorded action
   targets a row an earlier recorded operation created, the recorder emits `as` on the earlier step and the
   name in the later one's argument. It needs each kind's `consumes` read in reverse (which argument is a
   name), and a half has to report `{ ref }` for what it created (`inbound` does; `invite` does not yet).
3. **Acting on a seed row has no name to bind.** A step may consume only a name an EARLIER step bound, so
   assigning a seed ticket cannot be expressed. Open question: the recorder refuses and says so, or the
   registry grows a way to name seed rows. Decide with a real preset that needs it, not before.

**Open question: how far to apply the `applyTicketChanges` shape.** Extracting a route's post-authorize body
into a named function, with a static twin, is what makes a mutation recordable — and it has a payoff of its
own, since a script step and a click can no longer drift apart. It costs a refactor per mutation
(`/new-preset-operation` step 5 is the recipe). The default stays **per kind, when a preset needs it**.
Sweeping a whole screen's mutations in advance, for the recorder's sake alone, is the version to resist.

**Sketch.** A Record / Stop control in the Snapshots tab, on both hosts, that ends in "copy as preset
source" (the static host cannot write a file, and the server host should not either). The viewpoint at Stop
becomes the draft's `viewpoint`, which matches its meaning: who the person loading it sits down as.

## Tours: a different thing

A tour records the VIEWER's path, not the world's: DOM interactions mapped to `TourAction` tuples
(`packages/keel/src/demo-static/tour/contracts.ts`), a click or a typed value per step. The cursor script is
the easy half. The hard half is **stable selectors**: a tour holds to role-named hooks (`data-testid`, and
`data-tour` only where nothing stable exists — see the comment at the top of
`apps/showcase/src/app-config/tours.ts`), and an inferred CSS path or nth-child selector would rot at the
first restyle. Some testids also carry a row id that differs between the server and the static twin, which
a tour cannot use.

**Do not write a recorder from scratch.** The Chrome DevTools Recorder exports a JSON flow (typed steps —
navigate, click, change, and so on — each with ranked alternative selectors), and `@puppeteer/replay` parses
and stringifies that format. Evaluate it as the INPUT format: record in Chrome, then a converter script maps
each step to a `TourAction`, taking the `data-testid` selector from the step's list and flagging any step
that has none. Verify that the Recorder can be told to prefer `data-testid` before committing to this.
The converter also owns the pacing rules in `.claude/commands/new-tour.md`: a submit goes in `advance`, never
`script`.

**Narration stays hand-written.** Narration is the craft of a tour — one idea per step, which term gets
`<b>`, what the spotlight points at, the closing step — and no recording contains it. The converter emits
`TourStep`s with placeholder `textKey`s and the author writes the catalog entries. Assertions (`expect`,
`expectText`) are likewise authored, though the converter could propose one after each submit.

The two recorders compose through `TourDefinition.snapshot`: record the world once as a preset, then
record the viewer's walk over it.

## Trigger

Presets or tours being authored often enough that the typing is the cost. Until then `/new-preset` and
`/new-tour` are cheap enough. The tour converter is a script with no framework change; the preset recorder
needs the Simulator-panel routing first, and neither depends on the other.
