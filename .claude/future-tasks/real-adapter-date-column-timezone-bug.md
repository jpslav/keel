# Real db adapter turns a bare date column into a timezone bug

**Priority:** P1 · **Status:** open

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
