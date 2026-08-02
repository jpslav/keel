# The "person's desktop" organization

**Priority:** P3 · **Status:** deliberately blocked — needs a per-person channel to exist first

Per-person world state today: inbox (mail) + continuity (last path, active team, mail-seen — the state
is `lastPath` / `activeOrgSlug` / `mailSeenAt` in `packages/keel/src/adapters/fake/simulator.ts`; it is
the ORG that is remembered per person, not the tenant). Global: events, errors, snapshots.

When a second genuinely per-person channel lands, consider reorganizing: People row → drill into that
person's desktop (their inbox, their thread, where they are), with the global tabs beside it.

**Do not reorganize before a second per-person channel exists** — today's flat tabs are fine. The first
candidate to land, the fake SMS channel, did NOT trigger this: its Messages tab is a global flat
catch-store, not a per-recipient inbox, and in-app notifications are product-side rather than a Simulator
surface. Still waiting on a genuinely per-person channel.
