# Recipe: a list/table kit (Mantine + TanStack Table)

`docs/app-coverage-gaps.md` ranks a "generic list/table kit (paginate/sort/filter/bulk)" as the
**single most-demanded missing capability in the whole round-2 sweep — 16 of 19 app types need it as
core**. This is the written-down plan for building one. Per the recipe doctrine
(`docs/development-approach.md`), the plan is the deliverable: nothing here is built, and an instance
that needs a data grid builds it from this page.

One piece is **not** in this recipe, because the framework already ships it: **paginated reads of a
tenant-scoped table**, `keel/db/keyset` + `keel/core/keyset`. §1 says why that one piece is
framework-owned and the rest is not; §2 onward is the plan.

## 1. Why the table is a recipe and the pagination is not

The instinct on reading "16/19 need this" is to ship a `<DataTable>` in keel. That would be a mistake,
and the reasoning generalises past this one component.

keel already ships around thirty-four screens, so "the framework doesn't do UI" is plainly not the
rule. But look at what every one of those screens IS: the presentation half of a capability keel owns.
There is no auth capability without a sign-in screen; no invitations without an accept flow; no access
gates without the interstitial that resolves them; no simulated world without Simulator. The screen and
the capability are one thing, and the screen is where the framework's invariant becomes visible to a
person.

A sortable table is categorically different. It is generic presentation with **no capability behind
it** — there is no "table subsystem" in keel whose rules the component enforces. Shipping one would put
the framework into competition with its own component library, and
**[ADR-0005](../adr/0005-ui-mantine-panda.md) chose Mantine as "the only component library"**, lint-
enforced, precisely so that a second source of components never appears. A keel `<DataTable>` would be
that second source, with the added cost that every instance's design system would have to be negotiated
with it forever.

So the test for a component is not universality (the test that governs vendor code): it is **does this
component encode a framework invariant, or is it generic presentation?** That test is recorded as
doctrine in `docs/development-approach.md`, "What the template ships".

By that test, one part of a list genuinely does encode an invariant: **a paginated read of a
tenant-scoped table**. A cursor is client input; the read must stay inside the tenant and the team on
page seven exactly as on page one; the ordering must be total or the walk repeats and drops rows; the
page size must be capped by the server rather than by the query string. That is a correctness property
in the same family as `withTenant`, not a matter of taste — so it is framework code
(`packages/keel/src/db/keyset.ts`), proven in both RLS proof suites, and demonstrated on the showcase's
ticket queue.

Everything below the data — columns, sorting affordances, filter chrome, selection, bulk actions,
density, empty states — is an instance's design decision. Hence: recipe.

## 2. What the framework already gives you

```ts
import { clampKeysetLimit } from 'keel/core/keyset'
import { keysetPage, parseDbKeysetCursor } from 'keel/db/keyset'
```

- `keysetPage(db, { tenantId, after, limit }, build)` — opens the `withTenant` transaction itself and
  runs your `build` callback (the table, the columns, the org filter) on **every** page, so page two
  cannot be scoped differently from page one. It adds the total order (`created_at DESC, id DESC`, or
  the same with an optional trailing `orderBy` column — see §3.1), the cursor predicate, the capped
  limit, and the next cursor.
- `parseDbKeysetCursor(raw)` — total; returns `start` / `after` / `invalid`. A route turns `invalid`
  into a 400.
- `clampKeysetLimit(raw, fallback)` — the server decides the page size; the query string may ask.
- `keysetPageInMemory(rows, position, request)` — the same cursor semantics over an array, for the
  static-demo twin or any fake.

The worked call site is three files: `apps/showcase/src/domain/db/tickets.ts` (`listTickets`),
`apps/showcase/src/app/api/tickets/route.ts` (the route's cursor/limit handling), and
`apps/showcase/src/app-config/db/migrations/1004_tickets_keyset_index.ts` (the index a paged table
wants). Copy that shape; do not re-derive it.

## 3. The kit, if you build it

### 3.1 Data layer — nothing new

Each list is a `list*` function in the app's own `apps/showcase/src/domain/db` (an adopter's equivalent
directory) shaped like `listTickets`: a `keysetPage` call whose
`build` callback carries the table's own scope. Sorting and filtering go **inside that callback**, which
matters for a reason worth stating: they must be part of the same query the cursor narrows, or the walk
becomes incoherent (a filter applied after the page is read silently produces short pages, and a sort
applied after it produces a list whose order does not match the cursor's).

**Sorting on a column other than `created_at` is the one real extension, and the pager has half of it.**
`keysetPage`'s optional trailing `orderBy` argument swaps `created_at` for another NOT NULL
`timestamptz` column of the paged table, in the comparison, the cursor and the `ORDER BY` together
(still with the primary-key tiebreak, still rendered by Postgres via `to_char`). Its type
(`KeysetOrderColumn`) refuses nullable and non-existent columns. Two things are still yours. First, the
ordering is **fixed per route, never client-chosen**: the cursor names no column, so a cursor minted
under one ordering is indistinguishable from one minted under another and a client-supplied sort key
would silently skip or repeat rows. A list that offers several orderings makes the choice at the route
level (separate routes, or separate server functions each passing its own `orderBy`). Second, a
non-timestamp key (a name, a number, a nullable column) is not covered: that needs its own index, its
own tiebreak and its own cursor rendering, a decision per table. Generalise the pager to a
`{ column, direction }` pair when you need it, and **allow-list** the sortable columns per list rather
than accepting a column name from the query string. A sort key from the client that reaches SQL
unvalidated is the injection hole this design otherwise does not have.

**Filtering** is ordinary `where` clauses in the callback, built from validated query parameters.
Free-text search is a separate capability, still on the recipe list (`docs/app-coverage-gaps.md`:
Postgres `tsvector`) — do not smuggle it in as a filter.

### 3.2 Component layer — Mantine plus a headless table

Use **TanStack Table** (`@tanstack/react-table`) as the headless engine and Mantine for every rendered
element. This combination is the point: TanStack owns column definitions, sorting state, row selection
and grouping, and renders nothing; Mantine's `Table`, `Checkbox`, `Menu`, `Pagination` and `Skeleton`
render all of it. No second component library appears, so ADR-0005 holds, and the accessible semantics
come from the kit the rest of the app already uses.

```tsx
// apps/<app>/src/components/data-table.tsx — an APP component, not a keel one.
export function DataTable<T>({ columns, rows, hasMore, onLoadMore, selection }: DataTableProps<T>) {
    const table = useReactTable({ columns, data: rows, getCoreRowModel: getCoreRowModel() })
    return (/* Mantine <Table> driven by table.getHeaderGroups() / table.getRowModel() */)
}
```

Rules that keep it in the house grain:

- **Router-agnostic and fetch-free**, like every other screen: it takes rows and callbacks, never a
  cursor and never a `fetch`. The glue owns fetching (`dashboard-glue.tsx` is the worked example); the
  card owns rendering. This is what lets the same component run in the `file://` static demo.
- **Every string through next-intl.** Column headers are app copy, in `apps/<app>/messages/*.json`.
- **A static-demo twin in the same change**, driven by `keysetPageInMemory`. A grid that only works
  against a server is a parity gap, not a physics one.

### 3.3 Load-more, or numbered pages?

The showcase uses **load-more (append)**, which is what a cursor gives you naturally and what a queue
wants. Numbered pages are a genuinely different product: keyset has no notion of "page 7" without
walking to it, so if an instance needs page numbers it needs either a bounded offset path (accepting the
instability, for small admin tables only) or a stored page-boundary map. Decide that per list; do not
retrofit page numbers onto the cursor by counting.

`Mantine`'s `Pagination` component still earns its place for the load-more variant: use it for
"showing N of many" affordances, not as the cursor's controller.

### 3.4 Bulk actions

Selection state belongs to TanStack Table; the ACTION belongs to a route, and that route is a mutation
like any other:

- Every bulk endpoint calls `authorize(...)` per item, not once for the batch — the build-time scan
  (`packages/keel/src/authz/authorized-mutations.test.ts`) enforces the call, but only per-item
  authorization is actually correct when a selection spans rows with different owners.
- A bulk action over a paged list must operate on **explicitly selected ids**, never on "everything
  matching the current filter" evaluated server-side, unless you are prepared to re-derive the filter
  server-side and audit it. "Select all" across pages is a different feature with a different failure
  mode; say which one you built.
- Audit each item (`recordAuditEvent`), because an audit row per action is what makes the log usable.

## 4. What this recipe deliberately does not do

- **No `<DataTable>` in keel** — §1. If a second app on this template builds one and the two converge on the
  same component, that is evidence to revisit; one app's grid is not.
- **No column-config persistence, no saved views, no CSV import UI.** Each is its own capability with
  its own storage; the CSV import/export UI is separately on the deferred-UI list.
- **No virtualisation.** Reach for it when a real list is long enough to need it, and then it is a
  component-level change with no data-layer consequence — which is one more argument for keeping the
  data layer and the grid apart.

## 5. Why this is a recipe, not shipped code

The two tests that govern vendor code (`docs/app-coverage-gaps.md`) are not the ones that apply here —
TanStack Table is a UI library, not an external service, so there is no port and no adapter to fence.
The applicable test is the UI one:

- **Does it encode a framework invariant?** No. A table displays whatever it is handed; there is no
  keel rule that becomes visible or enforceable by rendering rows in a grid. Contrast the sign-in
  screen, whose existence is a consequence of keel owning auth, or the gate interstitial, which is
  the resolution half of `keel/core/gates`.
- **Is it generic presentation?** Yes, completely — and ADR-0005 already named the supplier of generic
  presentation for this repo.

Fails the test → recipe. The genuinely load-bearing part — that a page-seven read is scoped exactly like
a page-one read — was extracted and shipped instead, which is the outcome the test is designed to
produce.
