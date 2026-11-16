# Real db adapter turns a bare date column into a timezone bug

**Priority:** P1 · **Status:** RESOLVED 2026-10-03

`pg`'s default type parser for a bare `date`-typed column (no time, no zone — a wire value like
`2026-10-03`) constructs a JS `Date` at LOCAL midnight. Any app code that reads that value assuming it
represents a date, not a timestamp, silently gets the wrong calendar day the moment the server runs
east of UTC: local midnight on the 3rd, interpreted back as UTC, is still the 2nd.

**Need:** the real db adapter should register `pg.types.setTypeParser` for the `date` OID (1082)
once, globally, before any connection pool is created, and hand back the raw wire string instead of
constructing a `Date` at all — there is no timezone-safe `Date` to build from a value that was never
a timestamp in the first place. Anything downstream that wants a calendar date should receive and
compare the string, never a constructed `Date` object.

Evidence: `packages/keel/src/adapters/real/db.ts` (today's pool/client construction, where the parser
registration would go — no `date`-OID override exists yet, so every `date` column currently comes
back through `pg`'s own local-midnight default).

## Resolution

Both adapters now hand back a `date` as the wire string, and `date[]` as `string[]`. The real adapter
does this with a `types` override on its own `Pool` (`packages/keel/src/adapters/real/db.ts`) rather
than a process-global `setTypeParser`. The fake does it through `PGliteOptions.parsers` in
`openPglite` (`packages/keel/src/adapters/fake/pglite-dialect.ts`). pglite's default had been wrong in
a different direction, giving UTC midnight, so before this fix the two engines disagreed on the same
row.

Proof: the fixture's `dockets.due_on` (`1002_dockets_due_on`) is read back in the fixture's half of the
composed proof suite. That suite runs on pglite and, through a new `keel` contract project with its own
`keel_contract` database, on real Postgres via `createRealDb`. Removing either adapter's override turns
its engine's run red. Under `TZ=Asia/Tokyo` the real-adapter failure is the original bug exactly:
`2026-10-02T15:00:00.000Z` for `2026-10-03`. See `docs/decision-log.md`, 2026-10-03, and ADR-0012's
addendum of the same date.
