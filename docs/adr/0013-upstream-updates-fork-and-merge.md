# ADR-0013 — Upstream updates: keel is publishable-shaped, distributed by fork and merge

- Status: Accepted
- Approver: JP Slavinsky
- Date: 2026-08-01

## Context

Adoption is a fork. `pnpm init-app <slug> --eject-showcase` leaves a repo containing both the adopter's
app and a full copy of `packages/keel`, and from that moment the two histories diverge. The question this
ADR settles is the one that is easy to leave unwritten: **when keel improves, how does an adopted fork
get the improvement?** Without an answer in the doc set, every adopter invents one, differently.

The tempting answer is "publish keel to a registry and let forks bump a version". Most of what makes that
possible is already true, and it is worth being precise about how much:

- **The public surface is declared and enforced.** ADR-0012 narrowed the `exports` map from a wildcard to
  126 explicit subpaths, made the default for a new module private, and put a lint rule
  (`keel/public-surface`) behind it that reads the map itself. That is the hard part of shipping a
  library, and it is done.
- **There are no host escapes.** The package's inputs are its seam and its own tree. Identity arrives
  through `@app-config/identity`; the RLS proofs split along the framework/app line; keel's own tests run
  against its own fixture seam rather than a host app's world.
- **There are two proven consumers.** `apps/showcase` and `apps/starter` compile the whole framework
  against different registrations, which is the only reliable way to discover that a "generic" module
  quietly assumed one app.

What is NOT true is that anyone needs a registry yet. A published package buys three things — version
pinning, dependency resolution for consumers who cannot see the source, and a release cadence — and all
three carry a cost paid every release: semver discipline, a changelog, deprecation windows, and the
inability to change a shared type without a major bump. There are currently **no external versioned
consumers**; the two apps in this repo are examples, not customers. Paying release overhead to serve zero
of them is pure cost.

There is also a shape problem a registry would not solve. keel is not a library you add to an existing
app; it is the substrate an app is built ON. An adopter takes the verify gate, the lint fences, the CI
workflows, the docs doctrine, the infra draft and the `apps/` layout at the same time. Those are repo
scaffolding, not package contents — `pnpm add keel` cannot deliver them, so even a published keel would
leave the interesting half of an upgrade to be merged by hand.

## Decision

**keel is kept publishable-SHAPED, and distributed by fork-and-merge. It is not published, and it is not
versioned.**

Publishable-shaped is a standing constraint, not an aspiration: the `exports` map stays explicit and
lint-enforced, new modules stay private by default, the package keeps zero host escapes, and it keeps at
least two consumers compiling against it. Those are exactly the properties that make an eventual publish
a packaging task rather than a redesign, and every one of them pays for itself today by keeping the
framework/app line falsifiable.

### Taking upstream into your fork

```sh
git remote add upstream https://github.com/jpslav/keel.git
git fetch upstream
git merge upstream/main          # or: git merge --no-ff upstream/main
pnpm install && pnpm verify      # the merge is not done until the gate is green
```

**This assumes your repository shares history with keel** — that you took it by fork or `git clone`.
A copy made with GitHub's "Use this template" button, or from a downloaded archive, has an unrelated
root commit, and the merge above fails outright with `fatal: refusing to merge unrelated histories`
even though the trees are identical. Since fork-and-merge is the entire distribution mechanism this
ADR chooses, shared history is a precondition of the decision rather than an incidental detail, and
keel is deliberately not published as a GitHub template repository for that reason. A fork that has
already been made the other way can be rescued once with
`git merge --allow-unrelated-histories upstream/main`, at the cost of resolving that first merge as
though every file conflicted.

Take upstream in **whole merges, not cherry-picks**. A cherry-pick that takes a keel change without the
lint fence, migration or seam contract it shipped with produces a fork that passes nothing, and whose next
merge conflicts against a history it never recorded. Merge, resolve, and let `pnpm verify` be the arbiter
— the gate is the compatibility test that a version number would only have approximated.

**Where conflicts land, and what they mean:**

| Area                                                                             | Expect               | Because                                                                   |
| -------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------- |
| `packages/keel/**`                                                               | clean, nearly always | you don't edit it — that is the rule the fence enforces                   |
| `apps/<yours>/**`                                                                | clean                | upstream never touched your directory; it edits `apps/showcase`/`starter` |
| `apps/showcase/**`, `packages/seed/**`                                           | delete/modify        | you ejected them; resolve as "keep deleted", every time                   |
| `apps/starter/**`                                                                | delete/modify        | same, if you renamed it — `init-app` renamed the directory                |
| root configs (`package.json`, `knip.json`, both vitest configs, `tsconfig.json`) | real conflicts       | `init-app` rewrote the app names these name                               |
| `docs/**`, `CLAUDE.md`, `README.md`                                              | real conflicts       | `init-app` rewrote path citations; you rewrote the prose                  |

The root configs conflict for a reason worth naming: adoption's mechanical edits are concentrated there
deliberately, so that the app list and the contract app are each a single literal
(`vitest.config.ts`'s `APPS`, `vitest.contract.config.ts`'s `CONTRACT_APP`). A one-line conflict you
resolve in five seconds is the price of not having those names scattered across a dozen files.

### Sending a keel fix back upstream

**A keel change must never be carried locally in a fork.** Two reasons, and the second is the one people
underestimate. A local edit inside `packages/keel` is a permanent merge-conflict generator: it is in the
one tree upstream changes most and you were promised would stay clean, so every future merge pays for it
again. And it was never checked against a second consumer — the property that makes a keel change
trustworthy is that it compiles against two different registrations, and your fork has one.

So when you fix or improve keel, upstream it:

```sh
git fetch upstream
git checkout -b fix/<thing> upstream/main    # branch off UPSTREAM, not your fork's main
git cherry-pick <sha>…                        # only the packages/keel commits
pnpm install && pnpm verify                   # against both example apps, which your fork no longer has
gh pr create --repo jpslav/keel --base main
```

Branching off `upstream/main` rather than your own main is what keeps the PR reviewable: a branch off your
fork carries your app, your renames and your ejected directories, and the diff is unreadable. Take **only**
the `packages/keel` commits — if your fix is entangled with app changes, that entanglement is itself the
signal that the change is not yet generic.

The practical consequence is a discipline while you work: **keep keel changes in their own commits**, not
mixed with product work, so cherry-picking them out later is mechanical. If a keel change is urgent and
upstream is slow, carry it as a clearly-labelled patch commit you intend to drop when the upstream version
merges — and drop it on the merge that brings it back, rather than leaving both.

## Consequences

- Adopters get a documented, boring answer on day one, and `docs/adopting.md` links to it.
- The framework's discipline is preserved by usefulness rather than by ceremony: the `exports` map, the
  fence and the two-consumer rule earn their keep now and happen to be the publish prerequisites.
- Merging carries no semver promise. Upstream may change a shared type; the fork finds out from
  `pnpm verify`, which is stricter than a version range would have been and arrives at merge time rather
  than at runtime.
- Forks that diverge for a long time pay a larger merge. The mitigation is cadence, not tooling: merge
  upstream often enough that each merge is small.
- The `keel/public-surface` rule is what makes long-lived forks survivable at all — an app that only ever
  imported published subpaths merges cleanly against internal refactors, and one that reached into
  internals would not. The fence is load-bearing for the upstream story, not just for taste.
- Upstreaming requires the contributor to run the gate against both example apps, which a fork that
  ejected them cannot do. That is deliberate: it is the same two-consumer check the framework rests on.

**What would trigger revisiting this.** Any one of these, on its own, is enough to reopen the publish
question:

1. **A second real app outside this repo** — the first moment a version number has two consumers to be
   different for.
2. **A fork that cannot merge** — if resolving upstream stops being mechanical, the fork boundary is in
   the wrong place and a package boundary is the fix.
3. **An adopter who cannot take the whole repo** — someone wanting keel inside an existing application
   would need a real package, and would also force the honest scoping of what keel is without the
   scaffold.
4. **keel changing much more slowly than the apps on it** — a stable framework is cheap to version; the
   cost assumed above is the cost of versioning something still moving.

Until one of those happens, a registry entry would be a version number with nobody to tell.

## Addendum — 2026-11-16: a merged-in doc may cite the reference apps

The table of where conflicts land says `docs/**` conflicts because `init-app` rewrote path citations. It
missed a second effect. A doc that arrives in a LATER merge can cite `apps/showcase/…` or `apps/starter/…`,
which an adopted tree no longer has, and the path gate (`tests/docs/doc-paths.test.ts`) went red on a
citation nobody in the adopter's repo wrote. The first instance was a recipe citing the starter's sign-in
page, merged into a tree that had ejected the showcase and renamed the starter; the adopter fixed their own
copy, and every later doc naming either app would have done the same. `init-app` could not prevent it: it
runs once, and the merge brings new text after it has.

`resolves` in `tests/docs/doc-set.ts` now treats a citation under `apps/showcase/` or `apps/starter/` as a
reference to keel's own app whenever that app is not in the tree, and checks it like any other wherever the
app exists. "In the tree" means the app's `package.json`, not its directory, because a merge brings back any new
file upstream adds under `apps/showcase/` even after you deleted the app (it conflicts only when you also
edited or deleted a file upstream changed), and a directory holding one stray file must not switch the rule off. So the template's CI still fails on a broken one, a tree that renamed the starter but kept the
showcase is still strict about the showcase, and citations of the adopter's own app or of `packages/keel` stay
strict everywhere. The rule lives in the file the gate and `init-app` share, so the rewriter and the gate
cannot disagree about it. A doc that means the reader's own app should still say `apps/<app>/…`.

## Addendum — 2026-11-17: proposed to be superseded by ADR-0014

The first trigger for revisiting this ADR has fired: a second real app outside this repo. The SafeInsights
sharing site (`safeinsights/pages`) adopted keel by fork this week.
[ADR-0014](0014-distribution-as-versioned-packages.md), Proposed, would replace fork and merge with versioned
packages, the scaffold included.

Its measurement of that fork bears on this ADR's table of where conflicts land. `packages/keel` behaved as
promised: Pages has no local edits to it, and every file that differs is an older keel version. The conflicts
landed in the scaffold, which the table lists as "real conflicts". 65 of the 176 files outside `apps/`,
`packages/` and the lockfile differ from every version keel has had, and each conflicts on any upstream change.

Until ADR-0014 is accepted and Pages has switched, this ADR stands as written, and adopters keep taking upstream
by merge.
