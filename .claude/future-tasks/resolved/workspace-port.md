# A workspace port: per-person cloud dev environments

**Priority:** P2 · **Status:** resolved as a recipe (2026-10-03)

Keel has no port for provisioning a per-person cloud development environment. A derived app that
wants to hand each person their own hosted dev workspace (a browser-reachable IDE, a sandboxed
compute environment) has no framework seam to build that against, and would have to invent both the
port shape and a real backend adapter from nothing.

**Need:** a `workspace` port generic over the backend the way the existing `llm` port is generic over
model providers — at minimum `ensure` (create or resume), `status` (phase: provisioning, running,
stopped, gone), `stop`, and `mintAccess` (a scoped, time-limited credential for that one workspace,
not a blanket admin token). A fake adapter should be an in-memory stand-in keyed by owner/name with
immutable-after-create parameters, so tests and local dev never touch a real backend. The port's
selection should be independently gated from `APP_MODE`, since a real-backend workspace demo can be
meaningful even while the rest of the app runs simulated.

Evidence: `packages/keel/src/ports/` (the existing port family — `llm.ts`, `storage.ts` — the shape a
new `workspace.ts` would match), `packages/keel/src/adapters/index.ts` (today's `APP_MODE`-only
adapter-selection pattern every other port follows, and the thing workspace selection would need to
diverge from).

## Resolution (2026-10-03): a recipe, not a port

Resolved as `docs/recipes/workspace-coder.md`, not as shipped code. Run against the two vendor-code
tests in `docs/development-approach.md` ("What the template ships"), a workspace port fails both: almost
no instance provisions per-person cloud dev environments, and an authenticated REST vendor behind a
polled long-running operation is a class keel already demonstrates. The implementation this ask was
drawn from also failed doctrine in two specific ways, which is why it was written down rather than
lifted: it chose its adapter from the backend's own env vars instead of `APP_MODE`, and it carried
product vocabulary into the adapter registry.

The recipe keeps what this file asked for — the four-operation port (`ensure`, `status`, `stop`,
`mintAccess`), an immutable-after-create fake keyed by owner/name — and answers the one request that
cut against doctrine: "selection independently gated from `APP_MODE`" becomes an explicit, named,
fail-closed override with its costs stated, never an adapter that switches itself on when its env vars
appear. Its gotchas section carries what was learned the hard way: owner-scoped tokens, 410 Gone after
a finished delete, and waiting for workspace deletes before removing the user.
