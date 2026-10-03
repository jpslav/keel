# keysetPage should support ordering by an alternate column

**Priority:** P2 · **Status:** open

`keysetPage` (`packages/keel/src/db/keyset.ts`) always orders by `created_at`. Every caller inherits
that ordering with no way to ask for a different one — but "newest first" is not every list's natural
order; a product might want a list ordered by when a row was last touched, or by any other
not-null, orderable column the table actually has.

**Need:** an optional, trailing parameter naming the column to order by, typed to the paging table's
own not-null columns so a caller can't name a nullable or non-existent one. The parameter has to
drive the row-value comparison, the cursor's own rendering, AND the `ORDER BY` consistently — using
all three for the SAME column is what keeps the cursor correct; omitting the parameter should
reproduce exactly today's `created_at`-only behavior so no existing caller's ordering changes.
One constraint worth keeping explicit: each caller still owns one fixed ordering per route (the
cursor itself doesn't name a column), so a route that wants to let its OWN caller choose between
orderings needs to pick a column once at the route level, not thread a column choice through a
client-supplied cursor.

Evidence: `packages/keel/src/db/keyset.ts` (`keysetPage`'s current signature, `created_at`-only).
