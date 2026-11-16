---
description: Add a demo preset (a named starting world every host can load) registered through the app-config seam
---

Add a demo preset for: $ARGUMENTS

A demo preset is a named starting world: the seed plus a script of operations. Every host replays it its
own way — the server through the same code the product runs (`packages/keel/src/server-lib/demo-presets.ts`),
the single-file `file://` demo through its in-memory twin (`packages/keel/src/demo-static/world.ts`) — so it
loads from **Simulator → Snapshots → Start from a preset** on `pnpm dev` and in `dist-demo/index.html`, and a
tour can start from it. The contract and every operation kind's rules are in
`packages/keel/src/core/presets.ts`; the worked examples are `apps/showcase/src/app-config/presets/`.

1. **Register.** One file per preset, `apps/showcase/src/app-config/presets/<id>.ts`, exporting a `DemoPreset`
   (`keel/core/presets`); import it into `presets` in `apps/showcase/src/app-config/presets.ts`. The array's
   order is the order the Snapshots tab lists them, and a base may sit anywhere in it. The registration is PURE
   TypeScript — the static demo bundles it — so it imports nothing server-only. A script fragment you want to
   reuse by hand rather than through `extends` is a plain `PresetOperation[]` constant (the showcase's
   `presets/morning-tickets.ts` is one, used by `mid-demo`).
    - **`id`** is a world-start name: lowercase letters, digits and hyphens, starting with a letter or digit,
      40 characters at most. It is the Snapshots row's testid (`preset-load-<id>`) and the name a tour's
      `snapshot` resolves. Never `reset` (the seeded world, no script). Unique in the registry, and it cannot
      collide with a saved snapshot: resolution is `reset`, then a preset, then a saved snapshot, and saving a
      snapshot under a preset's id is refused (a 403 and an inline error in the tab), so one name never means
      two worlds.
2. **Copy.** `titleKey` and `summaryKey` are FULLY-QUALIFIED keys into the APP catalog, in the `presets`
   namespace (`presets.<id>Title`, `presets.<id>Summary`), in BOTH `apps/showcase/messages/en.json` and
   `es.json` (key-identical, unit-test enforced; the namespace must be listed in the app's
   `apps/showcase/src/app-config/messages.ts`). The summary is the row's second line: say what is different
   about this world, in one sentence. Typed content inside operations (an email's subject and body) is
   simulated DATA, not UI copy — it stays in one language, like `packages/seed`.
3. **Build on a base (optional).** `extends: '<other preset id>'` replays that preset first: single
   inheritance, and the base may itself extend another (`mid-demo` → `fresh`, `multi-tenant` → `mid-demo`).
   `operations` is optional, so a preset that differs from its base by viewpoint alone omits it. An unknown
   base or a cycle fails the gate. The base's operations come first, your own last, and an operation number in
   a gate message counts in that expanded list.
4. **Script the world.** `operations` is an ordered list of `{ op, as?, ...args }`. Every step that acts as
   someone or in a team names them explicitly — never "whoever is signed in", because nobody is yet (`flag`
   and `actor.hold` are world-wide and name no one) — and the gate holds it to
   what the product itself would allow, so a preset can only describe a world someone could have clicked
   together. keel's kinds:
    - `{ op: 'invite', by: 'person-admin', org: 'frontline', email: 'jordan.ellis@example.test', role: 'member' }`
      — `by` (a seed person who manages `org`) invites `email` as `role`: the invite, its email unread in the
      invitee's inbox, the audit row and the admins' notification. The role must be one an invite may grant
      (not `admin`), and an address can be invited once across the expanded script and must not already be
      a person.
    - `{ op: 'inbound', as: 'refund', org: 'frontline', handler: 'support', from: 'marisol.vega@example.test', subject: '…', body: '…' }`
      — an email to `<org>+<handler>@…` through the real intake and the app's registered handler. `from` must
      be a seed person; whether that person may author into the team stays the handler's call, so an email the
      handler refuses (a restricted member's, filed `unmatched`) is a legitimate thing to show.
    - `{ op: 'flag', flag: 'sla-breach-banner', enabled: true }` — a Snapshots feature flag: keel's
      (`demo-banner`, `jobs-held`) or one the app registers in `apps/showcase/src/app-config/simulator.ts`.
    - `{ op: 'actor.hold', actor: 'partner-desk', held: true }` — see step 7.
    - An app's own kind (the showcase's `ticket.assign`) is used the same way. A kind that does not exist yet
      is `/new-preset-operation`; do not rebuild it here.
5. **Name what a later step needs.** A step that creates something may say `as: 'refund'`, and a later step
   whose kind `consumes` that name takes it as an argument (`{ op: 'ticket.assign', ticket: 'refund', … }`).
   Never write an id into a preset: a real uuid on the server and the twin's id in the static world are
   different, so the script holds names and each host keeps its own name-to-id map for one replay. A name is
   bound once and may only be consumed by a LATER step; only a step that creates a row can be named (`inbound`
   when the handler handled it, an app kind that returns `{ ref }`).
6. **Pick the viewpoint.** `viewpoint: 'person-admin'` (a seed person's id) is who the browser that LOADS the
   preset sits down as once the world is ready — not state captured in the preset. The viewpoint is a
   per-browser cookie and the world is shared, so a second browser watching the same server keeps its own
   person across a load. A child overrides its base's viewpoint and otherwise inherits it. Omit it to leave
   the viewpoint where the host's reset leaves it; the server then answers the welcome page rather than the
   dashboard.
7. **Hold an actor.** `actor.hold` holds (or, with `held: false`, releases) ONE registered Simulator actor
   (`@app-config/actors`): it keeps its schedule and does nothing on its own, a manual Step still works, and
   the others keep running — which is how `multi-tenant` makes the outsourced desk go quiet while the bundle
   analyzer works. The world-wide hold is a different switch: the app's `actors-held` flag
   (`{ op: 'flag', flag: 'actors-held', enabled: true }`) holds EVERY actor, and an actor is held if either
   applies. Every load resets the world first, so a hold is exactly the expanded script's last word per actor
   and never survives into the next preset; a child can release what its base held.
8. **What the build enforces, and how to read it.** Three layers, none of which you edit for a new preset:
    - `presetProblems` (`packages/keel/src/core/presets.ts`), run by
      `packages/keel/src/server-lib/demo-presets-seam.test.ts` under EVERY app's vitest project against a world
      derived from the seed and the registries, never hand-listed. A problem reads
      `preset "<id>" operation <n> (<kind>): <sentence>`: the number is in the expanded script, base first, so
      a base's own problem repeats under every preset that extends it. It fails an unknown kind, a bad argument
      shape (one sentence per issue, naming the path), a name bound twice or consumed before it is bound, and
      an unknown viewpoint; the file's other cases fail a title or summary key missing from either catalog.
    - The same file REPLAYS every registered preset through the server path against the app's real seed and
      handlers, and asserts every invite is pending, every hold set and the viewpoint signed in. A throw here
      (`unknown preset operation`, `no earlier operation is named`, `created nothing to name`) is a half that
      cannot do what its definition allows, not a preset to loosen.
    - The static-shell spec (`apps/showcase/tests/demo-static/static-shell.spec.ts`) loops over EVERY
      registered preset, loads it from `file://`, and waits for the "Preset loaded" notice; a replay step the
      static half cannot perform settles false and the notice never comes. No unit test can see the static
      halves, which is why this loop exists.

    Fix the PRESET to fit the rule. A rule that seems wrong is the kind's `check`, in one place, never a
    per-preset exception.

9. **Start a tour from it (optional).** Set `snapshot: '<id>'` on the `TourDefinition` in
   `apps/showcase/src/app-config/tours.ts` (`invite-from-preset` is the example); it works on every host,
   where a saved snapshot's name does not (`apps/showcase/src/app-config/tours.test.ts` rejects one). The
   tour's first step should say what the preset already set up. The rest is `/new-tour`.
10. **Verify.**
    - Fast loop: `pnpm exec vitest run packages/keel/src/server-lib/demo-presets-seam.test.ts` (it runs under
      every app's project); `pnpm test:unit` adds `tours.test.ts` and the i18n parity pair.
    - Assert what the preset VISIBLY did, on both hosts: the server in the `presets:` test of
      `apps/showcase/tests/e2e/destructive/simulator-snapshots.spec.ts` (destructive: it resets the world),
      the static demo in the load test beside the loop in `static-shell.spec.ts`. Run the first with
      `pnpm --filter showcase exec playwright test --project=destructive --workers=1 --no-deps simulator-snapshots`
      and the second with `pnpm --filter showcase build:demo-static && pnpm --filter showcase e2e:demo-static`.
    - If it is a preset the demo shows, update its paragraph in `docs/runbooks/demo.md` (§8).
    - Finish with `pnpm check:demo-size` and `pnpm verify`.
