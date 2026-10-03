# The starter has no wiring for capabilities keel ships screens for

**Priority:** P2 · **Status:** open — a design question to settle before any code
**Found by:** the demo-presets documentation pass, 2026-10-03.

## What is true (re-measured against the tree)

After `pnpm init-app <slug> --eject-showcase` the adopter keeps `apps/starter`, renamed. It is the minimum
an adopter keeps and the framework's falsifier, and its route tree shows it: the sign-in picker, the
protected dashboard, `api/auth/{dev-signin,org,signout}` and one entity's route. It has none of the wiring
the showcase uses to reach capabilities keel ships screens for:

| Capability          | keel ships                                              | Wiring that exists only in `apps/showcase`                                                                                            |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Inviting someone    | `OrgScreen`, `sendOrgInvite` (`keel/server-lib/invite`) | `apps/showcase/src/app/[locale]/(protected)/org/` and `apps/showcase/src/app/api/org/invite/route.ts`                                 |
| Accepting an invite | the accept-invite screen                                | `apps/showcase/src/app/[locale]/accept-invite/` and `apps/showcase/src/app/api/auth/accept-invite/route.ts`                           |
| The Simulator panel | the panel, every tab, the replay code                   | `apps/showcase/src/app/[locale]/simulator-glue.tsx` (about 800 lines) and 32 route files under `apps/showcase/src/app/api/simulator/` |

So **the Simulator is not reachable from the starter's own `pnpm dev`**: the glue the layout dynamic-imports
in simulated mode exists only in the showcase (`apps/showcase/src/app/[locale]/layout.tsx`). Presets, tours
and every Snapshots feature are therefore reachable in the starter only through its static demo
(`apps/starter/src/demo-static/app.tsx`), where the panel is the package's and needs no server. The
registration seam is there (`apps/starter/src/app-config/presets.ts` and `tours.ts` register nothing today),
and a server host for it is not.

The consequence lands on the adopter the day after ejecting. A preset or tour written with `/new-preset` or
`/new-tour` is watchable only in the static demo; `pnpm dev` has no panel to load it from, and no org screen
or accept route for an `invite` step to lead into.

## The question to decide

Should the starter carry **thin, adopter-owned wiring** for the capabilities keel ships screens for — the
invite and accept routes, the Simulator glue and its routes — with keel's helpers (`sendOrgInvite`, the
screens) as optional functions that wiring calls?

For: it follows the principle the repo already states for the seam — provide a starting point, keep it in
the adopter's hands — and it closes the gap above. It would also make the starter a real second consumer of
the invite and Simulator code, where today only the showcase exercises them.

Against, and these are the reasons this is a question rather than a task:

- **It raises the minimum.** The starter is "the minimum an adopter keeps", and its empty registrations are
  the off switch for a capability. Route files are not registrations: nothing turns a wired invite route
  off by registering nothing, so an adopter who does not want invitations must delete files.
- **ADR-0013.** Upstream improvements reach a fork by `git merge`, and `apps/<yours>/**` merges clean
  precisely because upstream never touches it. The corollary is that a fix to starter wiring never reaches an
  adopter who renamed it: the improvement lands as a delete/modify conflict they resolve as "keep deleted".
  Logic that must keep improving belongs behind keel's functions and screens, which DO flow through the merge,
  and the wiring has to stay too thin to need fixing.
- **It adds glue duplication.** Every file here would be another showcase-and-starter clone pair
  (`route-glue-duplication.md`), and that file's trigger — promote glue into keel as re-exportable handlers —
  pulls the opposite way from "adopter-owned": a one-line re-export is merge-friendly and not the adopter's
  code. These two tasks are one decision.
- **Bytes.** Anything the starter's static demo gains is paid against a budget with little room
  (`demo-size-budget-headroom-thin.md`).

## Options, roughly

1. **Wire it into the starter.** Simplest for the adopter, largest minimum, most duplication.
2. **Keep the starter minimal and ship a scaffold command** (an `/add-simulator`, `/add-invitations`, in the
   style of `.claude/commands/new-tour.md`) that writes the wiring into the adopter's app on request. The
   minimum stays small and the wiring is still theirs, but an agent command is not a gate, and CI cannot
   prove the wiring still compiles unless an adoption-probe leg runs it.
3. **Promote the wiring into keel as re-exportable route handlers**, so the adopter's route file is one line.
   Closest to `route-glue-duplication.md`, merge-friendly, and the least "in the adopter's hands".

Whichever is chosen, the adoption probe in `.github/workflows/checks.yml` is what makes it a gate: eject,
add the capability, `pnpm verify`.

## Related open tasks

- `route-glue-duplication.md` — the same decision from the other side; read first.
- `self-service-auth-mfa-and-invitations.md` — widens the accept-invite flow into three; whatever the
  starter wires now is what that work has to keep working, so settle ownership of the accept route first.
- `init-app-blank-option.md` — decides what "the minimum an adopter keeps" is, and a starter that carries
  more wiring has more for `--blank` to sweep.
- `demo-size-budget-headroom-thin.md` — the byte cost of anything added to the static demo.
