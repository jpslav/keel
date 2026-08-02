# Simulator artifacts inspection

**Priority:** P3 · **Status:** open, low value today

A Simulator tab (or a People/world widget) listing every uploaded artifact across orgs — the "artifacts
visible/inspectable like Mail" idea from the round-1 coverage sweep.

**Why it isn't built:** the product's own Attachments card
(`apps/showcase/src/components/attachments-card.tsx`) already IS the demo, and the rows already round-trip
through Snapshots snapshots (`saveSnapshot` copies the pglite and storage directories wholesale, so an artifact
survives save/restore like any other row). There was no observability gap to close, just a missing
cross-org browse view.

Build this if a demo ever needs to show "everything uploaded across every team" at a glance rather than one
team's dashboard at a time.
