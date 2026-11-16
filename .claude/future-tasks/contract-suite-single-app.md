# The contract suite only ever runs one app's migrations

**Priority:** P2 · **Status:** open
**Found by:** `apps/starter`, 2026-07-31. Recorded in ADR-0012's Consequences.

`pnpm test:contract` — the anti-drift run that proves the RLS proofs hold on real Postgres, not just
pglite — covers `apps/showcase` only.

Two apps share framework migrations 0001–0999 but diverge from 1001, so running the second app's
`migrateToLatest` over the first app's database makes Kysely report corrupted migrations. A second
contract run needs a **second database**, not just a second alias set.

**Why it matters:** the contract suite is the repo's proof that the fakes have not drifted from the real
engine. An app whose migrations never meet real Postgres has that proof only on pglite — and per-app
migrations are exactly where an adopter's own tables live, so the untested half is the half they write.

**Approach:** parameterize `vitest.contract.config.ts` over apps with a distinct database name per app
(the local runner uses embedded-postgres, CI a service container — both can host two databases). Then
fan out like the other per-app scripts.

**Update 2026-10-03:** half of this pattern now exists. keel's fixture seam has a second project in
`vitest.contract.config.ts` and its own database (`packages/keel/src/adapters/real/db.contract.test.ts`
creates `keel_contract` on the same server, embedded or CI's). A second APP would follow the same
shape: add a project with that app's aliases, and give its harness a database name of its own. The two
harnesses still duplicate the embedded-postgres boilerplate. If a third arrives, extract the shared
part first.
