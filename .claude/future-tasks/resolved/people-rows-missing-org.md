# Simulator People rows show no organization

**Priority:** P2 · **Status:** CLOSED 2026-10-03 (`feat/simulator-people-orgs-actor-keepalive`)

The `Person` row type in `packages/keel/src/components/simulator/people-app.tsx` carries `role` and
`tenantSlug` but nothing naming an organization/team, so a row's only group-identity cue is the
tenant it shares with every other row. `docs/adr/0004-tenancy-rls.md` ("Organizations ('teams') are
an app-level filter, not a second RLS GUC") describes organizations as a first-class app-level
structure _inside_ a tenant — so a derived app that is single-tenant with teams has people whose
meaningful group identity is their org(s), and the People tab shows every one of them the same
tenant slug with no way to tell who is on which team.

**This is already a live bug, not only a missing field.** Both row builders collapse a person's full
membership list down to one role before the row ever reaches `people-app.tsx`:
`role: person.memberships[0].role` (`apps/showcase/src/app/api/simulator/summary/route.ts:36`) and
`role: p.memberships[0].role` (`packages/keel/src/demo-static/world.ts:939`). A person who belongs to
more than one organization — the showcase's own seed has such people — shows only their FIRST
membership's role; every other organization they belong to, and the fact they belong to it at all,
is invisible, not merely unlabeled.

**Need:** the People tab, and the `Person` shape it renders, should be able to show each of a
person's organization(s) and their role _within_ each — at minimum as an optional field
(`orgs: { slug: string; role: string }[]`, mirroring `SeedMembership`'s own `{ orgSlug, role }` shape
in `packages/keel/src/seed/contracts.ts`) that an app can populate, rendered as one chip per
membership alongside the existing tenant chip, following the same seam pattern `tenantSlug` already
uses (framework-generic, no app-config import required to render it). Fixing the two row builders to
emit every membership, not just the first, is part of the same need — a richer `Person` shape sitting
behind row builders that still throw the extra memberships away fixes nothing.

Evidence: `packages/keel/src/components/simulator/people-app.tsx` (the `Person` interface; `chipStyle`,
the role/tenant chip styling the new field would reuse), `docs/adr/0004-tenancy-rls.md` ("Organizations
('teams') are an app-level filter, not a second RLS GUC — organizations group users within one
tenant"), `apps/showcase/src/app/api/simulator/summary/route.ts:36` and
`packages/keel/src/demo-static/world.ts:939` (both row builders truncating to `memberships[0].role`),
`packages/keel/src/seed/contracts.ts` (`SeedMembership { orgSlug, role }`, the shape a per-org `Person`
field would mirror).

## Resolution

`Person` gained an optional `orgs?: { orgSlug: string; role: string }[]` — `SeedMembership`'s own
shape, so the server row builder passes `person.memberships` straight through and the static twin does
the same; an invited row carries its one `{ orgSlug, role }`. When `orgs` is present the People row
renders one `org · role` chip per membership (catalog key `simulator.peopleOrgRole`) in place of the
lone `role` chip; `role` stays on the type so an app that never populates `orgs` renders as before.
Proven by `simulator-panel.spec.ts` ("people rows show every org membership…"): Sam Rivera now reads
`frontline · staff` and `platform · member`.

The field mirrors `SeedMembership` rather than the `{ slug, role }` sketched above for a measured
reason: in the static twin, any CALL on `p.memberships` inside `useDemoWorld` (an inline `.map`, or a
module-level helper taking it) made the React compiler's `react-hooks/purity` rule flag an unrelated
`Date.now()` in `startJob`, ~400 lines away. Passing the array through untouched does not.
