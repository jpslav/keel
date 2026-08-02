---
description: Verify, run a subagent branch review against the house rules, fix findings, then open the PR
---

1. Run `pnpm verify`. If anything fails, fix it and re-run until green. If Playwright complains about a
   missing browser, run `pnpm exec playwright install chromium` once, then retry.
2. Spawn a read-only review subagent on the full branch diff vs `main`. Give it this checklist:
    - CLAUDE.md hard-rule violations: vendor SDK imports outside `packages/keel/src/adapters/`, framework imports in
      `keel/core`, tenant queries not routed through `db.withTenant()`, hard-coded UI strings.
    - Dead or speculative code.
    - Copy-paste that should be a shared function or component.
    - `apps/showcase/messages/en.json` vs `apps/showcase/messages/es.json` drift (missing keys, mismatched placeholders).
    - Tests that assert nothing (empty bodies, missing expect, tautological assertions).
    - Quiet weakening of quality configs: new `eslint-disable` comments, knip/jscpd ignores, raised
      `BUDGET_BYTES`, loosened thresholds — flag any without a written justification.
3. Triage the findings: fix confirmed ones and re-run `pnpm verify` until green again. For anything
   dismissed, note a one-line reason.
4. Done when `pnpm verify` is green, every finding is either fixed or dismissed-with-reason, commits
   are conventional, and a PR is open against `main` whose description summarizes the change AND the
   review outcome (including dismissals).
