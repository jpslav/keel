# Recipe: per-person cloud dev workspaces (Coder)

A product that hands each person their own hosted development environment — a browser-reachable IDE on a
sandboxed container or VM — needs a seam to provision, resume, stop and reach it. keel ships none. This
is the written-down plan for building that seam against [Coder](https://coder.com)'s REST API; per the
recipe doctrine (`docs/development-approach.md`), the plan is the deliverable and nothing here is built.

## 1. Why this is a recipe, not shipped code

Run it against the two tests that govern vendor code (`docs/development-approach.md`, "What the
template ships"):

- **Universality** — will every instance provision per-person cloud workspaces? No. Almost none will;
  it is infrastructure for a product that is itself a development environment.
- **New-class** — does it teach an integration mechanic the template lacks? No. It is an outbound
  authenticated REST call to a vendor, with a polled long-running operation behind it — the class the
  LLM, email and webhook-dispatch adapters already demonstrate.

Fails both → recipe. There is a second reason to write it down instead of lifting an existing
implementation: the one that exists chose its adapter from the backend's own env vars rather than from
`APP_MODE`, and let product vocabulary into the adapter registry. Both break doctrine here — adapter
selection is `APP_MODE`-driven in `packages/keel/src/adapters/index.ts`, and the framework tree names
no app's domain. §5 says how to get the one legitimate use of that first choice without the damage.

## 2. The port

Scaffold with `/new-port workspace` (`.claude/commands/new-port.md`). Be clear about where that lands:
the command writes under `packages/keel/src/ports/`, `packages/keel/src/adapters/fake/` and
`packages/keel/src/adapters/real/` and wires the registry in `packages/keel/src/adapters/index.ts` — in
your repo that tree is yours to extend, but it is also the published surface. Nothing becomes importable
as `keel/ports/workspace` until you add the line to `packages/keel/package.json`'s `exports` map
deliberately (the `keel/public-surface` lint rule reads that map). The port itself stays generic — it
names no backend and no product, the way `llm` names no model vendor — so it belongs there; anything
about _what your workspaces are for_ stays in `apps/<app>/src/domain`.

Size it to what the app needs, not to Coder's API. Ask `/new-port` for these four operations and no more:

```ts
// packages/keel/src/ports/workspace.ts (SKETCH)
export interface WorkspaceOwner {
    username: string // the backend's identifier; URLs are built from it, not from email or display name
    email: string // the join key with your identity system
    name: string
}
export interface WorkspaceRef {
    owner: string // the username
    name: string // validate [a-z0-9-], <= 32 chars, in the port, before any call
}
export interface WorkspaceSpec {
    owner: WorkspaceOwner
    name: string
    template: string
    /** Fixed at creation. A later `ensure` never changes them. */
    parameters: Record<string, string>
    /** Re-run a workspace whose latest build failed. Off by default — see §6. */
    retryFailed?: boolean
}
export type WorkspacePhase = 'provisioning' | 'running' | 'stopped' | 'gone'
export interface WorkspaceState {
    ref: WorkspaceRef
    id: string
    phase: WorkspacePhase
    /** Non-null when the latest build failed; `phase` is then 'stopped'. */
    failure: string | null
    /** Which readiness gate is still closed — log it so a stuck workspace leaves a trail. */
    reason: string
    parameters: Record<string, string>
}
export interface WorkspacePort {
    /** Create the owner and the workspace if missing; start it if stopped. Idempotent. */
    ensure(spec: WorkspaceSpec): Promise<WorkspaceState>
    status(ref: WorkspaceRef): Promise<WorkspaceState> // an unknown workspace is phase 'gone', not a throw
    stop(ref: WorkspaceRef): Promise<void>
    /** A short-lived credential scoped to ONE workspace's owner — never the admin token. */
    mintAccess(ref: WorkspaceRef, lifetimeSeconds: number): Promise<{ token: string; expiresAt: string }>
}
```

Export a typed conflict error from the port module (§6, owner mismatch) so a route can map it to a 409
without importing the adapter. If you also need account erasure, add a fifth operation that deletes the
owner and everything they own; §6 is the part of that which bites.

## 3. The fake

`packages/keel/src/adapters/fake/workspace.ts`, fully offline. keel's convention is to persist fakes
under `dataDir()` (`packages/keel/src/adapters/fake/data-dir.ts`) with the atomic writer, so the world
survives a dev-server restart; if you do, add the directory to `LIVE_DIRS` in
`packages/keel/src/adapters/fake/simulator-admin.ts` or Snapshots reset and restore will silently skip
it. In-memory is also defensible — a workspace is a live resource, not a record — as long as you say so
in the file header. Whichever you pick, the fake must be _honest about the rules that bite_:

- Keyed by `owner/name`. `ensure` on an existing workspace returns it **without** touching its
  parameters; the fake proves the immutability rather than letting a test lean on an update that the
  real backend refuses.
- Phases advance deterministically, not by timer: a new workspace reports `provisioning` for its first
  N `status` calls, then `running` (N is a constant, `0` for a fast path). Tests that poll a real backend
  need the same loop to pass here without sleeping.
- `stop` → `stopped`; `ensure` on a stopped workspace resumes it; an unknown ref is `gone`.
- A failure switch the tests can flip (a failed build) so the `retryFailed` rule is exercised.
- An email already bound to a different username throws the typed conflict, as §6 describes.
- `mintAccess` returns an obviously fake token and an `expiresAt` computed from the requested lifetime.

## 4. The real adapter (outline)

`packages/keel/src/adapters/real/workspace.ts`. Coder's API is plain HTTPS, so no vendor SDK is involved
and nothing is added to `vendorSdkPattern` — it is `fetch` plus a per-request timeout (15 s is a sane
default; a hung request otherwise pins a poller forever) and a `Coder-Session-Token` header. Wrap
non-2xx responses in a small error class carrying `status`, so callers special-case codes instead of
matching bodies. The endpoints you will use, all under `/api/v2`:

| Step                      | Call                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Find the organization     | `GET /organizations` (take the default organization; tolerate a bare array or a wrapped one)         |
| Find the owner            | `GET /users?q=email:<exact email>`                                                                   |
| Create the owner          | `POST /users` (`login_type`, `organization_ids`)                                                     |
| Resolve the template      | `GET /organizations/{org}/templates`, matched by name (or pin an id/version in config)               |
| Read a workspace          | `GET /users/{owner}/workspace/{name}`                                                                |
| Create a workspace        | `POST /organizations/{org}/members/{owner}/workspaces` with `rich_parameter_values`                  |
| Start / stop / delete     | `POST /workspaces/{id}/builds` with `{ transition }` — answers 204 sometimes, so do not parse a body |
| Read a build's parameters | `GET /workspacebuilds/{id}/parameters`                                                               |
| Mint a scoped token       | `POST /users/{owner}/keys/tokens`                                                                    |

`ensure` is: org → owner (create if absent) → template → read the workspace → create if absent, or post a
`start` build if the latest build is `stopped` (or `failed` with `retryFailed`) → **re-read** and map.
`status` and `ensure` must share one mapping function from Coder's response to `WorkspaceState` so they
cannot disagree about readiness. Readiness is a conjunction — build `running` AND the agent connected or
lifecycle `ready` AND, if you gate on one, the specific app reporting `healthy` — and a terminal failure
(`failed`, `canceled`, a failed job) outranks an otherwise ready-looking snapshot. A template that
produces more than one agent is a template bug; throw rather than guess.

**Config and cutover.** The Coder deployment URL, the template name (and version, if pinned), and the
owner login type are non-secret parameters: they go in `apps/showcase/config/params.ts` (your app's
equivalent), per CLAUDE.md, each carrying a `// cutover: workspace-backend` comment. The admin token is a
secret: params holds only its _name_ (`adminTokenName: 'PLACEHOLDER_CODER_TOKEN_NAME'`), the value comes
from your secret store into the environment, and the adapter is the only module that reads it. Register
the env vars in `packages/keel/src/adapters/real/index.ts`'s `REQUIRED_ENV` only if every deployment of
your app provisions workspaces; otherwise build the adapter lazily and throw `CutoverPendingError`
(`packages/keel/src/ports/errors.ts`) on first use, so a deployment that never touches workspaces is not
forced to configure Coder.

Also: Coder will refuse to create an `oidc` owner until OIDC is configured, so a deployment without it
(a local stack, a trial) needs `login_type: 'password'` with a random password generated in the adapter
and discarded unread. The owner never needs to sign in to Coder — access arrives via `mintAccess`.

## 5. Selection

Like every other port: `APP_MODE` decides. Add `workspace` to the `RealPorts` shape in
`packages/keel/src/adapters/real/index.ts` and the registry line follows the pattern already there:

```ts
export const workspace: WorkspacePort = real?.workspace ?? fakeWorkspace
```

Simulated mode serves the fake, always; that is what keeps `pnpm dev`, the e2e suite and the static demo
hermetic. `process.env` is read only inside `packages/keel/src/adapters`, so config reaches the adapter
there and nowhere else.

The temptation is a demo that is _simulated everywhere except workspaces_ — a real backend proving
itself inside an otherwise canned app. Doctrine allows it only as an **explicit, named override**, not
as the real adapter turning itself on whenever its env vars happen to be present: a single
`WORKSPACE_BACKEND=real` switch, read in `packages/keel/src/adapters/index.ts`, composing
`createRealWorkspace(...)` into the registry in place of the fake. Be honest about what that costs:
you now have a second run-mode axis, so "simulated" no longer means "no network"; the override must
fail closed (set but unconfigured → `CutoverPendingError`, never a quiet fall back to the fake);
tests and the static demo must never set it; and the fail-closed production guard in that file knows
nothing about it. Reach for it only for a deliberately-run proof against a real instance, never as a
default, and write down in the file header why it exists.

## 6. Gotchas

Collected from running a real implementation against a live deployment. Where one was read from the
backend's source rather than observed, it says so — your first cutover run is what settles it.

1. **Tokens are owner-scoped.** A Coder token belongs to a _user_; it is minted at
   `/users/{owner}/keys/tokens`, with that owner's identity, and it can reach **all** of that user's
   workspaces, not just the one you meant. Never hand a caller the admin token: mint a per-owner token
   with the narrowest scope the backend offers (connect-to-workspace-apps only, so a leaked token
   cannot manage the account) and the shortest lifetime the use allows. The lifetime is a Go duration
   on the wire — **nanoseconds**, not seconds. Give each token a distinct name (a random suffix is
   enough). The backend scopes by user, not by workspace, so if one person holds several workspaces the
   port's "one workspace" promise is really "one owner": keep lifetimes short enough that the token is
   disposable, and mint per use rather than caching.
2. **A deleted workspace answers 410 Gone.** Once a delete finishes, `GET` on the workspace returns
   `410`, not `404` (read from its source), unless the request asks to include deleted ones. Map 404, 410 and (as observed
   for a missing lookup by owner/name) 400 to phase `gone`; do not retry and do not surface it as an
   error. Treating 410 as transient produces a poller that retries a finished delete forever.
3. **Deleting a user with workspaces fails.** Coder refuses to remove an account that still owns
   workspaces (HTTP 417, read from its source). A `delete` build transition only _queues_ the teardown;
   the workspace is gone when the build job finishes. So erasure is: list the owner's workspaces → post
   a `delete` transition for each → **poll each until it is gone** (404/410, or a latest build status of
   `deleted`) with a hard deadline that throws rather than being swallowed → only then delete the user.
   Skip the wait and the user delete races the job. This sequence was authored against the API's documented
   behaviour and flagged unverified until exercised live; confirm whether your Coder version cascades.
4. **Owner-account mismatch.** The owner is joined on **exact email** (`q=email:<address>`). A bare `q=`
   is a substring match across email, username and name and will hand `jo@x.org` the account of
   `ajo@x.org`. If an account exists for that email under a _different_ username (someone signed in
   through SSO first), refuse it with the typed conflict before any mutating call — if your parameters
   are signed for one username, a workspace built under another can never start.
5. **Parameters are immutable after create.** `ensure` on an existing workspace must not claim to update
   them. Surface the existing values in `WorkspaceState.parameters` so the caller can see the drift.
6. **A failed build is not auto-retried.** Re-running it on every poll hides a permanent failure behind an
   endless "provisioning". Report the failure with its reason; restart only when a person asks
   (`retryFailed`).
7. **Poll by build status, not by creation.** `create` returns before there is an agent; "no agent yet"
   is `provisioning`, not an error. Read the workspace again after any mutation.
8. **Names are constrained.** Lowercase alphanumerics and hyphens, 32 characters at most; validate in
   the port so a bad name fails identically on the fake and the real adapter.

## 7. Testing

Write the contract as one shared function over a `WorkspacePort`, the way
`packages/keel/src/db/rls-proofs.ts` is one proof set run by both the pglite suite and
`pnpm test:contract`. Put it at `packages/keel/src/ports/workspace-contract.ts` (cited by both suites),
and cover: create then `status` (phase advances to `running`); `ensure` twice is idempotent and leaves
parameters alone; `stop` then `ensure` resumes; a missing workspace is `gone`; an email-bound-to-another-
username throws the typed conflict; `mintAccess` returns a token whose `expiresAt` honours the lifetime.

- **Fake half** — a colocated unit test in `packages/keel/src/adapters/fake/`, in the `keel` vitest
  project (`vitest.config.ts`), no credentials, runs in `pnpm verify`.
- **Real half** — a test beside the existing contract suite in `apps/showcase/tests/contract/`, run by
  `pnpm test:contract`, which `pnpm verify` does not run. Skip it unless the config is present
  (`describe.skipIf(!process.env.<backend URL>)`) so CI stays green without credentials, and have it
  create and delete its own uniquely-named throwaway owner and clean up even on failure.
- A transport-level unit test of the real adapter with an injected `fetch` stub is cheap and worth having:
  it pins the request shapes in §4 and the 404/410/400 mapping without a backend.

## 8. Cutover rows

Add to `docs/cutover-checklist.md`, copying the existing rows' format; the `workspace-backend` comment in
`apps/showcase/config/params.ts` points here:

| Status | Item                | What it is                                                                                          | What unlocks it                                 | Deferred verification                                                                                                                                                                                    |
| ------ | ------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⬜     | `workspace-backend` | Coder deployment URL, admin token (name in `apps/showcase/config/params.ts`), template name/version | you provision a Coder deployment and a template | A real `ensure` → `running` with the readiness gates observed; `mintAccess` token accepted for its owner's workspace and rejected after expiry; the shared contract suite green against the real adapter |
| ⬜     | `workspace-erasure` | Account deletion removes the owner and every workspace they own (only if you built that operation)  | the row above, plus a throwaway owner to delete | Delete sequence run live: workspaces deleted and awaited before the user; 410 vs 404 observed on a finished delete; the user delete succeeds on the first try, not by retry                              |

Secret values never enter the repo — only the secret-store entry name does, as with `mailgun.apiKeyName`.
Until both rows close, the real adapter is authored but unverified and should carry the
`AUTHORED — CUTOVER` header comment like every other real adapter.
