# A workspace port: per-person cloud dev environments

**Priority:** P2 · **Status:** open

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
