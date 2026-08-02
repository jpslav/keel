# `--eject-showcase` rewrites prose into sentences that are false, not merely stale

**Priority:** P2 · **Status:** open
**Found by:** pre-open-sourcing pass, round four (fresh-eyes adopter lens against the published
squash), 2026-08-02. Confirmed against a real `pnpm init-app acme --eject-showcase --yes`.

## What happens

`init-app` renames the app you keep and rewrites every citation of the app you delete onto it — so
`apps/showcase` and `apps/starter` both become the SAME directory, `apps/<app>/`. Where a sentence
names both apps in order to contrast them, the rewrite collapses the contrast and the result asserts
something untrue. README's adoption paragraph is the clearest case. After a real eject to the slug
`acme` it reads:

```
Two example apps ship here: apps/acme (a support desk — tickets, escalations, file attachments,
an export job run by a simulated external service) so every framework capability has a living
worked example, and apps/acme, the minimum you keep. Build against the showcase as your
reference, eject it when you no longer read it.
```

So the adopter's own README tells them their one-entity starter is a support desk with tickets and
escalations, and instructs them to build against an app the same command just deleted.

## Why it is P2 and not higher

**It is disclosed.** `docs/adopting.md` warns that prose is not rewritten, and `init-app`'s closing
output lists README first under "PROSE STILL TO REVIEW". An adopter who reads the output it prints is
told to go and fix this file.

But there is a real difference between _leaving_ a sentence stale and _rewriting it into a false
one_. The path rewriter is what produced the contradiction; without it the sentence would still name
`apps/showcase` and simply be obviously out of date, which is easier to spot and safer to skim past.

## The shape of the fix

`tests/docs/doc-set.ts` already exports `generalizeAppCitations`, which rewrites a citation of a
deleted app into the metavariable form `apps/<app>/`. `scripts/init-app.ts` applies it only to
citations that no longer **resolve** — and the ejected app's citations resolve, because they were
just rewritten onto the survivor. So the generalizer never sees them.

The fix is to generalize citations of the **ejected** app rather than mapping them onto the
survivor's name, which turns the sentence merely generic instead of self-contradicting. That is a
change to rewrite ordering and to which paths count as "missing", so it needs care.

## Why it was deferred rather than fixed in round four

Changing `init-app`'s rewrite semantics is the highest-blast-radius edit available in this repo days
before publication: it is gated by `tests/docs/adopter-identity.test.ts` and by the `adoption-probe`
CI job, and this repo's documented second failure pattern is that **every cleanup manufactures the
next finding** — deleting the frozen construction record orphaned 175 citations, and folding the ADR
addenda into their bodies orphaned about 24 more. Trading a disclosed LOW for an undisclosed
regression in the one command every adopter runs first was not worth it at that moment. It is worth
doing next.

## How to verify a fix

Run the real thing, not the unit test — in a scratch copy, and NOT under `/tmp` (see
`resolved/adoption-probe-not-under-tmp.md`):

```
pnpm init-app acme --eject-showcase --yes
grep -n 'apps/acme' README.md
```

No sentence may name the survivor's directory twice in a way that contrasts two apps. Then
`pnpm install --no-frozen-lockfile` and `pnpm verify` must still be green, and
`tests/docs/adopter-identity.test.ts` must still pass.
