---
description: Add a scripted Simulator walkthrough (tour) registered through the app-config seam
---

Write a Simulator tour for: $ARGUMENTS

A tour is a scripted walkthrough: a ghost cursor drives the REAL screens while a bar narrates, so the
single-file demo (`apps/showcase/dist-demo/index.html`) can be watched instead of read about. The
_engine_ is framework (`packages/keel/src/demo-static/tour/` — driver, engine hook, overlay; the tab is
`packages/keel/src/components/simulator/tours-app.tsx`); each tour is app content.

1. **Register** in `apps/showcase/src/app-config/tours.ts`: add a `TourDefinition`
   (`keel/demo-static/tour/contracts`) with `id`, `titleKey`, `summaryKey`, usually `snapshot: 'reset'`
   or the id of a demo preset (`presets` in `apps/showcase/src/app-config/presets.ts`) when the story
   should open mid-shift — both work on every host; a saved snapshot's name works only on a server and
   fails the `file://` walkthrough gate. Then its steps. `apps/starter` registers `[]` — with no tours the panel renders no Tours tab at all,
   so leave that off-switch intact.
2. **Narration** goes in the APP catalog (`apps/showcase/messages/{en,es}.json`, `tours` namespace),
   referenced by FULLY-QUALIFIED key (`tours.myTourStep1`). Both locales, key-identical (unit-test
   enforced). `<b>` works (next-intl rich text): bold the one term per step that matters. Typed content
   (an email subject the tour types) is simulated DATA, not UI copy — it stays in one language, like
   `packages/seed`.
3. **Pacing is the craft**, and these rules are what make a tour watchable rather than a screencast:
    - **Every submission goes in `advance`**, never in `script`: the world changes when the viewer
      presses Next. Form-filling and typing go in `script`, and the narration says "read it, then press
      Next to send it".
    - **One idea per step**, 1 to 3 sentences, 8 to 20 steps. An aftermath (the ticket appearing, the
      delivery landing) gets its OWN step.
    - **Navigate by clicking real nav**, so a viewer learns how they would get there themselves.
    - **`spotlight` at most one target per step.** It lights after the step's script finishes, so it can
      point at something the script had to go and reveal.
    - End with "everything you just watched is yours to click now".
4. **Drive targets**: reuse the `data-testid` already on the element — those are role-named and stable.
   Add `data-tour="…"` ONLY where nothing stable exists, naming the ROLE, not the styling
   (`data-tour="analyze-bundle"` exists because that button's testid carries a row id that differs
   between the server and the static twin). Simulator's own controls are driven with `['panel', tab]`,
   which expands the panel if collapsed and is idempotent.
5. **Assert as you go**: `['expect', sel]` and `['expectText', sel, text]` are what turn the tour into a
   test. Put one after every beat that produced something (the ticket, the log entry, the delivery).
6. **Reload safety** (server host only): a snapshot restore, a feature-flag flip and a person switch all
   reload the page there. The engine resumes from a sessionStorage marker written at the `advance`
   boundary, so anything that reloads belongs in `advance`, and anything in a `script` must be safe to
   re-run.
7. **The gate**: `apps/showcase/tests/demo-static/tours.spec.ts` runs EVERY registered tour to its last
   step from `file://` and fails if the end-of-run report is not `data-misses="0"`. It needs no editing
   for a new tour — it iterates the registry. Run it with
   `pnpm --filter showcase build:demo-static && pnpm --filter showcase e2e:demo-static`.
8. **Watch it yourself** at presentation speed (Simulator → Tours → Start, Fast off) before calling it
   done. A tour that passes CI can still be unreadable; the fast run proves the selectors, your eyes
   prove the story. Then check the demo size budget (`pnpm check:demo-size`) and finish with
   `pnpm verify`.
