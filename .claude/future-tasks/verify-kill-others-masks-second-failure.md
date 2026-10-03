# `pnpm verify` kills its other checks on the first failure, hiding a second one

**Priority:** P2 · **Status:** open
**Found by:** an app derived from this template, 2026-10-03. It hid a second, independent bug until the
first was fixed. Re-checked here against the root `package.json`.

## The gap

`verify` starts with
`concurrently --kill-others-on-fail --group 'pnpm:typecheck' 'pnpm:lint' 'pnpm:test:unit' 'pnpm:knip'`.
With `--kill-others-on-fail`, the first check to exit non-zero makes `concurrently` SIGTERM the rest.
In the case that was observed, `lint` failed first and took `test:unit` down before it could
report anything. The killed check is logged as `exited with code SIGTERM`, which reads as "interrupted", not as
"would also have failed".

Measured with concurrently 10.0.4 and two commands that both fail:

- With `--kill-others-on-fail`, the slower command is killed and its failure never prints.
- Without the flag, both failures print. The exit code is still 1, because concurrently's default
  `--success all` fails the run if any command fails.

The cost is a slower loop, not a wrong answer. A session fixes the lint error, reruns, and only then
sees the unit failure that was already there. Each extra round costs a full `verify`. CI's
`adoption-probe` job runs `pnpm verify` too, so its log can also show only the first failure.

## Why the flag is there

Speed. When a fast check has already failed, nobody wants to wait for the slow ones before the
prompt comes back. That is a reasonable default for the inner loop. It is the wrong default for a
gate that agents run and then read as a full list of what is broken.

## Shape of the change

Pick one, and write the choice down in `docs/decision-log.md`:

- **Drop the flag.** All four checks always finish, so a red run lists every failure. The wait is
  bounded by the slowest check, which already sets the wall clock for a green run. The `&&` chain
  after the group (e2e, static-demo build, size budget, static-demo e2e) still stops at the first red,
  and should: those steps are expensive, and they run against a tree already known to be broken.
- **Keep fail-fast as the default and add a full-report mode.** For example, a `verify:all` script,
  or an env switch that leaves the flag out. `/verify` and `/pre-pr` would use that mode, since they
  read the output to fix things.

Either way, put "a SIGTERM'd check is unknown, not passed" in `/verify`'s instructions, so a session
reading an old log does not count a killed check as green.
