---
description: Run a branch review in a subagent, analyze its findings independently, then confirm before fixing
---

## Overview

Launch a subagent to review the current branch. Once the subagent returns its findings, make your own independent analysis of those findings — filter noise, prioritize real issues, and identify anything the subagent may have missed or over-flagged. Present your analysis to the user and get explicit confirmation before fixing any issues.

## Determining the base branch

Before reviewing, detect the actual branch point: run `git log --oneline --decorate --all --simplify-by-decoration --max-count=100` and identify the most recent branch point ancestor that is not the current branch (e.g., `main`, `develop`). Use `git merge-base --fork-point <candidate> HEAD` for likely upstream branches. Use this as the base for all diffs — do NOT hardcode `main`. (`--max-count=100`, not `HEAD~100..HEAD`: this repo is published as a single root commit, and a range naming a hundredth ancestor is fatal on a fresh clone.)

## Steps

1. **Determine the base branch** (see above). Store as `BASE`.
2. **Launch a subagent** to perform the review. The subagent prompt should instruct it to:
    - Run `git log $BASE..HEAD --oneline` and `git diff $BASE..HEAD --stat` to understand scope.
    - Run `git diff $BASE..HEAD` to read the full diff.
    - Read changed source files as needed to understand context.
    - Identify issues (bugs, logic errors, style problems, missing edge cases, security concerns).
    - Recommend fixes and ask questions if it has them.
    - Return a structured report of all findings.
3. **Present the subagent's findings in full detail.** For each issue the subagent found, print the complete details so the user can understand the issue without having seen the subagent's raw output. Each issue should include:
    - A clear title and severity
    - What the problem is, with specific file/line references
    - The relevant code snippet or diff context
    - What the subagent recommends
4. **Then, for each issue, give your own take.** After presenting the full details of all issues, go through them one by one and state whether you agree/disagree, why, and whether you recommend fixing it in this change. Conclude with a clear recommendation of which issues to fix and which to skip.
    - Filter false positives and nitpicks
    - Note anything the subagent may have missed
    - Prioritize by severity (bugs > logic errors > style)
5. **Only after the user confirms**, fix the agreed-upon issues.
