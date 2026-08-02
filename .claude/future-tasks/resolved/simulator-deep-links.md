# Simulator deep links / outside-in control

**Priority:** P2 · **Status:** RESOLVED 2026-07-31 (by Tours — see below)

## What was asked for

`#simulator=mail:all` (or a tiny event bus the glue subscribes to) so app-side hints, docs, and tests can
open the panel on a specific tab/scope.

This was the missing seam for:

- making the org screen's "invitation sent" confirmation clickable
- demo runbooks that link straight to a tab
- steadier e2e (no pill/tab click choreography)
- **tours** — a scripted walkthrough that needs to drive the panel to a given tab is exactly this problem

## How Tours settled it: by not needing it

The Tours engine (`packages/keel/src/demo-static/tour/`) drives the panel through the panel's OWN
controls, as a `['panel', tabId]` script action: if `[data-testid="simulator-panel"]` is absent it clicks
the pill, waits for the column, then clicks `[data-testid="simulator-tab-<id>"]`. Idempotent, so a tour
never has to know how the viewer left the panel, and it works identically in the server host and the
`file://` twin because it depends on nothing but the DOM that is already there.

That turned out to be **better** than a deep-link seam for this purpose, not merely cheaper:

- A walkthrough exists to show a viewer how they would do it themselves. A hash that teleports the panel
  open teaches nobody anything; a cursor visibly opening the panel and picking a tab does.
- It adds no state to the panel and no parsing to either host, so there is no second way to be on a tab
  that the persisted `app-simulator-tab` key could disagree with.
- The e2e motivation was already covered — specs click the pill and the tab today, and the
  `data-hydrated` stamp (tests/e2e/support/simulator.ts) is what made that steady, not a deep link.

## What is left over

One motivation is genuinely unaddressed: an APP-side affordance that opens the panel (the org screen's
"invitation sent" confirmation linking to Mail). That is a much smaller item than this file described —
one callback from the host into the panel, not a URL grammar — and it does not need a design document.
Open a fresh task if a screen ever wants it. The runbook-links-to-a-tab idea is moot for the same reason
tours are: the runbook now says "press Start".
