# The pre-commit hook rewrites the working tree, so two sessions can't commit in one checkout

**Priority:** P2 · **Status:** open
**Found by:** an app derived from this template, 2026-10-03. It stated the rule "never commit while
another worker edits the same tree" without measuring why. The mechanism below is checked against
lint-staged 17.2.0 (this repo's pinned version): its README section "How does lint-staged's stashing
work?" and its `lib/gitWorkflow.js`. No clobber has been reproduced here yet.

## What the hook does to files it was not asked to touch

`.husky/pre-commit` runs `pnpm exec lint-staged` with `lint-staged.config.mjs` (`eslint --fix` and
`prettier --write` on staged files). This repo passes no lint-staged flags, so it runs with the
defaults. For each commit, those defaults do the following:

1. **Back up the whole tree onto the stash stack.** It runs `git stash create`, then `git stash store`
   with the message `lint-staged automatic backup`, and drops that entry only at the end. In a linked
   worktree the stash stack is shared with every other worktree of the repo.
2. **Remove unstaged edits from partially staged files.** It writes those edits to a patch file
   (`lint-staged_unstaged.patch` in the git dir), runs `git restore --worktree` on the files, runs the
   tasks, then applies the patch again (falling back to a 3-way apply).
3. **On any task error, hard-reset the tree.** It runs `git reset --hard HEAD`, then
   `git stash apply --index` on the backup from step 1.

Each step is safe when one process owns the checkout. Each one breaks when a second session is
editing the same files in the same checkout:

- **Step 2:** an edit the other session saves to a partially staged file while the tasks run is
  overwritten by the restore, or makes the patch fail to apply.
- **Step 3:** `git reset --hard HEAD` throws away every uncommitted change to tracked files. That
  includes edits the other session made after step 1's snapshot, and the stash apply cannot bring
  those back because they are not in the snapshot. One lint error in one session's commit is enough
  to wipe the other session's work.
- **Step 1:** another session that runs a bare `git stash pop` can pop lint-staged's backup instead
  of its own entry. CLAUDE.md's stash rules exist for this reason.

So staging only your own files is not enough. A commit in a checkout another session is editing is
still unsafe.

## Shape of the change

- **Doctrine first, because it is cheap and correct today.** Add one line to CLAUDE.md's workflow
  rules: one committing session per checkout, and parallel sessions each get their own worktree.
  Give the reason (the hook rewrites the tree and can `reset --hard` it), not just the rule.
- **Then decide whether the hook should be less invasive.** lint-staged 17 has options for this.
  `--no-revert` keeps the backup but skips the hard reset on error, applying task changes to the
  index before the commit aborts. That is the narrowest fix for step 3. `--no-stash` drops the backup
  too, which implies `--no-revert`. `--no-hide-partially-staged` stops step 2, but then unstaged
  edits get committed. Each one gives up some of lint-staged's own protection against data loss, so
  this is a trade-off, not an obvious win. Measure it before choosing.
- **See it fail first.** Before changing anything, reproduce step 3 in a scratch clone. Start a
  commit whose `eslint --fix` fails, while a second shell edits another tracked file mid-run, and
  confirm the second edit is lost. Then confirm that whichever fix is chosen keeps it. Until someone
  does this, the failure is inferred from the source, not observed.
