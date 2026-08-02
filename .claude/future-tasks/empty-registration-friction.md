# "Empty registration is the off switch" is true 11 times out of 12

**Priority:** P2 · **Status:** open
**Found by:** `apps/starter`, 2026-07-31. Recorded in ADR-0012, "Unused capability = empty registration".

Two seam modules make an app that wants NOTHING still write something:

- **`AppSubjectFields`** — `AbilitySubject extends AppSubjectFields`, so it must be an `interface` (a
  mapped type cannot be extended). An app with no extra subject fields declares an empty interface _and_
  suppresses `@typescript-eslint/no-empty-object-type`. Making an adopter silence a lint rule to express
  "I need nothing here" is the opposite of the claim.
- **`appNotificationCopy`** — the framework's `switch` calls it unconditionally from `default:`, so an
  app registering zero kinds still writes the function. With both parameters `never` the honest body is
  to return one, which reads as a puzzle rather than an off switch.

**Why it matters:** `docs/adopting.md` sells "an unused framework capability needs nothing: an empty
registration is the off switch." The starter proves that for 11 of 12 modules. The two exceptions are
small, but they are the ones an adopter meets while still deciding whether to trust the claim.

**Approach:** for `AppSubjectFields`, try `AbilitySubject = BaseSubject & AppSubjectFields` (intersection
rather than extension) so a mapped type or `Record<never, never>` becomes legal. For
`appNotificationCopy`, have the framework fall back when the app's kind list is empty instead of calling
through.
