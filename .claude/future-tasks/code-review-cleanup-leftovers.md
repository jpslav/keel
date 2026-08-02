# Cleanup leftovers from the 2026-07-31 full-codebase review

**Priority:** P3 · **Status:** open

## Where these came from

A full-codebase review (2026-07-31 — many independent search angles, then an adversarial pass over
every finding) confirmed 19. Fifteen were fixed on the spot; these four were verified
real but deliberately left — each is churn in a working, test-covered surface with no correctness
stake, so they wait for a session that is already touching the file. None blocks anything.

## 1. `simulator-glue.tsx` — tab → refreshers wired twice

`apps/showcase/src/app/[locale]/simulator-glue.tsx` maintains the mapping "which fetches does tab X
need" in two places: inline `if (expanded && activeTab === 'X')` branches inside the poll-interval
callback, and five near-identical immediate-on-open `useEffect` blocks below it. Adding a tab means
editing both (it has already been done five times: mail, messages, events, jobs/actors, hooks —
snapshots is on-open only, deliberately unpolled).

**Design:** one `fetchTab(tab)` `useCallback` switching over the tab id (mail → refreshMail +
refreshInbound, … , snapshots → refreshSnapshots + refreshEvents + refreshAgreements), consumed by BOTH
the interval callback (`if (expanded && activeTab !== 'snapshots') fetchTab(activeTab)`) and a single
on-open effect (`if (expanded) fetchTab(activeTab)`). Preserve the always-on badge `refresh()` and
the snapshots-never-polls rule. Pure refactor; the simulator e2e suite is the gate.

## 2. `escalations-card.tsx` — sent/received list scaffold duplicated

`apps/showcase/src/components/escalations-card.tsx` renders the "sent" (lines 89–138) and
"received" (lines 140–212) sections from the same copy-pasted scaffold: heading, empty-state text,
row = subject + org label + `StatusBadge` + conditional action buttons. A layout or a11y fix must be
mirrored by hand.

**Design:** extract an `EscalationSection({ headingKey, emptyKey, emptyTestid, listTestid, items,
orgLabel, rowActions })` (or a per-row component with an actions render-prop) used by both sections.
Must preserve the DOM exactly: every `data-testid` (`escalation-sent-*`, `escalation-received-*`,
`escalation-status-*`) and the `data-tour="escalation-accept"` hook that the tours engine drives.

## 3. `job-timeline.tsx` — status switch instead of the house lookup-map pattern

`packages/keel/src/components/job-timeline.tsx` `statusLabel()` is a 4-case switch routing status →
translation key; `escalations-card.tsx`'s `STATUS_KEY` record is the house pattern for the same
shape. Replace with `const STATUS_KEYS: Record<string, string>` + `t(STATUS_KEYS[status] ?? …)`,
keeping the default-returns-raw-status behavior.

## 4. Fake analytics `readFlags()` — one disk read per flag check

`packages/keel/src/adapters/fake/analytics.ts` `isFlagEnabled` does `existsSync` + `readFileSync` +
`JSON.parse` of `flags.json` per call; a protected page render checks two flags (the layout's
`demo-banner` and the dashboard's `sla-breach-banner`) = two synchronous reads per render. Simulated mode
only, tiny file — but it is sync work on the event loop.

Still open despite the atomic-write pass, which touched this file: that work replaced `setFlag`'s
WRITE with `writeJsonAtomicSync` and left the read path exactly as it was.

**Constraint that killed the quick fix:** flags change at runtime (Simulator Snapshots toggles write the
file), so a module-scope memo would serve stale values. A correct fix needs per-request dedupe
(React `cache()` around a read-once helper) or an mtime check. Do it only with a test that flips a
flag via the Snapshots route and observes the change in the same process.
