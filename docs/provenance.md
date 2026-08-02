# Where this came from

This repository begins at one commit. That is deliberate, and this file is what it replaces.

keel was built as the foundation for a real application, over seven working days in July 2026, and
then generalised into a template. The application it was built for is private and stays that way, so
the construction history was not published with the code. What follows is the part of that history
worth carrying forward: the order things happened in, and the few choices that order explains.

## The decisions came before the code

The second commit of the original repository recorded eleven architecture decisions as **Accepted** —
hosting, data layer, auth, tenancy, UI, isomorphic core, repo shape, i18n, LLM, observability, email.
The application itself was scaffolded four commits later.

That ordering is the reason `docs/adr/` says the design is decided rather than aspirational, and it
is why routine work does not relitigate an ADR. The decisions were not reverse-engineered from code
that already existed; the code was written against them.

The riskiest of them was proved before anything was built on it. Tenancy by Postgres row-level
security only works if the local development story can run the same policies — so a spike ran the
isolation proofs against an in-process Postgres before the first feature existed. `spikes/` still
holds that harness, and `docs/development-approach.md` explains why a spike produces a written
finding rather than shipped code.

## The framework was extracted, not designed

For the first four days there was no framework. There was an application, built in thin vertical
slices: ports and their fakes, then auth, jobs, service-to-service auth, uploads, audit, scheduled
work, outbound webhooks, notifications, inbound email, access gates. Each slice shipped its own fake,
its own tests, and its twin in the static demo.

The framework/app line (ADR-0012) was drawn on the fifth day, over code that already worked, and the
extraction followed: the generic half moved to `packages/keel`, the application became
`apps/showcase`, and the simulated world moved into the framework so a second app could inherit it.

This matters more than it sounds. A framework designed up front is a set of guesses about what an
application will need. This one was cut out of an application that already needed those things, which
is why the seam is shaped the way it is — and why so much of it is enforced by a lint rule or a test
rather than by a convention. The boundaries had to be discovered before they could be gated.

**`apps/starter` exists to falsify the line.** A second consumer was added specifically so the seam
could be wrong in a way that fails a build: it typechecks the whole framework against its own
registrations, so anything keel reaches for that only the showcase supplies breaks there and nowhere
else. A framework with one consumer cannot tell the difference between a boundary and a habit.

## The names are plain on purpose

Every concept in this repo is named the most ordinary word that fits, and each concept has exactly
one name. People are people, not personas. Snapshots are snapshots. The panel that drives the
simulated world is the Simulator, and the world it drives is the simulated world.

This was a deliberate pass, made once the concepts had settled rather than while they were moving,
and it is worth keeping as a rule: **when a concept and its name disagree, change the name.** A clever
name costs every future reader a translation, and a name that means two things costs them a mistake.
ADR-0012 records the one-proper-noun-per-half rule that came out of it — `keel` for the framework,
`Simulator` for the panel, plain words for everything inside both.

## What is not here

- **The application keel was built for**, by name, and the anatomy of the applications the capability
  analysis was measured against. `docs/app-coverage-gaps.md` says what KIND of product round 1 measured
  — a regulated-data research application — because that is what makes its gap list legible. What it
  does not carry is whose it was or how it was built, which was not ours to describe.
- **Commit-by-commit history.** It exists privately. Nothing here depends on it: the reasoning that
  justifies a decision lives in `docs/adr/`, the decisions that were not planned live in
  `docs/decision-log.md`, and the things that cost someone a day live in `docs/build-notes.md`.

What IS here, and is worth knowing before you read it: those two records are the working notes of the
build, so they name machines, tooling accidents and the order things happened in. That is deliberate —
a note saying which measurement disproved a theory is worth more than a tidy one that omits it — but it
means they read like a workshop floor rather than a manual.

Those files are the real provenance, and they are maintained rather than frozen. A git log tells
you what changed; they tell you why, which is the part that does not survive a diff.

## Reading the dated records

`docs/decision-log.md` and `docs/build-notes.md` are append-only. An entry was true when written and
is never edited to match a later tree, so a later entry supersedes an earlier one rather than
replacing it. They carry dates from the original build; those dates are real, even though the commits
behind them are not public.

**They also cite things you cannot look up**: commit SHAs, PR numbers and branch names from the
unpublished history. Those references are kept because they date an entry and group entries that
landed together, but none of them resolves in this repository — and a PR number in an entry is NOT a
pull request in this repo, which will one day have its own numbering that collides with them.

`docs/adr/` is dated at publication. Each ADR states the decision as it holds today, with the
reasoning that survived. From here the amendment rule applies: an ADR is amended by appending a dated
addendum, never by editing what it said.

One consequence is visible in those two records. They were written while the ADRs were still being
amended by appending, so entries cite things like "ADR-0003's addendum" — and the consolidation at
publication folded that material into the body. **Read such a citation as naming the ADR itself.** The
entries are not edited to say so, for the same reason the dates are not: an entry was true when
written.
