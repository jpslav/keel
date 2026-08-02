# Prebaked demo snapshots

**Priority:** P2 · **Status:** open

Snapshots are directory copies of `.data/`, so canonical demo starting points are cheap to ship: a script
(`pnpm snapshots:seed`?) that builds 2–3 checked-in worlds by driving the fake adapters directly, then saving
through `saveSnapshot()`:

- `fresh` — seed baseline
- `mid-demo` — a pending invite + unread mail + a couple of tenant rows
- `multi-tenant` — both tenants busy

Demo prep becomes "restore mid-demo" instead of five minutes of clicking.

**Watch out:** snapshots embed pglite binary state, so generate them at install/demo-prep time rather than
committing `.data` bytes to git.

**Cross-reference: the consumer has landed; only the prebaked worlds are missing.** Tours shipped, and a
tour already declares the snapshot it starts from — `snapshot?: string` in
`packages/keel/src/demo-static/tour/contracts.ts`, restored before step 1. Today the only value every
host can honour is `'reset'` (the seeded world); a server host can additionally name a snapshot someone
saved by hand. So this task is no longer speculative and no longer conditional on anything else: the
socket exists, and building these worlds is what gives a tour author something worth plugging into it
other than "the seed" or a world they clicked together and hoped nobody deletes.
