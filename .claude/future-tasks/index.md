# Future tasks index

Designed-but-unbuilt work, sketched far enough that a later session can pick one up cold. Each file
carries the design so it never has to be re-derived. These are agent-actionable work items, which
belong beside the other agent state in `.claude/`, not in the human doctrine set under `docs/`.

Priority levels:

- **P0** — Blocks adoption or correctness; data loss, security, or a broken gate
- **P1** — Significant gap under normal use; important quality debt
- **P2** — Useful enhancement or feature work
- **P3** — Nice-to-have; low impact, or blocked on something that does not exist yet

When you finish one, write the implementation summary into the file and **move it to `resolved/`**, then
move its row to the Resolved table below. The design rationale stays useful, and a finished task sitting
in an open table is worse than no backlog — it makes the repo overstate its own problems.

Two rules that follow from the move:

- **`resolved/` is exempt from the doc-path gate** (`tests/docs/doc-set.ts`), because a resolved task
  routinely cites paths that the very work resolving it moved or deleted. It is a dated record, like
  `docs/decision-log.md`.
- **The gate cannot catch a stale citation of a moved task either** — `resolves()` lets a file citation
  pass on its parent directory existing, and `.claude/future-tasks/` still exists. So when you move a
  file, grep for `future-tasks/` across the repo and repoint every hit by hand.

These files are dated records, like `docs/build-notes.md` and `docs/decision-log.md`: they cite
branch names, review rounds and commits from the repository history that was not published, so some
of what they reference cannot be looked up. See "Reading the dated records" in
`docs/provenance.md` for why that history is absent. Read them for the design and the measurements,
not as a map of the current tree.

Numbers in these files are measurements, not decoration. Re-derive one before you quote it; several of
them had drifted a long way from the code by the time anyone checked.

---

## P1 — High-impact correctness or quality

| File                                                                             | Summary                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [e2e-shared-world-blocks-parallelism.md](e2e-shared-world-blocks-parallelism.md) | `workers: 1` was blamed on a 10GB VM's memory; measured on a 64GB machine, flakes scale with workers because every worker shares ONE `.data` behind ONE dev server. **Half done:** atomic writes shipped and killed the corruption; a world per worker is untouched, and it is the half that unpins `workers`. |
| [destructive-e2e-reliability.md](destructive-e2e-reliability.md)                 | Three causes of destructive-suite flakiness were found and fixed; residual CI failures remain. **Its premise has been obsoleted twice** — the two passes now run on separate CI runners, and the "CI is 3× slower" measurement predates `E2E_BUILD`. Re-deriving the timeouts is the next step.                |

---

## P2 — Enhancements and feature work

| File                                                                                         | Summary                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [starter-e2e-ignores-e2e-build.md](starter-e2e-ignores-e2e-build.md)                         | CI sets `E2E_BUILD=1` on the whole e2e matrix, but `apps/starter/playwright.config.ts` never reads it and the starter has no `build:e2e`/`start:e2e` — so that shard silently still runs `next dev`, and CI never builds the starter at all.                                                                                             |
| [local-parallel-e2e.md](local-parallel-e2e.md)                                               | Local `pnpm verify` is ~230s serial. Sharding with a server + world each hit Next 16's per-directory `next dev` lock. **Now unblocked:** the preferred route past it — shard against the production build — has every piece it needed, and only the shard runner itself is missing.                                                      |
| [route-glue-duplication.md](route-glue-duplication.md)                                       | Every app re-states the same Next route wrappers; 11 of jscpd's 25 clone pairs are showcase-vs-starter glue. The gated number is 1.01% of a threshold of 2, so there is real headroom — but a third app is what breaks it, and the fix is promoting glue into keel, not raising the threshold.                                           |
| [contract-suite-single-app.md](contract-suite-single-app.md)                                 | `pnpm test:contract` covers one app, so per-app migrations — the ones an adopter writes — never meet real Postgres. Needs a second database.                                                                                                                                                                                             |
| [empty-registration-friction.md](empty-registration-friction.md)                             | "Empty registration is the off switch" holds for 11 of 12 seam modules; `AppSubjectFields` makes an adopter suppress a lint rule to say "nothing here", and `appNotificationCopy` makes them write a function with two `never` parameters.                                                                                               |
| [prebaked-demo-snapshots.md](prebaked-demo-snapshots.md)                                     | A script that builds 2–3 checked-in starting worlds (`fresh`, `mid-demo`, `multi-tenant`) by driving the fake adapters and saving through `saveSnapshot()`. The consumer has landed — a tour already declares the snapshot it starts from — so only the prebaked worlds are missing.                                                     |
| [llm-fixtures-tab.md](llm-fixtures-tab.md)                                                   | A Simulator tab showing which fixture answered the assistant, listing available fixtures, linking the re-record workflow. First concrete step toward the intended eval harness.                                                                                                                                                          |
| [abilities-inspector.md](abilities-inspector.md)                                             | A Simulator tab answering "what can person X do" by running `defineAbilitiesFor` over every `{action, subject}` pair. Build when a second ability-gated surface makes eyeballing people one by one tedious.                                                                                                                              |
| [eject-rewrites-prose-into-false-sentences.md](eject-rewrites-prose-into-false-sentences.md) | `--eject-showcase` maps BOTH apps onto the survivor's name, so a sentence contrasting them turns false rather than merely stale — the ejected README calls the one-entity starter a support desk. Disclosed by "PROSE STILL TO REVIEW"; the fix is generalizing the ejected app's citations instead of remapping them onto the survivor. |

---

## P3 — Nice-to-have, or blocked

| File                                                                   | Summary                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [code-review-cleanup-leftovers.md](code-review-cleanup-leftovers.md)   | Four verified-but-deferred cleanups from the 2026-07-31 full-codebase review: simulator-glue's twice-wired tab refreshers, escalations-card's duplicated list scaffold, job-timeline's status switch, and the fake analytics per-call flags read. All four are still open. |
| [per-visitor-demo-worlds.md](per-visitor-demo-worlds.md)               | World-scoped `.data/` keyed by an unguessable cookie id, so each visitor to a public demo gets their own world. Blocked on the `demo-url` cutover row; until then the public demo is one shared world.                                                                     |
| [persons-desktop.md](persons-desktop.md)                               | Reorganize People rows into a per-person "desktop" (their inbox, their thread, where they are). Deliberately blocked: needs a genuinely per-person channel to exist first, and SMS took the global shape.                                                                  |
| [artifacts-inspection.md](artifacts-inspection.md)                     | A cross-org "everything uploaded" browse view in Simulator. Scoped out because the product's own Attachments card already is the demo and rows already survive Snapshots snapshots.                                                                                        |
| [simulator-notification-mute.md](simulator-notification-mute.md)       | A Snapshots switch suppressing the notice strip and pill pulse, for screenshot-stable demo chrome.                                                                                                                                                                         |
| [demo-size-budget-headroom-thin.md](demo-size-budget-headroom-thin.md) | Both demo-size budgets pass with little room left (showcase 97.4%, starter 96.0% of budget). Not a raise request — a note so the next red `check:demo-size` is not a surprise.                                                                                             |

---

## Resolved

Finished work, kept for the design rationale and the measurements. Nothing here is a to-do.

| File                                                                                    | Resolution                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [app-kind-copy-in-framework-catalog.md](resolved/app-kind-copy-in-framework-catalog.md) | **2026-07-31.** App copy leaked into keel's catalog in three places (notification kinds, actor cards, Snapshots flags). Settled by option 2: `notificationCopy` stamps a namespace, actors and flags are handed finished strings. Keel's catalog lost nine app keys and gained none.                                                                                              |
| [e2e-against-production-build.md](resolved/e2e-against-production-build.md)             | **2026-07-31.** `E2E_BUILD=1` opts past the adapters' fail-closed guard (proven still closed by `production-guard.test.ts`); CI's shards run against a production build. Destructive went 132s → 57s, and CI exercises `next build` for the first time. Left the starter behind — see its own task.                                                                               |
| [simulator-deep-links.md](resolved/simulator-deep-links.md)                             | **2026-07-31, by Tours**, which drives the panel through its own controls (`['panel', tabId]`) rather than a URL grammar — better for a walkthrough, since the viewer sees how they would get there. Only an app-side "open the panel here" affordance is left, and it is a callback, not a design.                                                                               |
| [keel-tests-welded-to-showcase.md](resolved/keel-tests-welded-to-showcase.md)           | **2026-07-31.** keel's tests named the demo's slugs, tables and job kinds as string literals, so ejecting the showcase — which the adopter guide tells you to do — left `pnpm test:unit` and `pnpm typecheck` red. Settled by giving keel its own fixture seam (`packages/keel/test-fixture`) with deliberately neither app's vocabulary. Eject + verify is now green end to end. |
| [decision-reconciliation.md](resolved/decision-reconciliation.md)                       | **2026-08-01.** Checklist of every ADR and doctrine claim the template-adoption campaign contradicted, one row per claim, each ticked only once its record was written. The last two were the repo shape (ADR-0007 now records the `apps/` tree) and the one-app-default carve-out that goes with it. Kept for the checklist method.                                              |
| [adoption-probe-not-under-tmp.md](resolved/adoption-probe-not-under-tmp.md)             | **Not a repo defect.** The adoption acceptance test must not run under `/tmp` on macOS — the symlink gives Next two module instances and `cookies()` fails. Kept because diagnosing the false alarm cost hours.                                                                                                                                                                   |
