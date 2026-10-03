# Simulator People rows show no organization

**Priority:** P2 · **Status:** open

The `Person` row type in `packages/keel/src/components/simulator/people-app.tsx` carries `role` and
`tenantSlug` but nothing naming an organization/team, so a row's only group-identity cue is the
tenant it shares with every other row. `docs/adr/0004-tenancy-rls.md` ("Organizations ('teams') are
an app-level filter, not a second RLS GUC") describes organizations as a first-class app-level
structure *inside* a tenant — so a derived app that is single-tenant with teams has people whose
meaningful group identity is their org(s), and the People tab shows every one of them the same
tenant slug with no way to tell who is on which team.

**Need:** the People tab, and the `Person` shape it renders, should be able to show each person's
organization(s)/team alongside their role — at minimum as an optional field an app can populate,
following the same seam pattern `tenantSlug` already uses (framework-generic, no app-config import
required to render it).

Evidence: `packages/keel/src/components/simulator/people-app.tsx` (the `Person` interface; `chipStyle`,
the role/tenant chip styling the new field would reuse), `docs/adr/0004-tenancy-rls.md` ("Organizations
('teams') are an app-level filter, not a second RLS GUC — organizations group users within one
tenant").
