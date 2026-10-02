# `init-app` has no option that removes the starter's own content

**Priority:** P2 · **Status:** open
**Found by:** an adopter's report, 2026-10-02. Their product's static demo opened on the starter's
tenants and its Items card four days after adoption. The doc half is fixed (`docs/adopting.md`, "The
starter's content is still wired into your UI", and the matching section `scripts/init-app.ts`
prints); this is the half that would make the sweep a command.

## What is missing

`--eject-showcase` deletes the demo app. Nothing deletes what the app you KEEP shows: after
`pnpm init-app acme` an adopter still has the Items slice on every dashboard and the starter's
marketing line on the welcome screen, and removing them is a hand sweep over about fourteen files.

## What can and cannot go

| Content                                  | Removable? | Why                                                                                                                             |
| ---------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| The Items slice                          | yes        | every seam module it touches has an empty registration                                                                          |
| `welcome.subtitle`                       | yes        | blank it, or drop the key and the `<Text>` that renders it                                                                      |
| The welcome and dashboard screens        | no         | the signed-in redirect needs a destination; they can be emptied, not deleted                                                    |
| The seed world (tenants, orgs, 3 people) | no         | hermetic sign-in needs someone to pick, `staffOrgSlug` must name a real org, and two tenants are what make isolation observable |

So the option is `pnpm init-app <slug> --blank`, and it does NOT touch the seed. Renaming the seed
world from flags (`--tenant`, `--org`) was considered and is not worth it: a real product's world is
more than two strings, and the doc now says to replace the file.

## The Items slice, file by file

Delete:

- `apps/starter/src/components/items-card.tsx`
- `apps/starter/src/app/api/items/route.ts`
- `apps/starter/src/app-config/db/migrations/1001_items.ts`
- `apps/starter/tests/e2e/items.spec.ts`

Rewrite to the empty registration:

- `apps/starter/src/app-config/abilities.ts` — `AppSubjectType = never`, and `appAbilityRules`
  reduced to its `default: return false`
- `apps/starter/src/app-config/db/schema.ts` — an empty `AppTables`
- `apps/starter/src/app-config/db/migrations/index.ts` — `appMigrations = {}`
- `apps/starter/src/app-config/db/rls-proofs.ts` — an empty async body
- `apps/starter/src/app-config/messages.ts` — drop `'items'` from `APP_NAMESPACES`
- `apps/starter/messages/en.json` + `es.json` — drop the `items` namespace
- the dashboard route's `page.tsx` and `dashboard-glue.tsx` under `apps/starter/src/app` — no card,
  no `canCreateItem`
- `apps/starter/src/demo-static/app.tsx` — no `DemoItem`, no ability check, an empty dashboard
- `apps/starter/tests/demo-static/static-shell.spec.ts` — keep the sign-in and Simulator assertions,
  drop the item ones

## Three things that make this more than a deletion script

1. **Zero tables and zero subjects is unproven.** The starter and `packages/keel/test-fixture` each
   register one of both, and the "empty" column in the adopting guide's seam table says "(starter
   registers one)" for exactly those two rows. `AppSubjectType = never` and an empty `AppTables` may
   well compile — and an empty interface will trip `@typescript-eslint/no-empty-object-type` the way
   `AppSubjectFields` already does (see `empty-registration-friction.md`). Find out before designing
   around it.
2. **It needs its own adoption-probe leg.** `.github/workflows/checks.yml` runs
   `init-app acme --eject-showcase --yes` and then `pnpm verify`. `--blank` needs the same treatment,
   and the gate must be seen to fail first: leave one Items reference behind, watch the leg go red.
   With zero app tables, `pnpm test:contract` runs only the framework half; say so rather than letting
   it look like coverage.
3. **It deletes the worked RLS example.** `1001_items.ts` is what `/new-slice`, `/new-entity`,
   `CLAUDE.md` and the adopting guide cite as the pattern a new tenant table copies. A blank app has
   nothing to copy from once the showcase is ejected too. Either the reference moves into a recipe
   under `docs/recipes/`, or `--blank` leaves the migration behind as an unregistered template, or the
   scaffolds learn to cite `packages/keel/test-fixture`. Decide this first; it changes the other two.

## How to write the edits

Scripted surgery on TypeScript source is the fragile part. Two ways to avoid regex-editing code:

- **Whole-file replacement from a checked-in blank variant.** Robust at run time, but the variants are
  a third app in disguise: they must typecheck and lint against keel or they rot.
- **A `/strip-starter` agent command** in `.claude/commands/` that walks the list above and ends on
  `pnpm verify`. Cheap, and consistent with how the scaffolds already work, but an agent recipe is not
  a gate and CI cannot run it.

The first is the one a CI leg can prove. Start there unless point 1 turns up a reason not to.

## What was decided against

A value-scanning "starter residue" check, and a seed-contract flag for people who exist but are not
offered at sign-in. Both are recorded in `docs/decision-log.md` under 2026-10-02.
