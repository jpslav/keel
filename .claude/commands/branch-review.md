---
description: Review the current branch in plan mode, present findings with recommendations, then implement
---

Enter plan mode.

Review the current branch: identify issues and recommend fixes. **Present the review first, then
implement as a follow-on.** Put a clear recommendation inline with each finding so the user reacts to a
concrete proposal — do not front-run the review with design questions.

## Determining the base branch

Before reviewing, detect the actual branch point: run `git log --oneline --decorate --all --simplify-by-decoration --max-count=100` and identify the most recent branch point ancestor that is not the current branch (e.g., `main`, `develop`). Use `git merge-base --fork-point <candidate> HEAD` for likely upstream branches. Use this as the base for all diffs — do NOT hardcode `main`. (`--max-count=100`, not `HEAD~100..HEAD`: this repo is published as a single root commit, and a range naming a hundredth ancestor is fatal on a fresh clone.)

## Steps

1. Determine the base branch (see above). Store as `BASE`.
2. Run `git log $BASE..HEAD --oneline` and `git diff $BASE..HEAD --stat` to understand scope.
3. Run `git diff $BASE..HEAD` to read the full diff.
4. Read changed source files as needed to understand context. Where feasible, verify findings against the
   project's own gates (tests, typecheck, lint, build, a dev smoke-check) so the review rests on evidence,
   not inference — and note which gates are actually enforced (CI / build) vs advisory.
5. Write the review to the plan file: findings ordered by severity, **each with a clear recommendation**,
   followed by a consolidated recommended fix set. For any genuine design fork, state your recommendation
   and the trade-off in the plan rather than asking up front — the user comments on the written review.
6. Present the review with **ExitPlanMode**. Reserve `AskUserQuestion` for a blocker that prevents
   _writing_ the review (e.g. you genuinely can't tell which branch is the base) — never for choosing among
   fixes, which belong in the presented recommendations.
7. **Implementation is the follow-on.** After the user approves/comments, implement the agreed fix set:
   your recommendations are the default; the user's comments override.
