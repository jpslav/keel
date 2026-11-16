# Recipe: an adapter your app owns

Your app needs a vendor that keel has no port for: a CDN's key-value store signed with SigV4A, an e-sign
provider, a domain-specific API. The port, its fake and its real adapter belong to **your app**, under
`apps/<app>/src/`. This page says how to build them. The lint fence that makes it legal lives in
`eslint.config.mjs`, and `tests/lint/app-owned-adapters.test.ts` pins it. Nothing here is built in this
repo, for the reason given in §9.

## 1. Whose port is it?

Run the vendor through the two tests that govern vendor code (`docs/development-approach.md`, "What the
template ships"):

- **It passes one of them** (every instance needs it, or it teaches an integration mechanic keel lacks),
  or **keel's own code calls it.** Then it is keel's port, under `packages/keel/src/ports/`. Build it with
  `/new-port` and send it upstream (`docs/adr/0013-upstream-updates-fork-and-merge.md`). Do not carry it
  in your fork.
- **It fails both, and only your app calls it.** Then it is yours, and this page applies.

Why not put it in `packages/keel` anyway: ADR-0013 promises that `packages/keel/**` merges cleanly
from upstream because you never edit it. A port keel would never accept upstream cannot be sent there,
so it would stay in your fork as a merge conflict on every update.

Some vendors plug into a swap point keel already owns, such as the SMS notification channel. Their own
recipes (`docs/recipes/sms-twilio.md`, `docs/recipes/web-push.md`) say where that code goes.

## 2. Layout, and what the lint enforces

```
apps/<app>/src/ports/<name>.ts           the port: a narrow interface, sized to your app
apps/<app>/src/adapters/index.ts         the registry: picks fake or real by keel's run mode
apps/<app>/src/adapters/fake/<name>.ts   the fake: offline, honest
apps/<app>/src/adapters/real/index.ts    builds the real adapters, fails fast on missing config
apps/<app>/src/adapters/real/<name>.ts   the real adapter: the only place the vendor SDK is imported
```

| Where                                                                                    | Vendor SDK import         | `process.env`                                    | Import a real adapter            |
| ---------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------ | -------------------------------- |
| `apps/<app>/src/adapters/real/`                                                          | yes, static or `import()` | yes, except `APP_MODE`, `DEMO_MODE`, `E2E_BUILD` | yes                              |
| `apps/<app>/src/adapters/index.ts` and `fake/`                                           | no                        | no                                               | yes (that is the registry's job) |
| everything else in `apps/<app>/src/`                                                     | no                        | no                                               | not statically (see §6)          |
| `packages/keel` outside `packages/keel/src/adapters/`, and `packages/keel/test-fixture/` | no                        | no, bar keel's two per-file secret readers       | —                                |

Unit tests (`*.test.ts`) may read `process.env`, as they already may everywhere in the app. The vendor
ban also covers the rest of `apps/<app>/` (`apps/<app>/config/`, `apps/<app>/tests/`, `apps/<app>/scripts/`),
minus the two carve-outs `eslint.config.mjs` names: `apps/<app>/next.config.ts` and
`apps/<app>/tests/contract/`.

The split inside `adapters/` is the point. The registry and the fake are what keep `pnpm dev` hermetic,
so they get the same bans as the rest of your app. With no `process.env`, the registry can learn the run
mode only by importing keel's `isSimulated`, and the fake has nothing to configure.

## 3. The port

Types only, sized to what the app does and never to the vendor's API (ADR-0003's rule for `auth` holds
for every port):

```ts
// apps/<app>/src/ports/edge-kv.ts (SKETCH)
export interface EdgeKvPort {
    put(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
    get(key: string): Promise<string | null>
}
```

The rest of the app codes against this interface, as keel's code codes against `keel/ports/*`.
`packages/keel/src/ports/email.ts` is a good shape to copy.

## 4. The fake

Offline and honest: it behaves like the real thing at the port surface, including the errors the app has
to handle. It may not import the vendor SDK or read `process.env`, and the lint holds it to both. Choose
where its state lives, and say which in the file header:

- **In memory, pinned on `globalThis`**, so a dev-server reload keeps it. A Simulator reset does not
  clear it and a snapshot does not capture it. That is fine for state the app can rebuild, such as a
  key-value store it republishes from its own tables.
- **In your own tables**, through `db.withTenant`. A Simulator reset and snapshots then cover it, because
  they cover the database.
- **Not under `.data/`.** keel's fakes persist there through `dataDir()`, which keel does not publish.
  Snapshots also reset and capture only the directories keel lists, so a directory of yours would survive
  a reset that the rest of the world does not.

Colocate its unit test (`apps/<app>/src/adapters/fake/<name>.test.ts`). It runs in your app's vitest
project.

## 5. The real adapter

- **The SDK goes in your app's `package.json`** (`pnpm --filter <app> add <sdk>`), never in keel's.
- **The fence has to know it is a vendor SDK.** If the package is not already matched by
  `vendorSdkPattern` in `eslint.config.mjs`, add it there. (`@aws-sdk/*` already covers
  `@aws-sdk/client-cloudfront-keyvaluestore` and its SigV4A signer, `@aws-sdk/signature-v4a`.) Otherwise the rest of your app could import it with a green lint. An
  adapter that is plain `fetch` needs no entry; `docs/recipes/workspace-coder.md` §4 is that case.
- **Configuration comes from `process.env`, read in `real/` only**, which is the channel keel's own real
  adapters use. Record each non-secret value (a store ARN, a region) in `apps/<app>/config/params.ts`
  with a `// cutover: <row>` comment. A secret gets a `*Name` field holding its name only, never its value.
  The deployment sets the environment, and the adapter reads it at runtime.
- **Fail fast, the way keel's registry does.** `real/index.ts` keeps an env-var-to-cutover-row map and
  throws keel's `CutoverPendingError` with every missing name at once:

```ts
// apps/<app>/src/adapters/real/index.ts (SKETCH)
import { CutoverPendingError } from 'keel/ports/errors'
import type { EdgeKvPort } from '@/ports/edge-kv'
import { createRealEdgeKv } from './edge-kv'

const REQUIRED_ENV: Record<string, string> = { EDGE_KV_ARN: 'edge-kv', AWS_REGION: 'cloud-accounts' }

export function createRealAppPorts(): { edgeKv: EdgeKvPort } {
    const missing = Object.keys(REQUIRED_ENV).filter((name) => !process.env[name])
    if (missing.length > 0) {
        const rows = [...new Set(missing.map((name) => REQUIRED_ENV[name]))]
        throw new CutoverPendingError(rows, `Missing env: ${missing.join(', ')}. See docs/cutover-checklist.md.`)
    }
    return { edgeKv: createRealEdgeKv(process.env.EDGE_KV_ARN as string, process.env.AWS_REGION as string) }
}
```

- **Never read the run mode here.** `APP_MODE`, `DEMO_MODE` and `E2E_BUILD` are keel's, and the lint
  refuses them in `real/` (§6 says why).
- Mark the file `AUTHORED — CUTOVER (<row>)` until someone has watched it talk to the real service, and
  add the row to `docs/cutover-checklist.md`, naming the proof rather than the task.
- `pnpm dev:real`'s preflight (`scripts/check-real-env.ts`) checks keel's variables only. Yours fail at
  the registry's first load, with the same error type and your rows named.

## 6. The registry

```ts
// apps/<app>/src/adapters/index.ts (SKETCH)
import { isSimulated } from 'keel/adapters/index'
import type { EdgeKvPort } from '@/ports/edge-kv'
import { fakeEdgeKv } from './fake/edge-kv'

const real = isSimulated ? null : (await import('./real/index')).createRealAppPorts()

export const edgeKv: EdgeKvPort = real?.edgeKv ?? fakeEdgeKv
```

Three properties come from importing keel's run mode instead of reading your own:

- **One answer to "is this simulated?"** keel treats a legacy `APP_MODE=fake` as simulated. A second
  reader of `APP_MODE` could decide otherwise and serve your real adapter in a world where everything
  else is fake.
- **keel's fail-closed guard runs.** Importing `keel/adapters/index` runs the check that refuses fake
  adapters in a production build. A registry that never imported it would skip that check.
- **The registry is server-only.** `keel/adapters/index` imports `server-only`, so your registry
  inherits it and needs no `server-only` dependency of its own.

The dynamic `import()` means the vendor SDK is never loaded in simulated mode. Everything else imports
the registry (`@/adapters`). A static import of `@/adapters/real/…` from anywhere else fails lint, because
it would load the vendor in every mode and let the caller skip the fake. Two exceptions are deliberate:

- **A real-mode-only component** (a vendor's sign-in or payment widget) is loaded with `import()` inside
  an `!isSimulated` branch, the way the sign-in page loads keel's real form
  (`apps/starter/src/app/[locale]/signin/page.tsx`).
- **The fake may be imported directly** by a simulated-only surface, such as a Simulator tab's route
  behind its `isSimulated` 404, as apps import keel's fakes today.

## 7. The static demo

The `file://` demo never runs your registry. Your static twin (`apps/<app>/src/demo-static/app.tsx`)
simulates the feature in memory, like every other slice.

If a screen the demo bundles imports the registry, `pnpm build:demo-static` still succeeds. It bundles
keel's adapter registry, pglite and your real adapter (single-file builds inline every dynamic import),
along with `server-only`'s throw. What fails is `pnpm check:demo-size`, which `pnpm verify` runs right
after the build, and then the static-demo e2e. Measured once by wiring a registry into the starter's
twin: the bundle grew to 54 MB against an 880,000-byte budget, and the starter's static e2e failed because
the shell never rendered. No lint rule catches this earlier, because the import usually arrives
transitively, through a domain module. So keep the rule screens already follow: they take data as props
and never import `@/adapters`.

## 8. Tests, cutover, verify

- Unit-test the fake. If the real adapter has a test, skip it without credentials
  (`describe.skipIf(!process.env.<var>)`) so CI stays green before cutover.
- One `docs/cutover-checklist.md` row per real adapter.
- `pnpm verify`. No knip, jscpd or tsconfig change is needed: `apps/<app>/src/**` is already in all three.

## 9. Why there is no worked example in this repo

The starter is the minimum an adopter keeps, and a port nobody calls is dead code each adopter would
have to delete. A real adapter would also need a vendor dependency added to one of keel's apps purely
for demonstration. The shape is not new: keel's own seven ports are the worked example of port, fake,
real adapter and registry (`packages/keel/src/adapters/index.ts`). What is new is the directory and its
fence, and `tests/lint/app-owned-adapters.test.ts` proves the fence.

## Limits

- The lint sees static imports and `import()`/`require()` with a literal specifier. A computed specifier,
  or `process.env` reached through an alias, is out of its reach, as for every rule in the file.
- To the fence, a vendor SDK is whatever `vendorSdkPattern` lists. A package missing from the list is
  ordinary code to it.
