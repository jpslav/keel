# The doc set

Three kinds of document live in this repo, and the difference matters because it tells you what to trust.

- **Doctrine** — maintained and binding. Read it before building. If a doctrine doc contradicts the code,
  that is a bug in the doc and it gets fixed.
- **Records** — dated, append-only logs of decisions and lessons. Entries were true when written and are
  never rewritten; later entries supersede earlier ones. Useful; not authoritative about the present.
- **Future tasks** — `.claude/future-tasks/`, designed-but-unbuilt work, kept beside the other agent state
  rather than in the human doc set.

A guard enforces the first distinction: `tests/docs/doc-paths.test.ts` fails the build if a doctrine doc
cites a repo path that does not exist. Records are exempt — rewriting a dated entry to match today's tree
would be revisionist — so their paths are corrected opportunistically, never gated.

## Doctrine

- [provenance.md](provenance.md) — where keel came from, why the framework was extracted rather than
  designed, and what deliberately is not in this repository
- [adopting.md](adopting.md) — using this repo as a template: identity, the framework/app seam, demo
  removal, cutover
- [development-approach.md](development-approach.md) — the engineering philosophy: thin slices,
  ports/adapters, hermetic dev, demo mode, the template/instance doctrine
- [adr/](adr/) — the architecture decisions, all Accepted. Each body states the decision as it holds
  today; from here an ADR is amended by appending a **dated addendum**, never by editing what it said
- [auth-ui-playbook.md](auth-ui-playbook.md) — the recipe for adding auth capabilities (Clerk anatomy
  re-expressed in Mantine)
- [app-coverage-gaps.md](app-coverage-gaps.md) — the capability triage: what the template ships vs defers,
  and the doctrine for deciding the next case
- [recipes/](recipes/) — capabilities the template deliberately doesn't ship: vendor integrations
  (e-sign, SMS, web push) and generic UI it has no invariant to encode (the list/table kit); copy one
  when an instance needs the capability
- [runbooks/](runbooks/) — [demo.md](runbooks/demo.md), the guided tour of everything the scaffold does,
  and [deploy.md](runbooks/deploy.md), the deploy shape
- [cutover-checklist.md](cutover-checklist.md) — your instance's live list of deferred credential-needing
  items and what unlocks each

## Records

- [decision-log.md](decision-log.md) — running log of unplanned decisions, appended as they happen
- [build-notes.md](build-notes.md) — running log of hard-won lessons ("wish someone had told me"). The
  most useful file in the repo when something behaves strangely

The records name branches, dates and slices from the template's own construction. That is what makes them
worth keeping — a lesson without its circumstances is a slogan — but it also means they describe a repo
that has moved on. When a record and a doctrine doc disagree about the present, the doctrine doc wins.
