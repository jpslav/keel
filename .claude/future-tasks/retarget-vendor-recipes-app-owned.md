# Two vendor recipes still put an app's port in keel's tree

**Priority:** P2 · **Status:** open
**Found by:** the app-owned adapters slice, 2026-11-16 (`feat/app-owned-adapters`).

## What is true

App-owned ports now exist (`docs/recipes/app-owned-adapter.md`, ADR-0012's 2026-11-16 addendum): a port
only the app calls, for a vendor that fails the universality and new-class tests, lives under
`apps/<app>/src/`, and its vendor SDK under `apps/<app>/src/adapters/real/`. Two recipes were written before
that and still place their port, fake and real adapter under `packages/keel/src/`:

- `docs/recipes/workspace-coder.md` §2–§5. It argues the port "stays generic", so it belongs in keel's tree.
  But the recipe is a recipe because the vendor fails both tests, so keel would not take it upstream, and
  ADR-0013 says an adopter must not carry a keel change in a fork.
- `docs/recipes/e-sign.md` §2. Its port is called by the app's signature gates, but its gates sit beside
  keel's agreement gates in `evaluateGates`, which is a framework call. Decide whether that makes it keel's
  port (keel's code calls it) or the app's (the app registers the gate).

Each now carries one sentence pointing at the app-owned alternative. Neither has been reworked.

`docs/recipes/sms-twilio.md` and `docs/recipes/web-push.md` are NOT in scope: their adapter sits behind a
channel keel owns (`packages/keel/src/server-lib/sms.ts`), so it is keel code by the same rule.

## What done looks like

For each of the two: decide whose port it is by the rule in `.claude/commands/new-port.md`, then either
rewrite its paths to `apps/<app>/src/ports/`, `apps/<app>/src/adapters/{fake,real}/` and the app registry,
with the config section moved from keel's `REQUIRED_ENV` to the app's `real/index.ts`, or record in the
recipe why it stays keel's. The doc-path gate will check the paths.
