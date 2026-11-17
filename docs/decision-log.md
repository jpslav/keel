# Decision log

Decisions made during the build that the approved plan didn't anticipate, with rationale. (Planned decisions
live in `docs/adr/`; this file is the delta.)

**Reading older entries.** These are dated and append-only: an entry was true when written and is
never edited to match today's tree, so a later entry supersedes an earlier one rather than replacing
it. Two vocabulary changes affect entries written before 2026-07-31 — the dev/demo panel was called
**Backstage** before it became the **Simulator**, and `isFakeMode` became `isSimulated`. Paths in old
entries may name files that have since moved; the doctrine docs under `docs/` are what the path gate
holds to today's tree.

- **`allowBuilds` instead of `onlyBuiltDependencies`** — the plan named pnpm's older setting; pnpm 11
  wants the `allowBuilds` map in `pnpm-workspace.yaml`.
- **Adopted `minimumReleaseAge: 2880`** — not in the plan, but a cheap supply-chain guard: only install
  package versions published at least two days ago.
- **CI can run real-Postgres contract tests without testcontainers** — GitHub-hosted runners have docker, so a
  plain `services: postgres` container job can run the same contract suite that runs on embedded-postgres
  locally. Simpler than testcontainers; planned for the Phase 4/5 workflow.
- **Hand-rolled pglite Kysely dialect instead of `kysely-pglite`** — the plan said to prefer the maintained
  library, but the package is unmaintained (2024) and crashes against kysely 0.29's export layout. A ~90-line
  dialect built from kysely's own exported Postgres pieces is smaller than a version-pin workaround and is
  what gets promoted into the app db adapter.
- **RLS policies use `NULLIF(current_setting(...), '')`** — spike discovered the GUC empty-string quirk (see
  build notes); the plan's policy SQL specified the two-arg form only. Both ADR-0004's policy template and
  the spike migration carry the hardened form.
- **The static demo is always single-file** — the plan had "single-file inlined variant" as a stretch goal,
  but Chrome blocks external `type="module"` scripts on `file://`, so inlining is the only way the shell
  runs from disk at all. Stretch goal became the baseline.
- **react-email templates are previewed in Ladle**, not react-email's own preview server — one component
  workshop instead of two tools.
- **No react-router for the static shell** — four routes need ~15 lines of hashchange glue; a router
  dependency would be weight without benefit. Revisit if the shell grows real navigation.
- **No GitHub Actions deploy workflow** — the plan said "staging-deploy workflows authored, unrun", but
  the deploy pipeline is the piece most tied to an organisation's accounts and approval gates, so GH
  Actions runs checks only. Authoring a GHA deploy would guess at that for no benefit. CD is cutover row
  `deploy-pipeline`.
- **Lambda runtime pinned to `nodejs22.x` in the draft stack** — aws-cdk-lib's enum is authoritative at
  deploy time; bump to nodejs24 at cutover if the installed CDK exposes it (the app itself targets
  Node 24).
- **`src/adapters/real/migrate-handler.ts`** — the migrator Lambda entry lives in adapters (it imports
  AWS SDKs), enforced by the same boundary lint as everything else.
- **Analytics event log is append-only JSONL, not file-per-item** — the dev-tools work mirrors the email
  catch store, but events are high-volume and small, so the fake writes `.data/analytics/events.jsonl`
  (one JSON object per line) instead of one file per event as `fakeEmail` does.
- **Feature-flag toggle folded into `/dev/events`, not a separate `/dev/flags`** — `isFlagEnabled` is an
  analytics-port method and the flag file sits under `.data/analytics/`, so one page (event log + flag
  toggle) tells the whole analytics-port story rather than adding a fourth dev route for a single toggle.
- **Page views captured via a client beacon mounted in the protected layout, not server-side in it** —
  the layout is an RSC that doesn't re-run on client navigation and can't see the pathname, so a
  `usePathname` beacon posting to `/api/analytics/page-view` captures both the path and SPA navigations.
- **The static shell grew real navigation but stayed on the hashchange glue** — the earlier "no
  react-router for the static shell" call said to revisit if the shell grew navigation; it now has a
  header nav + dev-tools menu, and the ~15-line `go()`/`useHashRoute` glue still covers it without a
  router dependency.
- **Backstage's Mail/Events/Errors tabs are gated by mode, not role — deliberately reversing the
  earlier role gate.** The old `/dev/mailbox` + `/dev/events` + `/dev/errors` pages required
  `canManageOrg(user.role)` on top of `isFakeMode`, added specifically because a tenant-global
  mailbox on a public demo URL could otherwise expose addresses other visitors typed. Backstage
  drops that role check: `/api/dev/flags` and `/api/dev/error` move from
  `requireRole(...ORG_MANAGER_ROLES)` to `requireUser()`, and the Events/Errors panel tabs render
  for every role, proven by `tests/e2e/backstage-technical.spec.ts` signing in as `persona-member`.
  Reasoning: the persona picker already lets anyone become an admin persona in one click, so a
  role gate in fake mode was never real protection — just friction on the lowest-privilege demo
  walk the whole point of Backstage is to support. The gate that IS real stands unchanged: every
  `/api/backstage/*` route and both `/api/dev/*` routes still 404 outside fake mode, first line,
  so production never serves any of this.
- **Backstage naming: the app is the stage, the panel is backstage.** The collapsible right-docked
  panel that hosts Cast/Mail/Events/Errors (and Scenes, a later slice) is deliberately framed as a
  theater metaphor: `Cast` is who you can become, `Mail` is what they've received, `Scenes` will
  reset/snapshot the whole set. The metaphor motivates the mode-not-role gating above — a
  stagehand walking backstage doesn't need the actor's own credentials to check the props table.
- **`handleOpenMailLink`'s same-origin check now also accepts absolute URLs, not just relative
  paths.** The invite email's accept link changed in slice 3 from the slice-2 placeholder relative
  link to a real fully-qualified URL (built via `new URL(...).toString()` in
  `src/app/api/org/invite/route.ts`, since real invite emails must carry an absolute link — the
  recipient reads them from an arbitrary mail client, not this app). The old
  `href.startsWith('/')` check silently no-op'd on that absolute URL instead of rejecting it
  loudly; `tests/e2e/accept-invite.spec.ts` caught this as a stuck navigation, not code
  inspection. `src/app/[locale]/backstage-glue.tsx`'s `handleOpenMailLink` now also allows
  `new URL(href).origin === window.location.origin`, so the design invariant (same-origin only)
  still holds while covering both link shapes.
- **Scenes (reset/save/restore) operate on `.data/` as plain directory copies, not an
  application-level export/import format.** Every fake adapter already treats `.data/` as the
  simulated world's actual state — auth (session secret, invites, dynamic-persona overlay,
  profile overrides), emails, analytics, pglite, storage, and Backstage's own continuity file — so
  a named snapshot is just `cpSync` of those directories into `.data/scenes/<name>/`, and restoring
  is the same copy in reverse; no serialization format needed beyond the files that already exist.
  `pglite` is copied as-is (the on-disk database files), which is why `closeFakeDb()` (build notes)
  runs first — nothing may be mid-write. `src/adapters/fake/backstage-admin.ts` serializes
  reset/save/restore against each other with a module-level in-flight promise chain, but an
  ordinary request (e.g. a page-view beacon) racing the copy window is an accepted dev-tool
  hazard, not something the module guards against: Scenes only exists in fake mode (404
  everywhere else), so the worst case is a demo/dev annoyance, never a production concern.
- **Gating reversal for Scenes matches the rest of Backstage: mode, not role.** `/api/backstage/reset`
  and `/api/backstage/scenes*` follow the same pattern as every other Backstage route (finding #6
  reversal, above) — 404 outside fake mode, first line, no `requireRole`/`requireUser` gate. A
  stagehand resetting the set doesn't need the actor's own credentials either.
- **Feature flags moved from the Events tab to the Scenes tab.** Flags are world _knobs_ (they change how
  the set behaves), events are _observations_ — Scenes now hosts reset, snapshots, and flags together and
  Events is purely observational. The move also fixed a latent bug: every flag switch rendered the one
  hardcoded "demo-banner" label; labels now map per-flag with a raw-key fallback, so a second flag can't
  silently borrow the first one's name.
- **`/api/dev/error` and `/api/dev/flags` relocated to `/api/backstage/error-scenario` and
  `/api/backstage/flags`, dropping their `requireUser()` gate.** They only ever served Backstage tabs, and
  the rest of the panel's routes are mode-gated with no auth at all (knobs stay reachable signed-out, like
  reset). "The Backstage surface is `/api/backstage/*`" is now a complete sentence, with one uniform
  containment rule: 404 outside fake mode, first line.
- **Backstage feedback stays inside Backstage — no app-level toasts.** Transient confirmations (new mail
  caught, link copied, world reset, scene saved/deleted) render as a notice strip inside the panel; when
  the panel is collapsed, the pill's unread badge pulses instead. Deliberately NOT Mantine notifications in
  the app's own real estate: the product may grow its own toasts later, and dev chrome must never collide
  with (or be mistaken for) product UI. For the same reason the org screen's "invite sent" copy no longer
  mentions Backstage — product copy ships in real mode too, where the panel doesn't exist.
- **The mail reading pane's iframe is `sandbox="allow-scripts"` with a postMessage click bridge.** The
  earlier `sandbox=""` killed clicks inside the email silently — the #1 demo'er trap this review found. A
  tiny script appended to the `srcDoc` intercepts anchor clicks and postMessages the href to the parent,
  which routes it through the SAME `onOpenLink` policy as the extracted link rows. The frame stays an
  opaque origin with no `allow-top-navigation`, so the email still can't navigate anything itself — it can
  only ask. Links the policy refuses now produce a notice instead of a silent nothing.
- **Sign-out keeps the Backstage viewpoint cookie.** Intended semantics: signing out ends the session, not
  "whose world you're watching" — the panel keeps following the last person, which is exactly what a
  demo'er stepping through someone's story wants. Documented here so it reads as a decision, not a leak.
- **Real builds ship zero Backstage client code via a fake-mode-only dynamic import.** The locale layout's
  `BackstageChrome` mirrors the existing `AuthProviders` pattern (which dynamic-imports Clerk only in real
  mode). The `/api/backstage/*` handlers still compile into the server artifact — runtime 404 gating plus
  the fail-closed adapter guard is the containment there; a second build flavor to strip the files was
  judged complexity without payoff (one-artifact philosophy, ADR-0001).
- **Invites are validated and deduplicated server-side (409).** The API now enforces the same email-shape
  check as the form and rejects addresses that are already members or already invited — duplicate Cast rows
  sharing one inbox confused demos. Consequence for tests: inviting an existing member's address is no
  longer a way to land mail in a seeded inbox; `backstage-mail.spec.ts` now follows an invited person
  instead.
- **Invite emails are localized with the inviter's locale.** The invitee has no account (and no locale)
  yet, so the inviter's is the best signal. Copy lives in a new `email` namespace in `messages/*`; react-
  email templates receive pre-localized strings as props (they render outside a request context, so they
  never call next-intl themselves).
- **The static twin does NOT render the real `InviteEmail` template — tried and reverted.**
  `@react-email/render` (react-dom/server) added ~560 kB to the single-file demo, blowing its 920 kB size
  budget — the budget wins. The twin hand-builds matching markup (`buildInviteEmailHtml`) but pulls its
  STRINGS from the same `email` messages namespace as the real template, so copy can't drift even though
  markup can. Twin invite ids are `crypto.randomUUID()` (a length-based id could be reused after an accept
  shrank the list, making a stale email link accept the WRONG invite — and colliding derived persona ids).
- **Split "tenant" into tenant (ambient site) vs organization (in-tenant team).** The scaffold conflated the
  two; the product needs GitHub-style teams within one customer's site. Orgs map to Clerk Organizations
  (one Clerk instance per tenant → our slug === Clerk slug); role is per-org membership. Code/data use
  `org`; user-facing copy says "team" (messages values only), so the display word is swappable without a
  refactor. See ADR-0003 addendum. Notes stay tenant-scoped for now — org-scoping is a follow-up slice.
- **Product has no cross-tenant surface; Backstage Cast IS the tenant hop.** Tenants are ambient, so the
  header switcher is now the OrgSwitcher (within one site). Crossing sites in fake mode means becoming a
  persona whose home tenant differs — the existing Cast tab already does this (persona rows carry a tenant
  chip and re-theme on switch), so no new dev surface was added. The `tenancy.spec.ts` UI-level RLS proof
  and the auth-flows retheme test now drive Cast instead of the header switcher; the real RLS proof
  (`tests/rls/proofs.ts`) is unchanged. The fake sign-in persona picker also lists personas across tenants
  — that's fine, it's the same fake-mode-only trust class as Backstage (real mode renders Clerk's form).
- **Rejected reusing Clerk's `@clerk/ui`/`@clerk/elements`.** Internal package, live-client coupling, and
  Elements unsupported as of Core 3 — see ADR-0003 addendum. We mine Clerk's anatomy as a design reference
  and re-express it in Mantine.
- **Org-scoped notes are an app-level filter; per-org RLS is deferred.** `notes.org_id` (nullable) +
  `where org_id = :active` inside `withTenant` gives "switch teams → switch the data you see" without a
  second RLS GUC. Teams are a collaboration boundary, not a hostile one; the tenant RLS still contains
  every row and port membership checks gate the active org. Full ADR-0004 addendum. Follow-up if a team
  ever needs hard isolation: promote to a second GUC + policy + proof cases.
- **Auth avatars are white-on-dark, not hash-colored.** Mantine's `color="initials"` (and `autoContrast`,
  and the plain gray placeholder) can't clear WCAG AA 4.5:1 across hue+initials combinations; a fixed
  white-on-dark-6 avatar is ~15:1 for any initials. The open-popover a11y sweep is scoped to
  `color-contrast` because an open Mantine Menu trips `region`/`aria-required-children` (portal +
  autofocus helper) — framework quirks, not our markup. See docs/build-notes.md.
- **The locale switcher moved from the demo header into Backstage, in both hosts.** A product
  header would never carry an en/es toggle — it is a simulated-world affordance, so it belongs on the
  Backstage surface (the panel header, next to the persona chip) alongside the other set controls. The
  real app wires it to a full reload that swaps the leading `/<locale>` path segment (theme + header are
  per-request RSC output, so a soft nav wouldn't re-render them — same reasoning as profile-glue); the
  static demo wires it to its in-memory locale state. The demo header no longer renders a toggle at all.
- **A draggable seam replaced the 360/520 width presets.** The two-value SegmentedControl was a blunt
  instrument; the panel edge is now a continuous drag (clamped 300–720, and to `viewport − 360`) that is
  also a real keyboard-accessible separator (`role="separator"`, arrows step, Home/End jump, double-click
  resets to 360). Same `<slug>-backstage-width` localStorage key — legacy `520` values parse straight through
  as a number — so nobody's persisted width breaks.
- **Events dropped the shared light-box wrapper and, with Errors, the "dev only" badge.** Events now renders
  as compact dark expandable rows matching the panel's own skin instead of the light `Table` both tabs
  inherited from their `/dev` page days; Errors keeps the light box for now since it hasn't been reskinned,
  not because it needs to stay light. The "dev only" badge was cut from both — the whole panel already reads
  as "not the product" (fake-mode-only, distinct chrome), so a per-tab label was redundant copy.
- **Clear-mailbox now requires a two-step inline confirm.** It shipped as a single irreversible click; moved
  next to the scope toggle, that's one accidental tap from wiping every caught email. It now asks inline
  ("Yes, clear all mail" / "Cancel") — the same shape Scenes' reset already uses — rather than introducing a
  second confirm pattern.
- **The jobs port is the execution seam only; job rows and the status timeline are app-owned.** The
  `jobs`/`job_status_changes` tables are identical in fake and real mode (like `notes`), so they live in
  the app DB behind RLS and are written through one choke point — `src/db/jobs.ts` `recordJobStatus`,
  validated by the pure `src/core` state machine. The port is just `start(job)`. What differs by mode is
  who executes and how completion returns: the fake runs an in-process handler; the real adapter only
  kicks off CodeBuild, and terminal transitions will arrive via the inbound webhook route calling the same
  `recordJobStatus`. Slice-3 actors complete jobs through that same path — no port surface grows.
- **Held mode is a world flag (`jobs-held`), not a per-submit option.** "Jobs wait for an operator" is a
  property of the simulated world, not of a call site — a per-submit option would leak fake-only concerns
  into product routes that must ship identically in real mode. The flag rides the existing flags store
  (Scenes toggle, persistence, reload glue all come free). `runPendingJobs()` steps held jobs forward
  regardless of the flag; slice 3's vendor actor replaces the button with webhook-driven completion.
- **`job_status_changes` is append-only by privilege, not convention.** `app_user` gets only
  `GRANT SELECT, INSERT`; the RLS proof suite asserts UPDATE and DELETE fail with permission errors on
  both pglite and real Postgres. Timelines you can rewrite are timelines you can't trust.
- **The fake executes jobs inline, awaited, in the submit request.** Determinism over realism (the
  `SIMULATE_CODE_BUILD` spirit): e2e never polls a race, and the timeline still records
  queued → running → completed with real timestamps because `recordJobStatus` enforces the machine — no
  shortcut transition exists. Held mode is the realistic path when the choreography matters. Scenes
  snapshots cover jobs for free: rows live in pglite and artifacts in `.data/storage`, both already
  LIVE_DIRS.
- **Static-demo feature parity is now standing doctrine.** The file:// demo twins every feature
  in-memory and degrades only where physics forbid (see development-approach). Applied here: the demo
  dashboard gets the Export card twin and the Jobs tab honors `jobs-held` and "run pending" as real
  in-memory logic; the only degrade is the download link (no server to serve bytes).
- **`recordJobStatus` locks the row; losing a start race is a no-op, not a 500.** Branch review
  caught that the read-validate-write choke point had no row lock (safe today only because the
  pglite dialect serializes connections — a guarantee pooled Postgres won't give the inbound webhook
  path) and that a raced `running` hop threw `InvalidTransitionError` all the way to a product 500.
  Now: the status read is `FOR UPDATE`, and the fake executor treats an already-claimed job as
  benign (`runPendingJobs` counts only jobs it actually ran). Webhook redelivery inherits
  a choke point that serializes instead of double-writing.
- **CSV exports neutralize formula injection.** RFC-4180 quoting alone doesn't stop Excel/Sheets
  from evaluating a user-authored `=…`/`+…`/`-…`/`@…` cell; `csvField` now prefixes such fields
  with an apostrophe. Known limitation, handled at the one place CSV is built.
- **Service auth is a shared implementation, not a port.** `src/service-auth/` verifies per-org
  RS256 JWTs and webhook shared secrets with ONE code path in both modes; only key/secret
  _sourcing_ differs (fake mints into the same `service_keys` table; the webhook secret comes from
  `.data/auth/webhook-secret` vs `WEBHOOK_SECRET`). Signature verification is an app-owned
  algorithm over app-owned state, not an external dependency — and if fake mode verified through a
  different adapter, the actors-drive-the-real-surface proof would be circular. The auth
  port is untouched; `ServiceIdentity` is deliberately not an `AuthUser`.
- **`service_keys` is an infra table (no RLS), multiple active keys per org.** Read during request
  authentication before any tenant context exists — the organizations/tenant-lookup precedent.
  Public material only; the hostile boundary is enforced cryptographically (the signature picks
  the true org even if slugs ever collide across tenants). Rotation = add a key, switch, revoke
  (`revoked_at`, never DELETE); `app_user` is SELECT-only, proven in the RLS suite.
- **Webhook semantics: idempotent redelivery, strict service API.** Redelivering an
  already-applied terminal status returns 200 `{idempotent: true}` (vendors retry on non-2xx —
  a 409 would cause retry storms); any other illegal hop is 409 with `{from, to}`. A completion
  webhook for a still-`queued` job walks `running` first (timeline message "completion webhook") —
  the real CodeBuild path may only call home at the end, and the vendor actor completes _held_
  builds, so the walk preserves "even an instant path records the full story." The counterparty
  service API gets no such courtesy: strict per-hop, because a polling counterparty just read the
  state and a 409 is information.
- **Service token policy: RS256-only, `aud <slug>-service`, required `iat`+`exp`, max age 15m, 30s
  clock tolerance.** No jti/nonce replay store — the 15-minute age bound is the whole replay
  posture; counterparties re-mint on their poll loop. All verification failures are one opaque
  401 (no oracle for which check failed); cross-org job access reads as 404 (existence never
  confirmed across the boundary).
- **Static-demo parity is explicitly N/A for this slice.** A server-only API surface has no
  file:// analog — there is no screen to twin. The capability becomes visible (and twinned) in
  the Actors tab, where inline actor components over an in-memory driver demo the same
  poll/advance/webhook story.
- **Caller-supplied `resultKey` is prefix-locked to the caller's tenant namespace.** Branch review
  caught that a service caller completing its own job could plant `exports/<victim-tenant>/…` as
  `resultKey`, which `GET /api/jobs` would later sign verbatim — storage tenant isolation is purely
  by key convention, so that would have been a cross-tenant download. Both write paths now reject a
  `resultKey` outside `exports/<tenantId>/` (service status route: the verified identity's tenant;
  webhook route: the payload tenant, defense-in-depth on the infra-secret trust class).
- **Actors split the async world by org, not by an abstract counterparty-kind taxonomy.**
  A single org-slug constant (`src/core/actors.ts`) names the one org the service runner
  serves; the builder-console's pool is defined as everything else (any other org, or no org),
  which keeps the two actors' work pools disjoint by construction. The 409-tolerance each tick
  already needed for a lost claim race stays a robustness net rather than the thing enforcing
  disjointness.
- **`/api/backstage/actors/artifact` produces the artifact only, never a status write.** An actor
  calls it to get the export's `resultKey`, then reports the terminal status itself over the
  genuine `/api/service/*` or `/api/webhooks/*` surface, so the timeline stays authored entirely
  by those real calls. This is the counterparty's simulated compute standing in for the part a
  real counterparty compute/build service would run — it guarantees a completed job always has a real,
  downloadable artifact behind it, so neither host can produce a dead download link.
- **Credential expiry recovers on a 401, not a clock.** Neither the service runner's token driver
  nor the builder-console's secret driver tracks lifetimes; any 401 clears the cached credential,
  re-mints, and retries the failed call once within the same tick. A world reset that revokes a
  live credential mid-run is indistinguishable from a real expiry — both heal through the same
  path.
- **No postMessage bridge for the actor frames.** Unlike the mail reading pane's opaque-origin
  sandboxed iframe (rendering untrusted caught-email HTML, needing a click bridge to reach the
  parent), each actor frame is same-origin, first-party code running its own page under
  `src/app/[locale]/backstage/actors/[actor]` — its own fetch, its own cookies, no message channel
  needed. The Actors tab's world-strip counts (queued/running/completed) simply ride the same jobs
  poll the Jobs tab already drives.
- **Actor iframes carry no `sandbox` attribute — a different trust class from MailApp's, on
  purpose.** Trusted first-party code needs the real origin for `fetch`/cookies to work at all;
  `sandbox="allow-scripts"` alone produces an opaque origin and would break it. Omitting `sandbox`
  keeps the frame's privileges identical to an ordinary same-origin navigation — nothing gained,
  nothing given up beyond what a page already has.
- **Each tick performs at most one product-visible mutation.** Both `serviceTick` and
  `builderTick` poll, then make one hop (claim, complete, or deliver) and return — never a batch.
  That's what makes Step meaningful (one click, one visible state change) and keeps the activity
  log a faithful blow-by-blow instead of a batched summary.
- **The Jobs tab's "run pending jobs" button was retained, not replaced.** The note above
  ("slice 3's vendor actor replaces the button with webhook-driven completion") anticipated the
  actors making it obsolete. It stayed instead: a useful manual operator override for stepping the
  world forward without opening the Actors tab, or for the old instant-advance demo beat. The
  actors are additive, not a replacement path.
- **The static twin reaches full parity by driving the SAME `serviceTick`/`builderTick` runtime
  over in-memory drivers.** `src/demo-static/actor-drivers.ts` implements the identical
  `ServiceDriver`/`BuilderDriver` contracts the real fetch drivers do, so `actor-runtime.ts` is
  shared verbatim by both hosts — only transport differs. The only physics degrade is the download
  link: the static shell has no server to serve CSV bytes from, so a completed job's timeline
  entry there carries no `resultKey`.
- **Hand-rolled ability model instead of `@casl/ability` (authorization slice).**
  `src/core/abilities.ts` is a small `can()`/`cannot()` switch over subject type — no new
  dependency, and `src/core` stays framework-free by construction (ADR-0006) rather than by
  auditing a third-party library's zero-dep claim. The public shape is deliberately CASL-like
  (`can(action, subject)` over `{type, orgId, ownerId}` subjects), so this is a two-way door: a
  later swap to the real library is a rewrite of one file's internals, not of any caller.
- **`authorize()` is an explicit per-handler call, not route middleware; the bypass-catcher is a
  build-time source scan, not a lint rule (authorization slice).** The subject's `orgId` is
  handler-derived — resolved from `user.orgSlug` after the tenant/org lookup each route already
  does — so it isn't known before the handler body runs; a wrapper would have to re-derive it
  anyway. `authorized-mutations.test.ts` instead proves the invariant ("every mutating route calls
  `authorize(...)` or is a justified exemption") by walking every `src/app/api/**/route.ts`: a
  test, not an AST lint rule, because the check is file-level (does this whole file call authorize
  anywhere?) — same reasoning as `messages-parity.test.ts`. A build-time scan that walks the route tree is the
  pattern; the exemption map (service/webhook/backstage routes, self-service profile,
  telemetry, session lifecycle) keeps new mutations honest — a new route must call
  `authorize(...)` or add a reasoned exemption, not silently fall through.
- **Restricted members losing note/job create is a deliberate product rule, not a regression
  (authorization slice).** `restricted: boolean` already existed on `AuthUser` (auth port); this
  slice is the first place anything enforces it — `Note`/`Job` `create` (and `Note` `update`/
  `delete`) require `!restricted`, while `read` stays open. This is the auth port's documented
  "reduced feature surface" made concrete: a forced POST still 403s
  (`tests/e2e/authorization.spec.ts`), and the dashboard shows a read-only `NotesCard` (disabled
  input, hint text) in both the real app and the static twin.
- **`requireRole` stays on the auth port as the coarse primitive; `authorize()` owns fine-grained
  resource decisions (authorization slice).** Both read the same `src/core/roles.ts` predicate
  (`canManageOrg`), so there's one source of truth for "who can manage an org," reachable either
  coarsely (gate a whole route by role) or finely (gate one action on one org-scoped resource).
  `org/invite`'s POST is the one route this slice actually retrofit, off
  `requireRole(...ORG_MANAGER_ROLES)` onto `requireUser()` + `authorize('create', Membership)`;
  `ORG_MANAGER_ROLES` is now module-private in `roles.ts`, consumed only through `canManageOrg`.
- **`AbilityActor.manageAll` is wired but pinned `false` this slice (authorization slice).** The
  staff cross-org superpower has no signal to derive it from yet — the staff org itself
  comes later. `abilityActorFromUser()` always sets it false, so flipping it later (once a staff-org
  membership signal exists) grants everything without touching any per-subject rule in
  `defineAbilitiesFor`.
- **Withdrawing a cross-org request is a soft `UPDATE`, never a `DELETE` (cross-org slice).**
  `org_requests` grants `app_user` only `SELECT, INSERT, UPDATE`; withdrawal is the state
  machine's `open → cancelled` hop, so the row and its audit trail (`created_by_user_id`,
  `decided_by_user_id`, both timestamps) can never be erased by the app role — the
  `job_status_changes` append-only precedent applied to a mutable-but-undeletable row instead of
  an append-only log. Proved in `tests/rls/proofs.ts`: a raw `DELETE` fails at the privilege
  layer, but an `UPDATE` of `status` succeeds.
- **`AbilitySubject` grew named `requesterOrgId`/`responderOrgId` fields, not a generic org array
  (cross-org slice).** A two-sided subject needs to know WHICH side the actor is testing —
  `create`/`delete` care only about the requester side, `update` only about the responder side —
  so a single `orgIds: string[]` would force every rule to re-derive direction from the action.
  Named fields keep each rule a one-line equality check, and `null`/absent never matches either
  side (a request naming neither of the actor's org on the acting side denies).
- **One unambiguous `authorize()` action per route (cross-org slice).** The three org-request
  routes each call a single, distinct action — `POST /org-requests` → `create` (requester),
  `POST .../respond` → `update` (responder), `POST .../cancel` → `delete` (requester, soft) —
  rather than a generic "act on this request" the ability rule would have to disambiguate by
  payload. Matches the existing Note/Job convention (`authorize(user, orgId, action, subject)`);
  no new verb was added to `AbilityAction`.
- **A restricted manager on the responder side may still respond — `restricted` reduces
  authoring, never management authority (cross-org slice).** `OrgRequest` `update` (accept/reject)
  is gated on `canManageOrg(actor.role) && isResponder` only — deliberately NOT
  `!actor.restricted && ...` — matching the existing Membership/Org house rule that `restricted`
  narrows what a member can AUTHOR, not what a manager can decide. Pinned by a comment in
  `src/core/abilities.ts` and a dedicated test in `src/core/abilities.test.ts` so a future "tidy
  this up" pass doesn't silently add the guard.
- **`decided_by_user_id`, not `responded_by_user_id` (cross-org slice, renamed during review).**
  The column records whoever drove the terminal transition — the responder's manager on
  accept/reject, but also the REQUESTER on withdrawal — so `responded_by` was inaccurate for the
  cancel path. Renamed before merge; no migration history to reconcile since 0006 hadn't shipped
  yet.
- **`InvalidTransitionError → 409` promoted from the service-only wrapper into the shared
  `src/app/api/respond.ts#withPortErrors` (cross-org slice).** The service API
  (`src/app/api/service/respond.ts`) already mapped a rejected state-machine hop to 409
  `{error: 'invalid-transition', from, to}`; org-requests' respond/cancel routes needed the
  identical behavior for the product API, so the mapping moved up to the one wrapper every
  product route already uses. Inert for every existing route — none threw
  `InvalidTransitionError` before this slice — so this is pure addition, not a behavior change.
- **Two-step mint + confirm with a `pending → ready` status, NOT write-row-on-confirm (uploads
  slice).** The brief leaned toward INSERT-only (write the artifact row at confirm), but that
  needs a way to carry the server-built key from mint to confirm without trusting the client — a
  second signed-token mechanism on top of the upload-target signing. The pending-row shape keeps the
  storage key entirely server-side at ALL times (the mint step stores it; confirm only takes the row
  id, never a key), avoids re-deriving trusted metadata from storage, and can't create duplicate
  rows. The cost is one `status` column + an `UPDATE` grant — which the brief explicitly permits.
  `GET /api/artifacts` lists only `ready` rows, so an abandoned pending row (upload never landed) is
  harmless and never shows a dead download link. Confirm re-uses the `create` ability (finalizing
  one's own upload), so no `update` rule was added to the `Artifact` subject.
- **The storage key is built entirely server-side, never client-supplied (uploads slice).** The
  mint route composes `artifacts/<tenantId>/<uuid>/<sanitizeFilename(name)>` — the resultKey
  prefix-lock lesson applied to uploads. The browser only ever holds an opaque upload
  target (whose fields encode the key) and an artifact id; it can never steer where bytes land.
  `sanitizeFilename` (pure core) strips any directory portion as defense-in-depth, and the fake
  storage `resolveKey` rejects escapes as a final backstop.
- **The fake upload endpoint is authenticated by HMAC-signed target fields, not a session (uploads
  slice).** `POST /api/storage-upload` is the fake-mode-only twin of an S3 presigned POST (404 in
  real mode, first line). It has no user session — the target was authorized (`create Artifact`)
  when the mint route issued it, and an HMAC over `{key, content-type, max-bytes}` (keyed on a
  per-checkout `.data/storage/upload-secret`, the fake-auth dev-secret pattern) proves the fields
  weren't tampered with since. It's in the authorize-scanner exemption map with that reason — the
  same trust class as the shared webhook secret. It approximates S3's status codes: 403 for a bad
  signature or a content-type mismatch (`eq $Content-Type`), 400 for oversize (`EntityTooLarge`),
  204 on success.
- **A hand-rolled drop region, NOT `@mantine/dropzone` (uploads slice).** `ArtifactsCard` uses a
  styled `<label>` wrapping a hidden `<input type="file">` with drag-and-drop handlers — real
  drag-drop AND click-to-browse — instead of adding the `@mantine/dropzone` dependency. Reasons:
  the card is shared by the file:// static twin, so the dependency would land in the single-file
  demo bundle (the `@react-email/render` 560 kB revert is the standing precedent for guarding it);
  a bare input is what Playwright's `setInputFiles` targets cleanly; and "parity is about
  capability, not pixel-identical widgets." Zero new client weight, zero budget risk. The static
  twin uses the same component — its `onUpload` just reads name/size/type in-memory (no bytes
  stored, no download link — the physics degrade, like the jobs CSV).
- **A security-review pass hardened the uploads slice in the same branch, before merge.** Four gaps
  found on self-review, fixed rather than filed as follow-ups: the real adapter's
  signed download URL didn't force `ResponseContentDisposition: attachment`, so an uploaded HTML/SVG
  could render inline on the bucket/CDN origin — fixed to match the fake route's `nosniff`+`attachment`,
  closing the same stored-XSS class the fake route already blocked. The mint route accepted any
  content-type string verbatim, so control characters (newlines) could ambiguate the fake target's HMAC
  canonical string or pollute a real S3 policy/Content-Type header — fixed with a printable-ASCII-only
  check. The fake upload endpoint called `formData()` (buffers the whole body) before checking the HMAC
  signature, letting an unauthenticated caller force large buffering — fixed with a pre-parse
  `Content-Length` guard (2x the artifact ceiling). And the dropzone's file input was `display: none`,
  invisible to both axe and the tab order — fixed to visually-hidden-but-focusable CSS (see
  `docs/build-notes.md`). None change the shipped shape; they harden it.
- **Audit lives in an Events-tab SECTION, not an eighth Backstage tab (audit slice).** `audit_events`
  is compliance-grade PRODUCT data (per-tenant, in pglite), not dev telemetry — but it is still an
  observation record, so it renders read-only in the existing **Events** tab beneath a labeled divider
  ("Audit trail — product record"), above which the analytics events stay. This respects the
  events-are-observations doctrine while making the two KINDS of record visually distinct, and avoids a
  tab-count creep the surface didn't need. Its data comes from a dedicated fake-mode-only god view
  route (`GET /api/backstage/audit`, 404 first line) that reaches past the tenant RLS scope exactly as
  `listWorldJobs` does; the static twin appends the same rows in memory from its own mutations (full
  parity — audit is just rows).
- **`recordAuditEvent` is a convention + helper called AFTER each authorized mutation, never inside
  `authorize()` (audit slice).** `authorize()` is a pure, side-effect-free decision; writing there
  would couple the choke point to IO and fire before the subject id exists. Instead each of the eight
  authorized mutating routes (notes, jobs, org-invite, artifact mint + confirm, org-request
  create/respond/cancel) calls `recordAuditEvent(db, {...})` on the line after its write — the natural
  moment the real subject id is known — with an `action` string like `note.created`,
  `org-request.accepted`. Deliberately NOT wired into the authorized-mutations scanner (that stays a
  pure "did you authorize" check); a focused helper unit test plus the RLS append-only proofs carry it.
  The table is append-only at the privilege layer (SELECT/INSERT only — the `job_status_changes`
  precedent), so a recorded event can never be rewritten or erased.
- **Staff manage-all is activated by WIELDING the staff org, not by membership (staff slice).**
  `abilityActorFromUser` derives `manageAll = user.orgSlug === STAFF_ORG_SLUG` ('ops-staff')
  — acting AS the staff org is the activation, anchored to the ACTIVE org exactly like every other
  power in the model, with no per-request membership-list lookup. It reads the active-org SLUG (not a
  uuid), so it holds whether a route passes a resolved uuid `activeOrgId` or `canInActiveOrg` passes
  the slug anchor. **It NEVER crosses tenants:** `manageAll` only short-circuits the per-subject
  rules, which are already tenant-bounded, and every product query still runs inside `withTenant`
  (ADR-0004). **Honest scope:** `manageAll` is an ability-layer override, NOT a query filter — routes
  with party-scoped row lookups (`orgRequestForActiveOrg`, `jobForOrg`) still return null for a
  non-party active org, so a staff actor gets no cross-org DATA on those surfaces; the product staff
  admin SCREEN is app work, out of scaffold scope. The functional override is proved
  in `authorize.test.ts` (a staff actor authorizes an action it has no side in); the visible e2e proof
  is just that Olive's dashboard works in ops-staff. **Naming:** the org `ops-staff` is distinct from the
  rank-ladder role `'staff'` (an org-manager rank) — disambiguated in `src/core/roles.ts`.
- **`deferAfterResponse` runs work INLINE in fake mode, via Next's `after()` in real mode (defer
  slice).** The seam over `after()` systematizes post-response side
  effects (the canonical one: notification email — a slow provider must never add request latency). In
  real mode it schedules `after(work)`. In fake mode it runs the work inline (awaited) for
  determinism — the SIMULATE_CODE_BUILD spirit — so a hermetic e2e that sends an invite and polls the
  fake mailbox finds the mail without racing a post-response microtask (exactly the ordering that held
  before the seam existed). Fake mode ALSO captures a `deferred_work` event first (so the deferral is
  visible in the Backstage Events tab) and `deferred_work_failed` on error; errors are always recorded
  and swallowed, never crashing the response (real) or the handler (fake). The worked call site is the
  org-invite email.
- **A review pass resolved four open scope/semantics questions before merge (audit/staff
  slice).** `recordAuditEvent` runs in its OWN transaction, strictly after the mutation's commit —
  deliberately non-atomic: a rolled-back write can never leave a phantom audit row (the dangerous
  direction), and a failed audit insert after a committed write surfaces as a 500, never a silent gap.
  A shared transaction was rejected because some audited mutations (org invites) happen on the auth
  port, not in the DB, so no single-txn shape covers every site. Invite ACCEPTANCE is deliberately left
  OUT of the trail: it's a fake-mode-only app route, while real mode accepts through Clerk's
  client-side ticket flow, which never hits an app route — auditing acceptance here would record fake
  acceptances while real ones stayed invisible; audit it when a real-mode acceptance route exists.
  `STAFF_ORG_SLUG` matching is per-tenant BY DESIGN, not an oversight: in production, org slugs are
  only tenant-unique, so any tenant naming an org `ops-staff` designates its own operator org, scoped
  strictly inside that tenant (ADR-0004) — not an escalation, since that tenant's admins already hold
  top authority there. And `manageAll` is checked BEFORE the `restricted` gate in
  `defineAbilitiesFor` — a restricted ops-staff member would otherwise be denied the very authority the
  org exists to grant; staff-org membership is assumed non-restricted (nothing enforces this yet),
  flagged as the gate to add if a restricted operator ever becomes a real configuration.
- **Conversation fixtures can the model's utterances, never the tool results (LLM-tools slice).**
  A tool-loop fixture entry's `conversation` records only `assistant` turns (text and
  `tool_use` requests); the `user`/`tool_result` turns the adapter interleaves always come from a
  LIVE call to the app's `execute` closure, in both real mode and fixture replay, against
  whichever world is running (fake DB in tests/dev, in-memory notes in the static demo). Canning a
  tool result instead would let a fixture assert a fact about the world (e.g. "the notes are X")
  that the actual seeded/edited world no longer holds — a silent lie the moment anyone changes the
  seed. The replay-honesty split trades a little determinism (the tool's numbers can vary run to
  run) for a fixture that can never claim something about the world that isn't currently true.
- **Adapters refuse to dispatch a `tool_use` for a name the app didn't supply, and the port doc
  now carries a written TRUST MODEL (LLM-tools slice).** Added in a follow-up commit after
  self-review of the first cut: both adapters previously relayed any `tool_use` block straight to
  `execute` on the strength of the model (or a hand-edited fixture) naming a real tool. Now each
  checks `call.name` against the supplied `tools` list with exact string equality before calling
  `execute`, returning `"unknown tool: <name>"` as the tool result otherwise — defense-in-depth,
  since a well-behaved model only ever names a tool it was given. The port doc's new TRUST MODEL
  section states the invariant this defends: tool results are user content into the model's
  context (a stored note can carry injection text), so model output is always untrusted —
  display-only, never branched on, never wired to a privileged action — and a tool's blast radius
  is exactly its `execute` closure, which must scope to session-resolved ids captured at build
  time, never model-supplied input.
- **The `list-notes` conversation fixture is hand-authored, not recorded (LLM-tools slice).**
  `fixtures/llm/assistant-demo.json` ships a `list_my_notes` tool-loop entry written by hand
  (no `ANTHROPIC_API_KEY` in this environment) and marked with a `note` field saying so. This
  follows the same provenance convention as every other authored-but-unverified fixture: it's
  typechecked and shaped exactly like a real recording (`pnpm llm:record`'s tool-loop path — a
  per-purpose recorder registry keyed by fixture purpose — will overwrite it once a key exists),
  but its assistant turns and their wording are not proven against the real API. Tracked as part of
  the existing `anthropic-key` cutover row, not a new one.
- **Tool descriptions and the assistant system prompt are plain strings, not next-intl (LLM-tools
  slice).** `src/app/api/assistant/tool.ts`'s `ASSISTANT_SYSTEM` and
  `LIST_MY_NOTES_TOOL.description` are MODEL-facing prompt content — sent to Anthropic to steer tool
  selection, never rendered in the UI — so they fall outside the no-hard-coded-UI-strings rule the
  same way `system` prompts already did before this slice. Keeping them as literals also keeps them
  byte-identical to what the committed conversation fixture was hashed against; routing them through
  next-intl would let a translation-file edit silently break fixture replay (see
  `src/app/api/assistant/tool.test.ts`'s fixture-contract guard).
- **Realtime collaboration closed as a recipe, deliberately building nothing.** The
  development-approach services section now carries the forced-extraction recipe: single-user as the
  hermetic default and the fake, the sidecar as another counterparty verified via the service-auth
  precedent, a `collab` port seam, simulated co-editors as Backstage actors, cutover rows for the
  service's infrastructure. A production-viable single-user degrade flag is the
  evidence this costs nothing to defer. Machinery lands only when a real app on this template is genuinely
  forced — the coverage sweep's own recommendation, now doctrine.
- **Post-campaign cross-slice review: export keys now encode the org, and the guarantees that held
  only by convention are enforced.** A whole-campaign adversarial review (all nine slices at once)
  confirmed the choke points hold but found the residual risk sitting exactly at slice seams. Three
  medium findings, all fixed: (1) export keys are now `exports/<tenantId>/<orgId>/<jobId>.csv`
  (core `exportKeyPrefix`), with the service status route prefix-locked to the CALLER's org and the
  webhook path validating the org half against the JOB ROW — before this, a same-tenant service
  caller could plant another org's export key and have `GET /api/jobs` sign it. (2) The
  authorize-bypass scanner's detector now catches every legal handler-export form (`export function
POST`, `export { POST } from`, const/let/var) with self-tests, plus a stale-prefix-exemption
  check; classification deliberately runs on RAW source (over-match fails loud) while the
  authorize(...) requirement runs on comment-stripped source. (3) Fake service keypairs are keyed
  by tenant AND org slug, and an org slug existing in multiple tenants refuses to mint without a
  `tenantSlug` disambiguator — same-slug orgs sharing a private key would have collapsed the
  "signature picks the true org" verification guarantee. Four low findings fixed alongside:
  the static twin no longer audit-logs refused org-request transitions; a webhook redelivery
  losing a race now re-observes (bounded retry) instead of bouncing the vendor with a 409; the
  dashboard refreshes org-requests on a decide-race 409 instead of leaving stale live buttons;
  fake upload targets carry a signed 15-minute expiry (S3 parity) and `confirmArtifact` is
  pending-only, closing silent byte/size swaps once the target expires (within the 15-minute
  window a still-live target can re-upload — exactly the property a real S3 presigned POST has).
- **Post-campaign cross-slice review, round 2: exemption claims are now enforced, not prose.** The
  round-2 pass (verify-the-fixes + a claims-vs-enforcement sweep) confirmed all seven round-1 fixes
  closed and found the same failure class one meta-level up: the authorize scanner's prefix
  exemptions asserted gates ("fake-mode-gated", "gated by withServiceCaller") it never checked. Each
  checkable exemption now carries a `mustMatch` guard the scan enforces per exempted mutating file —
  a backstage route that forgot its `isFakeMode` gate, or a service route that dropped
  `withServiceCaller`, now fails the build instead of shipping silently exempt. Also fixed: the
  mutating-export detector covers `export *` and `export const { POST } =` (treated as mutating
  sight-unseen — over-match fails loud); a re-confirm of a ready artifact is 200-idempotent WITHOUT
  a duplicate `artifact.confirmed` audit event (`confirmArtifact` reports 0 rows, the route skips
  the audit write); the service/ exemption justification cites the decision-log service-auth entry
  instead of a wrong ADR number. One operational note for pre-fix checkouts: the keypair-scoping fix
  does not revoke keypairs minted at the OLD `.data/auth/service-keys/<orgSlug>/` path or their
  still-active `service_keys` rows — a world that predates it should be Scenes-reset (or `.data`
  wiped) after upgrading; harmless for default seeds, which have no cross-tenant slug collisions.
- **Round-2 coverage sweep runs on app types, not a reference app** (2026-07-23,
  `docs/app-coverage-gaps.md`). Round 1 measured the scaffold against one reference app; round 2 enumerates app _types_
  until saturation (19 — new types stopped surfacing new capability rows) and triages each
  capability by demand breadth × retrofit pain × house leverage. The sweep's focus decision:
  the template concentrates on external-service seams and missing integration classes; UI kits
  (table kit, settings, charts, rich text, wizards) are tracked on a prioritized backlog in that
  doc rather than built speculatively.
- **The template/instance doctrine is now explicit** (2026-07-23, `docs/app-coverage-gaps.md`).
  The template ships three kinds of things: universal capabilities fully worked (port + default
  vendor + fake + Backstage), one worked example per integration class, and recipes for
  everything else. Vendor code must pass _universality_ (every instance uses it) or _new-class_
  (mechanics the template doesn't already teach) — fail both, write a recipe. This is why
  round 2 builds five slices with zero new vendors: Twilio, web-push, and Zoho-class
  e-sign land as recipes, because after signed egress the callback-vendor integration
  classes are complete and a second worked example per class is repetition, not coverage.
- **Access gating is a class, not a feature** (2026-07-23, access-gates intent). What began as
  "clickwrap ToS acceptance" generalized during triage: the reusable thing
  is a gate — a condition an actor must satisfy before proceeding, with scope, resolution flow,
  and block-vs-advisory behavior, hooked once into the protected layout. Agreements are the
  worked example with gating behavior as per-agreement data; email verification, MFA
  enrollment, onboarding, and billing entitlements ride the same seam later — which is also
  what makes deferring billing safe.
- **A dependent slice chain merges on green gates, with review retrospective** (2026-07-23). The
  round-2 slices were built sequentially, each merged once `pnpm verify` (+ `pnpm test:contract` for
  migration slices), the doc-steward pass and the pre-PR review were green. Deliberate trade: a
  blocking review on every link stalls a chain where each slice depends on the last, so the gates
  carry the risk and review catches what gates cannot. It is the wrong trade for a change that a
  gate does not cover.
- **Scheduled work: three closed spec shapes, UTC-only, no cron/RRULE** (2026-07-23,
  `src/core/schedules.ts`). `job_schedules.spec` is one of `interval` / `daily` / `weekly`,
  all interpreted in UTC with no timezone library — so `computeNextRunAt` is identical on every host
  and DST can never move a fire time (a UTC day is always 86,400,000 ms). Arbitrary cron expressions
  and calendar recurrence stay a recipe (per the round-2 doctrine), not template code; an instance
  needing local-time schedules layers a tz conversion at the edge above this pure core.
- **Interval drift policy: scheduled-time anchoring, with coalescing** (2026-07-23). A
  schedule advances by feeding its OWN `next_run_at` back into `computeNextRunAt`, never `now` and
  never the handler's completion time — so an interval series is anchored to its origin and immune to
  tick latency or handler duration. Missed slots (a late tick, or a demo clock-jump across periods)
  coalesce: the row advances to the first slot after `now` and fires ONCE, never one job per skipped
  period — the sane behaviour for both a recovered outage and a "+1w" demo jump.
- **Idempotent due-scan reusing the jobs machinery** (2026-07-23, `src/db/schedules.ts`).
  `runDueSchedules(now)` spawns through the EXISTING jobs path (a `jobs` row + its opening `queued`
  timeline, then `jobs.start` after commit — the `submitJob` shape) rather than a parallel one, so a
  scheduled job is indistinguishable downstream from a hand-submitted one. The spawn and the
  `next_run_at` advance commit in ONE tenant transaction that locks the schedule row `FOR UPDATE` (the
  `recordJobStatus` pattern), so a tick firing twice can never double-spawn. A tick belongs to no
  tenant, so the scan enumerates `tenants` raw (no RLS on that table — the `tenant-lookup`
  precedent) and reads each tenant's due schedules INSIDE `withTenant` — load-bearing under FORCE
  RLS, where a raw scan of `job_schedules` would return zero rows on a real Postgres role (pre-merge
  review finding; see build-notes). One bad row (malformed spec, `start()` failure) is caught
  per-schedule and counted as `failed` rather than stalling the whole tick; it retries next tick
  because its `next_run_at` never advanced.
- **`digest-email` is a new job KIND, not new machinery or a new vendor** (2026-07-23). The
  demo payoff extends an already-worked class (async jobs) rather than adding a port or adapter — the
  `email` port gained a second consumer via a new field on `JobContext`. A scheduled email has no
  request/user locale at fire time (unlike the invite, sent by an acting user), so the recipient's own
  seed locale drives the copy, falling back to the app default; the digest is addressed to the team's
  admin so it lands in a real Backstage inbox.
- **World-clock offset lives in a Scenes LIVE_DIR and is unreachable in real mode** (2026-07-23,
  `src/adapters/fake/clock.ts`). The "time control" the backlog left open is a signed ms
  offset in `.data/backstage/clock.json`; because `backstage` is a LIVE_DIR, a Scenes reset/restore
  clears/snapshots it with no extra wiring. `worldNow()` (real time + offset) is called ONLY behind
  `isFakeMode` — the cron webhook and the fake-mode-gated Backstage routes — so real time is always
  real time, structurally (the same containment shape as the fake-only webhook-secret helper). The
  Backstage advance controls also DRAIN due schedules after moving the clock, so "time jumps forward,
  the digest appears" is one click; a separate "run due now" and "reset clock" round out the surface.
- **System-initiated firings are audited as a synthetic actor** (2026-07-23). A scheduler
  tick has no acting user, so `schedule.fired` is recorded against `actor_user_id: 'system:scheduler'`
  with a new ability `SubjectType` `'JobSchedule'` (rule-less — schedules are system-managed, so the
  deny-by-default switch covers it). This deliberately stretches the audit trail's "per-actor product
  mutations" scope to cover system firings, because a schedule firing IS an org-scoped event worth a
  durable record (and it shows in Backstage's audit trail — a nice demo beat).
- **Webhook signing is pure isomorphic core, not server-lib** (2026-07-23,
  `src/core/webhook-signing.ts`). The scope note pointed at `src/server-lib` because it assumed
  `node:crypto` (the storage-upload HMAC precedent). But the static-demo twin must ALSO sign
  ("the signing helper is pure, so the twin can really sign"), and the twin is bundled by vite into a
  `file://` page where a node builtin can't load and Web Crypto's secure-context/async caveats bite.
  So HMAC-SHA256 is implemented in plain TS over bytes (via `TextEncoder`) and lives in `src/core` —
  isomorphic (ADR-0006), synchronous, shared verbatim by the server dispatch, the verify half, and the
  twin. Correctness is pinned by a colocated test that cross-checks EVERY output against `node:crypto`
  (a test may import node builtins even in core), including block-boundary and long-key/unicode edge
  cases — so hand-rolling the primitive is safe, not a liability.
- **Both halves of the scheme ship** (2026-07-23). Stripe-style `x-<app>-signature:
t=<unix>,v1=<hex>` over `{timestamp}.{body}`, PLUS `verifyWebhookSignature(body, header, secret,
{toleranceMs})` with a replay window (rejects stale AND future-dated timestamps, constant-time hex
  compare). The e2e imports the verify half to prove the egress the app produced actually verifies —
  the template teaches the receiver's side, not just the sender's.
- **Dispatch is an app-owned seam (server-lib real + adapters/fake), injected into the drain, not a
  vendor port** (2026-07-23). There is no vendor SDK (`fetch` is a global), so per the
  template/instance doctrine this is app machinery like `src/service-auth`, not a port. Real dispatch
  (`fetch` + timeout) lives in `src/server-lib/webhook-dispatch.ts`; the fake (catch-store + failure
  toggle) in `src/adapters/fake/webhooks.ts`; selection is `isFakeMode` (the service-auth precedent).
  Crucially the drain (`runDueDeliveries`) takes the dispatcher as a PARAMETER (the
  `runDueSchedules`-injects-`JobsPort` shape) instead of importing it — so `src/db` never imports
  `@/adapters`, which would drag `server-only` into its happy-dom unit tests (see build-notes).
- **Delivery is at-least-once via claim-then-dispatch** (2026-07-23, `src/db/webhooks.ts`).
  A non-idempotent HTTP POST must never be held inside a DB transaction, and two concurrent ticks must
  not double-send. So each due delivery is drained in three phases: (1) CLAIM under a `FOR UPDATE`
  lock — bump `attempt_count` and pessimistically arm `next_attempt_at` with the backoff (assume
  failure), commit; a racing tick then sees "not due" and skips; (2) DISPATCH outside any txn; (3)
  RECORD the real outcome. A crash between claim and record just re-sends at the backoff time — hence
  at-least-once, so the signed envelope carries the delivery `id` for consumer dedupe. Same per-tenant
  `tenants × withTenant` + per-item fault isolation as `runDueSchedules` (a FORCE-RLS table can't be
  scanned raw — build-notes).
- **Backoff policy: 1m/5m/30m/2h/6h, 5 attempts → dead** (2026-07-23,
  `src/core/webhook-events.ts`). Coarse and capped: enough spread to ride a counterparty's short
  outage without hammering it, short enough that a demo crosses a step with a one-hour clock advance.
  After `MAX_DELIVERY_ATTEMPTS` (5) failed attempts a delivery is `dead` and never retried. Pure core,
  unit-tested, and instance-tunable.
- **Delivery lifecycle + deliveries are OPERATIONAL records (full CRUD + cascade)** (2026-07-23,
  migration 0010). Status runs `pending` → `failed` (retry armed) → `delivered` | `dead`; the
  drain scans `pending`/`failed`. Unlike `audit_events`, `webhook_deliveries` is NOT append-only —
  `status`/`attempt_count`/`next_attempt_at` are UPDATEd in place — and it carries the full
  SELECT/INSERT/UPDATE/DELETE grant with the endpoint FK `ON DELETE CASCADE`, so removing an endpoint
  tidies its deliveries (the app-role DELETE grant is what lets that cascade run under FORCE RLS). The
  DURABLE webhook record is the audit trail (`webhook.delivered` / `webhook.dead`, append-only), not
  the delivery row — a deliberate split recorded so the no-DELETE precedent isn't assumed here.
- **Secret is server-generated, shown once, stored plaintext** (2026-07-23). Template-level
  simplicity: `whsec_<hex>` minted by the create route (`node:crypto` — a builtin, allowed outside
  adapters, the service-auth precedent), returned once, displayed once in the card, and never
  retrievable again. Stored plaintext in `webhook_endpoints.secret`; a real instance may vault it (no
  vendor is forced, so no cutover row — customer URLs and secrets are runtime data, not deploy params).
- **Backstage gets a separate Hooks tab; failure is a per-endpoint toggle** (2026-07-23).
  Endpoints + deliveries are a distinct concept from the Jobs tab's schedules, so they get their own
  `hooks` tab (the Actors-tab precedent for adding one) rather than overloading Jobs. The fake
  dispatch's failure mechanism is the simplest deterministic one: a per-endpoint id set in
  `.data/backstage/webhook-failures.json` (a `backstage` LIVE_DIR file, so a Scenes reset clears it),
  flipped live from the panel — beats magic URL markers. The catch-store `.data/webhooks/` is itself a
  new LIVE_DIR so reset/snapshot cover it. The drain is wired into the SAME ticks that drain schedules
  (cron / clock-advance / run-due), so "advance the clock past a retry's backoff and watch it fire"
  works alongside the schedules story.
- **SSRF posture: accept-with-note at template level, egress control is a cutover-time instance
  concern** (2026-07-23, pre-merge review finding). The real dispatcher POSTs to org-admin
  URLs with only a scheme check (http/https) — no private-IP/metadata-range filter. Recorded
  deliberately rather than half-guarded: endpoint registration is admin-gated (`authorize()`
  manage-org), the delivery body is app-composed, and the default deployment (ADR-0001: Lambda, no
  VPC) offers no internal network worth reaching. The seam is marked in
  `src/server-lib/webhook-dispatch.ts`: an instance deploying into a private network adds an egress
  proxy/allowlist or an IP guard there at cutover. Also recorded from the same review: emission is
  at-most-once (enqueue runs after the mutating commit, mirroring the audit-after-commit precedent),
  so the at-least-once guarantee begins at the delivery row; and a delivery killed by a disabled
  endpoint now writes the same `webhook.dead` audit event as a backoff death.

- **The fan-out is app-owned server machinery, NOT a vendor port** (2026-07-23,
  `src/server-lib/notify.ts`). Same settlement as the webhook-dispatch seam: no vendor SDK is
  involved — `in_app` is the db, `email` is the existing port, `sms` is an app-owned channel seam —
  so a `src/ports/notify.ts` would be a port with no vendor to wrap. `notify(deps, input)` takes its
  dependencies INJECTED (db/email/sms + an optional locale resolver), the `runDueSchedules(db, jobs)`
  precedent, so unit tests and the static twin exercise the same logic. The PURE decision
  (`resolveEnabledChannels`, `notificationCopy`) lives in `src/core/notifications.ts`, shared verbatim
  by server and twin like `abilities.ts`.
- **The SMS channel is a fake-only seam + a recipe — this slice ships ZERO vendor code**
  (2026-07-23, `src/server-lib/sms.ts`). `sendSms` selects the fake catch-store (`.data/sms/`,
  the mail/webhooks catch-store pattern) behind `isFakeMode` and is a deliberate NO-OP in real mode,
  with a comment pointing at `docs/recipes/sms-twilio.md`. The fake is the second consumer that keeps
  the channel abstraction honest without a Twilio adapter the template would carry unused (the
  two-tests doctrine: SMS fails universality AND is the same outbound-vendor class llm/email/webhooks
  already teach).
- **Opt-out / default-on preference model** (2026-07-23, `notification_prefs`, migration
  0011). Every channel is ON unless a pref row for that exact (kind, channel) says `enabled = false`;
  absence of a row means enabled. Rows exist only to record deviations (cheapest to persist,
  least-surprising template default). `notification_prefs` are ORG-SCOPED (org_id NOT NULL): the
  fan-out reads a recipient's prefs by the NOTIFICATION's org — always a team the recipient belongs
  to — and the profile grid edits the ACTIVE org's prefs, so a user in two teams can differ per team
  (granular, and the notification's org is always resolvable).
- **Recipients, where the obvious one doesn't exist** (2026-07-23). `org.invited` → the
  inviting team's OTHER admins ("X was invited"), because the invitee has no account yet and so can
  hold no in-app row; the inviter is excluded. `job.completed` → the job's org admins, because the
  `jobs` table has NO creator column (checked); fired ONLY for the user-facing `export-notes` kind on
  a terminal transition (the internal `digest-email` kind is denylisted so scheduled work isn't
  notification noise). `org_request.received` → the TARGET (responder) team's admins (the demo's
  headline flow). Admin = an active member whose role passes `canManageOrg`, resolved via the auth
  port's `listMembers`.
- **Two tables, matched grants** (2026-07-23, migration 0011). `notifications`:
  SELECT/INSERT/UPDATE, NO DELETE — an in-app notification is a durable record; mark-read is an
  in-place `read_at` UPDATE; the bell scans `(recipient_user_id, read_at)`. `notification_prefs`: full
  SELECT/INSERT/UPDATE/DELETE with a unique `(tenant_id, org_id, user_id, kind, channel)` index as the
  upsert conflict target (a re-toggle updates in place; clearing a pref deletes the row). Both carry
  the 0002_notes tenant RLS verbatim; the recipient/owner scope is an app-level WHERE on top (a user
  sees/marks only their own rows).
- **Per-channel fault isolation; in_app durable, email/sms deferred** (2026-07-23). `notify`
  writes the in_app row SYNCHRONOUSLY (the bell must be durable before the response), then fires email
  and sms through `deferAfterResponse` (post-response in real mode, inline in fake mode) — which
  already swallows-and-records failures. So a dead mail provider can never lose the in_app row or
  block the sms.
- **Bell marks ALL read on popover open** (2026-07-23; recorded UX choice, simplest
  deterministic e2e). The `POST /api/notifications/read` route also accepts `{ ids }` for future
  per-item marking. Mark-read is gated by `authorize()` with a self-only `Notification` subject AND a
  recipient-scoped WHERE — belt and braces. `Notification`/`NotificationPref` are new self-only
  ability subjects (the `User` pattern), never org-scoped: a teammate can't read or clear your
  notifications, and prefs are personal.
- **Backstage gets a new read-only Messages tab** (2026-07-23; sibling to Mail, not a Mail
  channel-filter). SMS is a different shape than email (no subject/html/iframe reading pane), and the
  doctrine already anticipates "an SMS surface joining the panel"; a dedicated tab is the simplest
  honest surface. `.data/sms/` is a new Scenes LIVE_DIR so reset/snapshot cover it. No clear control
  (Scenes reset wipes the store) — so no mutating backstage route, no exemption-map churn.
- **Recipient locale is a fake-only enrichment** (2026-07-23). `notify`'s optional
  `resolveLocale` dep is wired to the fake auth adapter's `personaLocale` (the digest-email
  precedent) so demo emails/SMS render in the recipient's language; the auth port's `Membership`
  carries no locale, so real mode omits it and copy falls back to the app default — a noted
  simplification a real instance closes at its IdP.
- **Recipes live in a new `docs/recipes/` directory** (2026-07-23; `sms-twilio.md`,
  `web-push.md`), cross-linked from `docs/app-coverage-gaps.md`. The web-push recipe records the
  `file://` service-worker physics degrade. **No cutover row** — zero vendor is forced (customer phone
  gateways are instance work).
- **The notify seam is best-effort by construction, not by caller discipline** (2026-07-23,
  pre-merge review finding). The exported entry points (`notifyAdmins`, `notifyJobTerminal`) swallow
  their own failures — per recipient in the admin loop, end-to-end for the job path (whose
  `listMembers` is a real IdP call in real mode) — because producers invoke them AFTER the primary
  mutation committed, and a notification failure must neither 500 a succeeded action nor (on the
  completion webhook) trigger a vendor retry that no-ops as idempotent and silently drops the
  notification anyway. Producers stay unguarded on purpose: safety lives at the seam so future
  producers inherit it. The previously-untested recipient logic (kind allowlist, active+managing
  filter, unknown-job no-ops) is now pinned by `src/server-lib/notify.test.ts` against the durable
  in_app rows.

- **Address scheme: plus/sub-addressing `<org-slug>+<handler>@<domain>`** (2026-07-23). Chosen over the
  subdomain form (`<handler>@<org-slug>.<domain>`) because it needs a SINGLE Mailgun domain and a SINGLE
  catch-all Route — no per-org DNS/MX. The plus sign is RFC-5321-valid in a local part and Mailgun Routes
  regex-match it; the classic "a mail client strips `+tag`" worry only bites addresses a HUMAN types as
  their OWN From/To — this is an intake address the app HANDS OUT for the world to send to, so stripping
  never applies. The base local part is the org, the `+tag` the handler. Parser + formatter are pure in
  `src/core/inbound-email.ts` (shared by server intake and the static twin).
- **Org resolution is global-by-slug; tenant comes FROM the org; `org_id` is NULLable for the
  multi-domain path** (2026-07-23). The recipient names only the org, so intake resolves the org GLOBALLY by
  slug (unique across the seed), which yields the tenant too. Zero or multiple matches → unresolved (an
  address alone can't disambiguate a collision). Because tenant is derived from the org, the single-domain
  template never files a row without an org — but `inbound_emails.org_id` is declared NULLable anyway,
  honestly, for the REAL multi-domain path where the recipient DOMAIN maps to the tenant while the local
  part's org may be unknown (and for deliverability events that belong to a tenant but no team). The RLS
  proof exercises a null-org row directly. Unparseable/unresolved inbound is dropped with a 200 + a
  recorded caveat (no domain→tenant map in the template); it is NOT filed.
- **Poison messages return 200; only infrastructure failures 5xx** (2026-07-23). Mailgun retries a non-2xx
  for hours, so a permanently-broken message must never surface as 5xx or it retries forever. Intake
  CATCHES a handler throw → status 'failed', row KEPT, caller returns 200. A failure of the row insert
  itself (infra) propagates → real 500 → an appropriate Mailgun retry. The signature/auth failures ARE
  4xx (401) — a bad-signature caller isn't Mailgun, so retries are irrelevant.
- **`unmatched` covers two distinct causes; the note handler is member-only** (2026-07-23). An unknown
  handler slug files 'unmatched' with `handler` NULL (no handler claimed it). The `note` handler, when it
  DOES claim a message, still declines an UNMATCHED SENDER (an address not in the org's active members) —
  filing 'unmatched' with `handler = 'note'` and no note. Rationale: email-to-note is a member
  convenience; letting an arbitrary internet sender write into a team's notes is an injection vector. The
  alternative posture (attribute unmatched senders to a system actor) is a one-line change, recorded but
  not taken. So `handler` NULL ⇔ "no handler for this slug"; `handler` set ⇔ "this handler processed it",
  with `status` telling the outcome.
- **Fake-mode intake bypasses the signature, honestly** (2026-07-23). Backstage "compose inbound" does NOT
  spoof a Mailgun signature — it calls the shared `intakeInboundEmail` seam DIRECTLY through a
  fake-mode-gated route (`/api/backstage/inbound/compose`). Spoofing a signature from the panel would be
  theater. The real signed route (`/api/webhooks/email`) still runs the verifier in fake mode (reusing
  the per-checkout dev webhook secret as the fake signing key) so its unit/integration test exercises the
  true signed path.
- **Compose + inbound list live IN the Mail tab, not a new tab** (2026-07-23). The doctrine says new
  world surfaces become Backstage tabs, but inbound email is the RECEIVING half of the SAME mail surface
  whose outbound half already lives in the Mail tab — a sibling section reads more honestly than a
  separate tab. The Mail tab now shows: compose-inbound (top), the outbound catch-store (scope switch),
  and the world inbound list (`InboundApp`). Native `<select>`s keep the compose form Playwright-simple;
  the handler is free-text so a bogus slug can be sent to demo the 'unmatched' path.
- **Retention is table-only; no DELETE grant** (2026-07-23). `inbound_emails` is durable like
  audit/notifications (SELECT/INSERT + UPDATE-for-status, no DELETE). No TTL sweep in the template; a
  high-volume/PII-sensitive instance adds one (which would need a DELETE grant). A Scenes reset wipes
  `.data/pglite` with the rest of the fake world.
- **Replay guard is per-process in-memory** (2026-07-23). Mailgun's per-request `token` is single-use within
  the freshness window, tracked in a module-level `Map<token, expiry>` in `src/service-auth/mailgun.ts`.
  Its limit, recorded on purpose: per-process, so a multi-instance real deployment needs a SHARED store
  (Redis/DynamoDB/a tokens table) for a global guard — a `mailgun-routes` cutover note. The timestamp
  freshness window is the primary, stateless guard; the token set is the in-window dedupe on top.
- **Inbound is intake machinery, not a port method** (see ADR-0011 addendum). No `receive()` on
  the `email` port — the app never calls "receive email", the world initiates it as a webhook. The seam
  is the webhook route + a `src/inbound-email/` handler registry (the `src/jobs/` shape). `InboundEmail`
  is a new audit-only ability subject (the `JobSchedule`/`WebhookDelivery` precedent). The `webhooks/`
  authorize()-exemption's `mustMatch` was widened to accept `withMailgunSignature` alongside
  `withWebhookSecret` — both are machine-caller gates, not user sessions.
- **The email-to-note handler enforces the notes route's OWN ability check; sender trust bottoms out
  at Mailgun's SPF/DKIM** (2026-07-23, pre-merge review findings). The handler originally
  matched the sender on active membership alone, which would have let a `restricted` member — denied
  Note.create in the product — author notes by email. It now compiles the matched
  member's ability (`defineAbilitiesFor`) and refuses senders who cannot `create` a Note, filing the
  message `unmatched`; the static twin mirrors the same gate, and a seed-persona regression test
  (Riley) pins it. Recorded residual: attribution trusts the envelope sender Mailgun hands us, so a
  message that passes Mailgun's SPF/DKIM checks with a forged member address would be attributed to
  that member — the same residual every reply-by-email product carries, accepted and noted in the
  handler docstring.
- **The gate is a CLASS; agreements are one rider.** `src/core/gates.ts` is the reusable
  thing: a `Gate` = { id, scope, behavior: block|advisory, resolutionPath, pending(facts) }, evaluated
  by a pure `evaluateGates(registered, facts)` over an OPEN `GateFacts` bag the server assembles. It
  COMPLEMENTS `authorize()` — that seam denies one action (403, no resolution); a gate blocks-or-advises
  across a scope AND carries a resolution flow. Agreements (`src/core/agreements.ts`) are the worked
  example: each current agreement becomes a gate via `gatesForAgreements`, its behavior read from the
  row's `gating` data. Future riders (email verification, MFA per the ADR-0003 addendum, onboarding,
  suspension, billing entitlements) register their own gate + fact key with no change to the evaluator
  or the layout hook — which is what defuses the billing-retrofit risk the coverage doc names.
- **v1 implements scope 'all' only; action-scoped gates are TYPED but not built.** `GateScope`
  is `'all' | 'actions'`; only `'all'` (block/advise the whole protected area) is wired. The seam note
  in `gates.ts` documents exactly where an `'actions'`-scoped gate would hook — inside `authorize()`,
  after the abilities check, consulting pending action-scoped gates for the (action, subjectType) and
  surfacing `resolutionPath` — and it is deliberately NOT built (the round-2 "write it down, don't build
  it early" doctrine). Correspondingly `AgreementGating` is `'block-all' | 'advisory'` only; the plan's
  `'block-actions'` value is omitted because it needs that unbuilt action-scoped seam.
- **Agreements are TENANT-level, not org-scoped — a deliberate deviation from the default.**
  Every other content table (notes/jobs/artifacts) defaults to org-scoping; `agreements` carries NO
  `org_id`, because a site's Terms of Service / privacy notice applies to everyone in the tenant, not
  per-team. So tenant RLS (the `0002_notes` NULLIF policy) is the WHOLE isolation story here, with no
  second app-level org filter. `agreement_acceptances` is APPEND-ONLY at the privilege layer (SELECT/
  INSERT, the `audit_events` precedent) and denormalizes `agreement_version` so an old acceptance stays
  truthful when the agreement is later edited/bumped. `agreements` is SELECT/INSERT/UPDATE (the version
  bump is a granted UPDATE) with NO DELETE. RLS proofs cover both, incl. the append-only rejections.
- **The interstitial renders INSIDE the protected layout — no separate resolution route in v1 (slice
  N).** The gate hook is the layout RSC (`src/app/[locale]/(protected)/layout.tsx`): it assembles the
  user's pending agreements, evaluates gates, and for a pending BLOCK gate renders the generic
  `GateInterstitial` (agreements fill it with body + accept) INSTEAD of children; advisory gates pass
  through with a dismissible banner (the demo-banner precedent). Because the interstitial renders in
  place (not a redirect to `/agreements`), there is no resolution route to allowlist and NO gate loop is
  possible: `POST /api/agreements/accept` lives under `/api` (outside the layout), and signin/
  accept-invite live outside `(protected)`, so all three stay reachable while a gate is active. The
  header stays visible during a block so sign-out/org-switch remain reachable. `resolutionPath` is thus
  informational in v1; it earns its keep for a future externally-resolved rider (the e-sign recipe).
- **Accept is a self-only authorized mutation; bump is a fake-mode god op.** `POST
/api/agreements/accept` calls `authorize(user, …, 'create', { type: 'AgreementAcceptance', ownerId:
user.id })` — a new self-only ability subject (the `NotificationPref`/`User` precedent), so a user
  records only their OWN acceptance; the accepted version is read server-side, never client-supplied;
  the acceptance is audited (`agreement.accepted`). The version bump is a Backstage god op
  (`/api/backstage/agreements/bump`, 404 first line, `!isFakeMode` mustMatch-exempt) that resolves the
  agreement's tenant via a raw cross-tenant read and then bumps through `withTenant` — exercising the
  app_user UPDATE grant the RLS proof covers, the shape a real admin agreements UI would use.
- **Seed shape keeps every existing e2e green: pre-accept + clickwrap-on-join.** The alpha
  `tos` (block-all, v1) is pre-accepted by EVERY seed persona in tenant alpha, so no seed-persona sign-in
  is ever blocked — the world stays stable until an operator BUMPS the version (the demo story). The
  demo-org `privacy` (advisory, v1) is accepted by nobody, so its dismissible banner shows out of the
  box (proving advisory). The one case the pre-acceptance can't cover is a NEWLY invited (dynamic)
  persona — Bob joins Research (alpha) and would hit the block-all ToS, breaking the accept-invite specs
  (real AND static). Resolved by **clickwrap-on-join**: accepting an invitation records acceptance of
  the tenant's current agreements (the accept-invite route + the twin's accept handler both do this),
  so a fresh joiner isn't immediately gated — a legitimate "you agreed to the terms by joining" stance,
  and a later bump re-arms the gate for them too. In real mode this route doesn't run (Clerk join lands
  the user on the interstitial instead — the same seam), a documented real/fake entry-point difference.
- **The gate control is a SECTION in the Scenes tab, not a new Backstage tab.** Scenes hosts
  world knobs (reset, flags, clock); a ToS version bump is a world knob (it re-arms the gate for
  everyone), so the Agreements section lives there — the same "prefer a section over tab-count creep"
  call the audit-in-Events-tab decision made. It lists every agreement across all tenants
  (a cross-tenant god view) with version, gating, and acceptance tallies, each with a bump button.
- **Clickwrap-on-join now carries its notice; the v1 gate posture is recorded honestly**
  (2026-07-23, pre-merge review findings). The fake-host accept-invite screen discloses that
  joining also accepts the tenant's current agreements (`agreementsNotice`, both locales) — an
  acceptance record without notice isn't real clickwrap, and the worked example exists to teach the
  pattern; provenance was already in the row (`metadata.via: 'invite'`). The hosts differ on purpose:
  real mode records nothing at join — Clerk-joined users land on the interstitial (full notice +
  assent), so the notice line belongs to the fake host alone. Separately, `src/core/gates.ts` now
  states the v1 enforcement posture plainly: a block-all gate blocks the protected UI only; direct
  API mutations by a blocked-but-authenticated user are not gated until action-scoped gates hook into
  authorize() — a compliance/UX gate, not a security boundary (abilities and RLS are unchanged by
  gating). Also recorded: the accept route's bump-race tradeoff (server-current version wins over a
  forgeable client-supplied one), and profile acceptance rows key on acceptedAt to tolerate
  append-only duplicates.
- **Mechanical identifiers de-branded ahead of templating: derive from `APP_SLUG` or go neutral**
  (2026-07-23, `feat/app-identity`). New `config/app.ts` exports `APP_SLUG` as the ONE place an
  adopter changes the app's mechanical identity; it is dependency-free so both `src/` and `infra/` import
  it. The split is by COLLISION RISK. Identifiers that can collide across two coexisting apps DERIVE from
  the slug: the fake session cookie (`${APP_SLUG}_session`), fake-auth JWT issuer (`${APP_SLUG}-fake-auth`),
  Backstage viewpoint cookie (`${APP_SLUG}_backstage_viewpoint`) — cookies are port-agnostic on localhost,
  so two local apps would otherwise clash — the service-token audience (`${APP_SLUG}-service`, one const
  fans out to issue/verify/tests), and the infra names (stack id `${Capitalized}AppStack`, `Name`/
  `Application` tags, Aurora DB name, budget name) that share one AWS account. Identifiers that are only
  origin- or process-scoped are instead NEUTRALIZED so they never need adoption-time renaming:
  the data-dir env var → `APP_DATA_DIR`, the fake-db global → `__appFakeDb`, the `localStorage` keys →
  `app-backstage-*`, the mail-preview `postMessage` type → `app-mail-link`, the public-metadata type →
  `AppPublicMetadata`, test tmp-dir prefixes and the contract-test DB name, and the
  `.claude/launch.json` profile → `app-dev`. The per-slug workspace scope became `@app/*`
  (`@app/seed`). Residual INSTANCE identity is deliberately kept: the root package name, the infra
  package name, the `APP_SLUG` value itself, all display copy (`messages/*.json`,
  the `layout` metadata title), and `config/params.ts` `sentry.org` — these belong to an instance and
  are handled by docs/cutover, not by templating. Outbound webhook header names (`x-<slug>-signature` and
  siblings) DID get derived (`WEBHOOK_*_HEADER` consts in `src/core/webhook-signing.ts`, built from
  `APP_SLUG`): they are an external signing contract that receivers pin at integration time, which is
  exactly why the change happens NOW — pre-cutover there are zero real receivers, and after cutover the
  names freeze. An adopter's receivers thereby pin `x-<their-app>-*`, never the template's brand.
- **The framework/app seam is one alias, `@app-config/*`, deliberately distinct from `@/app-config/*`**
  (2026-07-23, PR 1a, ADR-0012). Framework code reaches app content ONLY through the seam modules under
  `src/app-config/`, imported by the `@app-config/*` alias. The eslint fence bans the `@/app-config/*`
  path (and `@/app/*`, `@/domain/*`, `@/jobs/*`, `@/demo-static/*`, `@app/seed`) in framework dirs — so
  the two spellings that resolve to the SAME files split into "banned direct path" vs "allowed seam". No
  DI, no module augmentation: framework→seam is a plain typed import (types exported by the framework,
  values enumerated). Rejected module augmentation (solves only the type half) and generics (threads a
  `<TSubject>` everywhere for one consumer).
- **eslint fence structure re-lists patterns per block (the merge trap, again)** (2026-07-23, PR 1a).
  `no-restricted-imports`/`no-restricted-syntax` REPLACE by file-match rather than merge, so every
  framework block re-lists `vendorSdkPattern` + `appCodePattern` (+ `nextFontPattern`), and the
  app/component `no-restricted-syntax` blocks re-list `getDbSelector`/`processEnvSelector` alongside the
  new `a11yLiteralSelector`. Adapters get `appCodePattern` only (no vendor ban — vendor SDKs are their
  job). Proven by temporarily adding a forbidden `@/domain/*` import to a `src/core` file and watching
  lint fail with the ADR-0012 message.
- **Migration numbering convention: framework 0001–0999, app ≥1001** (2026-07-23, PR 1a, ADR-0012). When
  `notes`/`org_requests`/`artifacts` became app tables they moved to `src/app-config/db/migrations/` and
  renumbered `0002→1001`, `0006→1002`, `0007→1003`. Kysely runs the composed registry NAME-SORTED, so app
  migrations run after every framework table exists — safe because app tables only reference framework
  tables (`organizations`), never the reverse. The framework's `0003_organizations` used to `ALTER TABLE
notes ADD org_id`; a framework migration must never touch an app table, so that column moved into
  `1001_notes`'s `createTable` (notes now runs after organizations). Safe only pre-cutover (wipe `.data`).
- **Jobs compose like migrations, and the SEAM is the handler composition root** (2026-07-23, PR 1a).
  `src/core/jobs.ts` keeps statuses/machine/`exportKeyPrefix` + `FRAMEWORK_JOB_KINDS = ['digest-email']`;
  the seam supplies `appJobKinds = ['export-notes']` + `appJobHandlers`. `JobKind = FrameworkJobKind |
AppJobKind`, `isJobKind` composed. Because the fence bans framework files from importing `@/jobs/*`, the
  fake jobs adapter can't reach the (framework, temp-housed-in-`src/jobs`) `digest-email` handler
  directly — so the seam `src/app-config/jobs.ts` is the composition root that merges both into a single
  `jobHandlers` map the adapter consumes. `isJobKind` reads `appJobKinds` LAZILY (never a top-level
  spread) so the benign core↔seam value cycle (`core/jobs → seam/jobs → export-notes → core/jobs`, all
  runtime-only) can't crash at module-init. PR 2 relocates the framework handler into the package.
- **Three event vocabularies split framework/app by the same union pattern** (2026-07-23, PR 1a).
  `AuditAction`, `NotificationKind`, and `WebhookEventKind` each become `Framework* | App*`: the framework
  keeps its own verbs/kinds (`membership.invited`/`job.submitted`/…, `org.invited`/`job.completed`,
  `job.status_changed`) and the mechanism; the seam (`src/app-config/{audit,notifications,webhooks}.ts`)
  supplies the app vocabulary (`note.*`/`org-request.*`/`artifact.*`, `org_request.received`, the
  `org_request.*` webhook pair) + payload shapes, composed with type-only seam imports (plus a value
  import for the notification copy delegation). Audit's `action` was an untyped `string`; typing it as the
  composed union added real safety with no route changes (the literals already matched).
- **Abilities BaseSubjectType follows reality (11 framework subjects), not the plan's earlier list of 4**
  (2026-07-23, PR 1a). ADR-0012's B.1 text (`'Org'|'Membership'|'User'|'Job'`) predated the round-2 subsystems;
  `BaseSubjectType` actually spans every framework subject (adds `JobSchedule`, `WebhookEndpoint`,
  `WebhookDelivery`, `InboundEmail`, `Notification`, `NotificationPref`, `AgreementAcceptance`), while
  `AppSubjectType` is exactly `Note | OrgRequest | Artifact`. `AppSubjectFields` (the two-sided
  `requesterOrgId`/`responderOrgId`) and `anchorSubjectExtras` moved to `src/app-config/abilities.ts`
  beside `appAbilityRules` + `staffOrgSlug`; `src/core/abilities.ts`'s `default:` delegates to
  `appAbilityRules`, deny-by-default.

- **2026-07-23 — inbound-email handler registry joins the seam (review finding).** The pre-PR review of
  the ADR-0012 diff found `src/inbound-email/handlers.ts` still hard-wiring the app's `note` handler —
  structurally the same weld as the old `src/jobs/handlers.ts` map the diff had just split, missed
  because inbound email landed after the exploration snapshot. Fixed in the same PR by the established
  pattern: `note-handler.ts` → `src/domain/inbound-note-handler.ts`, registrations in
  `src/app-config/inbound-email.ts` (`appInboundHandlers`), the framework registry composes
  `{ ...appInboundHandlers }`, and `src/inbound-email/**` joined the fence globs. The registry's OPEN
  `Record<string, InboundHandler>` key (vs the jobs union) is unchanged — deliberate, per the
  inbound-email decision that email handler slugs are instance vocabulary.

- **2026-07-30 — the framework package split takes six decisions the ADR left open (PR 2).**
  (1) _Imports inside the package are relative, not self-referential_ — `keel/…` self-reference works
  in TS but adds a resolver dependency the package would carry into any future extraction; relative paths
  resolve everywhere, unaided. Outside the package it is always `keel/<subpath>`.
  (2) _Both an `exports` map and matching aliases_ (tsconfig `paths`, both vitest configs, the demo vite
  build). Aliases are what actually resolve in every tool we run; the exports map is the declared public
  surface and the fallback. Cost: knip treats an exports wildcard as "every file is an entry", so unused
  files/exports inside the package are no longer reported (the app half still is). Enabling
  `includeEntryExports` to win that back produced 25 findings, nearly all migration `up`/`down` pairs
  reached through `import * as` — noise that would have to be silenced with ignores, so it was rejected.
  (3) _`src/inbound-email` moved with the framework_ even though ADR-0012's list omitted it: it was already
  inside the fence and importing through the seam, and leaving it in `src/` would have kept a second
  framework glob alive after the whole point was collapsing to one.
  (4) _The `jobs` i18n caveat is resolved by splitting the namespace_, not by keeping the mixed one: the
  four job-status labels the framework's `JobTimeline` renders became the framework namespace
  `jobTimeline`; the export-card copy stays in the app's `jobs`. The alternative (framework keeps `jobs`,
  app renames) was equal churn and a worse name for app copy.
  (5) _The merged-catalog tests live in the package and reach the app half through the seam loader_
  (`loadAppMessages`), rather than moving to the app side or reaching for `../../../../messages`. So the
  package keeps proving its own guarantee AND the merged one without breaching its own boundary.
  (6) _The mutation-scan resolves the app's route dir from `process.cwd()`_ instead of a relative path out
  of the package — the scan is framework code whose subject is whatever host app it runs in, and its
  "found no mutating routes" case fails loud if the root is ever wrong.
- **The doc set split four ways, and doctrine paths became a gate** (2026-07-30, branch
  `docs/truth-pass-template-hygiene`). The 2026-07-30 framework relocation updated the README, CLAUDE.md,
  CONTRIBUTING, adopting.md and ADR-0012 but left four doctrine documents and all three recipes teaching
  `src/ports` / `src/adapters` / `src/core` — 180 backticked citations pointing at directories that no
  longer existed, with the recipes actively instructing adopters to create ports where the lint fence now
  rejects them. Fixing the paths was the easy half; the durable half is `tests/docs/doc-paths.test.ts`,
  which fails the build when a doctrine doc cites a path that does not resolve. Three design calls made
  while writing it. (1) **Scope by document KIND, not by directory.** ADR bodies, `decision-log.md` and
  `build-notes.md` are dated append-only records whose entries were true when written; rewriting them to
  match today's tree would falsify them, so they are exempt from the gate and corrected opportunistically
  instead. ADRs are amended by dated addendum, which the set already did — that convention is now written
  down rather than merely practised. (2) **A file citation may resolve on its PARENT directory; a
  directory citation may not.** Every recipe names files you are meant to create
  (`…/adapters/real/esign.ts` is the recipe's output), so requiring exact existence would forbid the
  genre. But letting directories take the same fallback made `src/app-confgi` pass on the strength of
  `src/` existing — caught only because the test was deliberately made to fail before it was allowed to
  pass. (3) **Globs and `<metavariable>` placeholders assert only their static prefix**, so
  `…/adapters/<real|fake>/<name>.ts` checks `…/adapters/`. The gate immediately paid for itself by
  catching a stale path in `.claude/commands/repo-health.md`, a file no one had thought to include in the
  sweep. Also split the doc set four ways — doctrine (gated), dated records (exempt), frozen history
  (deletable by an adopter, and deleted at publication), and future tasks (`.claude/future-tasks/`, one
  file per item with a priority index) — because "doctrine vs history"
  had been putting a live troubleshooting reference (`build-notes.md`) and a 1000-line provenance log in
  the same bucket as a frozen build report.
- **The cutover checklist split into a template and a frozen instance list** (2026-07-30, same branch).
  The file described itself as "this instance's live punch list" while also being the only cutover artifact
  a fork inherits, so every adopter started with another team's rows, another team's accounts, and
  another team's name in the "what unlocks it" column. `docs/cutover-checklist.md` is now the rows every
  instance needs, empty and vendor-neutral in the item names (`auth-dev`, `email-inbound`, `llm-key`)
  while keeping the vendor-specific proofs in the deferred-verification column, because that column is
  the point. A filled-in row is kept at the top of that file as the worked example. `config/params.ts` comments were re-pointed at the new row names, and its last piece of
  instance identity (`sentry.org`) became a placeholder like its neighbours.
- **`apps/starter` keeps its seed inside the app, not in a `packages/*` workspace** (2026-07-31,
  `feat/starter-app`). The showcase's world lives in `packages/seed` (`@app/seed`) for historical
  reasons — it predates the `apps/` tree. But the framework never imports it: it reads
  `@app-config/seed`, which re-exports it, so WHERE an app keeps its seed is entirely the app's choice.
  Sharing one seed package between two apps would have been exactly the coupling the second app exists
  to disprove, and an app-local module is one fewer workspace for an adopter to find, rename and
  repoint. It also proves `keel/seed/contracts` is a real published surface rather than a private
  arrangement with one package: `apps/starter/src/seed` fills the same contracts with no `@app/seed`
  anywhere in its graph.
- **Root scripts fan out by directory glob, except the four that must pick one app** (2026-07-31, same
  branch). `pnpm verify` covering both apps is non-negotiable — a green gate that silently skips an app
  is worse than no gate — so `typecheck`, `test:e2e`, `build`, `build:demo-static`, `check:demo-size`
  and `e2e:demo-static` all became `pnpm --filter './apps/*'`, which picks up an added or renamed app
  with no edit to the root. `verify` itself is unchanged: fanning out is a property of the scripts it
  calls, not of the gate. The heavy ones pin `--workspace-concurrency=1`, because two Next dev servers
  and two Chromium fleets on a 10GB VM is the OOM the e2e config already warns about. `dev`, `start`,
  `ladle` and `build:demo` still name `showcase`: a command that starts one server has to choose, and
  saying so in `docs/adopting.md` as a four-line repoint is more honest than a clever default.
  `apps/starter` runs on port 3100 so both apps can be up at once.
- **`apps/starter` ships no Panda and no Sentry** (2026-07-31, same branch). Panda is vestigial in this
  repo — `panda.config.ts` sets only `preflight` and the generated output is imported by nothing, while
  Mantine ships its own reset — so adding it to the starter would have meant 121 committed generated
  files for no behaviour. Sentry is inert without a DSN and is a cutover row. Both are documented in
  `docs/adopting.md` as things to copy from `apps/showcase` when you reach them, rather than dead weight
  in the app an adopter keeps.
- **The showcase became a support desk, and its world starts mid-shift** (2026-07-31,
  `feat/support-desk`). The example app was an excellent coverage harness and a thin product: every
  framework capability had a caller, but the nouns were abstract (`notes`, `org_requests`,
  `artifacts`), the cast was "Ada Admin" in "Alpha Organization", and `packages/seed` seeded **zero**
  product rows — so the demo opened empty and the tour was "click each card" rather than a story. The
  domain is now a desk: `tickets`, `escalations` (two-sided: raising desk ↔ receiving team) and
  `attachments`, run by Northwind Support (a frontline desk, a platform team, a desk-ops operator org)
  with Pinebrook Desk as the second site. The ROLE MATRIX is unchanged — admin / staff / member /
  staff-org operator / guest / restricted, with one multi-org persona — because the ability tests and
  the e2e suite depend on its shape; only the names and the domain moved. Persona IDS were deliberately
  left alone: they are the opaque user ids every table stores, and renaming them would have been churn
  with no reader.
- **Product rows are seeded through an OPTIONAL seam, looked up rather than imported** (2026-07-31,
  same branch). A believable demo needs a queue, an open escalation, an analyzed bundle and an unread
  mail already on the table — and it needs them back after a Backstage world reset, which rules out
  seeding from the app's own boot hook (reset wipes `.data/`, and only the framework seeder re-runs).
  So `keel/db/seed.ts` calls an app-supplied `appSeedRows` last, after its own tables exist. It is
  found by LOOKUP on `@app-config/seed` rather than by a named import, because `apps/starter` has no
  product corpus and a named import would make its absence a build error instead of a no-op — the one
  place the framework tolerates not knowing whether the seam exports something. The hook is handed
  `storage` and `email` as well as the db: a seeded attachment with no bytes is a dead download link,
  and an outbox that starts empty has to be talked into looking used.
- **App notification copy moved to the app catalog, closing the last "edit keel to add an app
  feature"** (2026-07-31, same branch). `notificationCopy` now stamps a NAMESPACE onto the copy it
  returns — `notifications` for framework kinds, `appNotifications` for app-registered ones — and every
  surface that renders a notification (the bell, the email, the SMS, the prefs grid) resolves
  `${namespace}.${key}` through a root translator. This is option 2 of the three the open task listed:
  the framework declares a copy CONTRACT and the app satisfies it entirely app-side. The seam itself is
  unchanged (`appNotificationCopy` still returns bare keys), so an app that registers no kinds — the
  starter — notices nothing. Same treatment for the two other places app copy had leaked into keel's
  catalog: a Backstage ACTOR card is now handed finished strings by the host, like
  `BackstageExtraTab.label`, and an app-registered Scenes FLAG carries a fully-qualified message path.
  Net effect: keel's catalog lost nine app-specific keys and gained none.
- **The assistant answers in two passes so it can stream without lying** (2026-07-31, same branch).
  `llm.stream()` takes no tools — deliberately; a streaming tool loop is a much larger contract than a
  template needs — so the route GATHERS with `runToolLoop` (canned model turns, live tool execution)
  and COMPOSES with `llm.stream()`, forwarding chunks as NDJSON. The compose request necessarily
  carries live ticket facts, so it can never hash-match a recorded fixture and always resolves to its
  purpose's DEFAULT entry. That is the fixture mechanism working as designed rather than a gap, and it
  is why the compose pass has its own purpose: pinning the fall-through there keeps the tool-loop
  purpose's own fallback clean. Live data still reaches the screen — the route returns the tickets the
  TOOLS actually read as the answer's sources, so the prose is replayed and the evidence beside it is
  real. `llm.complete()` got its first caller the same way: the `analyze-bundle` job, whose prompt
  carries a customer's bundle bytes and whose fixture is therefore default-only (recording a per-bundle
  entry would mean committing a customer log file to the repo).
- **Every registry that had one member got a second, chosen to differ in the thing that matters**
  (2026-07-31, same branch). Not two of the same shape: `analyze-bundle` differs from `export-tickets`
  by touching three ports instead of two; `search_tickets` differs from `list_my_tickets` by taking
  model-supplied input (so validation is demonstrated, not assumed); `ticket.assigned` differs from
  `escalation.received` by addressing a PERSON rather than a team's managers (which is why
  `notifyMember` had to be exported); `feedback` differs from `support` by the status the resulting
  ticket starts in; `diagnostic-bundle` differs from `attachment` by being the only kind the analyzer
  will take. A second member that merely copies the first proves the registry has two entries, not that
  it composes.
- **Plays drive Backstage through Backstage, so the deep-link seam was never needed** (2026-07-31,
  `feat/plays`). A play has to put the panel on a given tab, which is exactly what
  `.claude/future-tasks/resolved/simulator-deep-links.md` was opened for (`#backstage=mail:all` or an event bus).
  The engine does it with a `['panel', tabId]` script action instead: if the panel is collapsed it
  clicks the pill, waits for the column, then clicks the tab — idempotent, host-independent, and no new
  state anywhere. Better than the seam for this purpose, not just cheaper: a walkthrough exists to show
  a viewer how they would do it themselves, and a hash that teleports the panel open teaches nobody
  anything. The task is marked RESOLVED with the one motivation it leaves behind (an app-side "open the
  panel here" affordance, which is a callback, not a design).
- **A play's `advance` is the reload boundary, which is why every submission belongs there**
  (2026-07-31, same branch). The house pacing rule (submissions fire on the viewer's Next, never on a
  timer) turned out to have a second, mechanical justification on the server host: restoring a scene,
  flipping a feature flag and switching cast member all reload the page there, and the engine's resume
  marker is written when Next is pressed. So an action that reloads must sit in `advance` (it is
  replayed at most once, on the step it belongs to), and anything in a step's entry `script` must be
  safe to re-run after a reload. The team switch in the showcase play is in a `script` precisely
  because the switcher ignores a click on the active team; the `jobs-held` toggle is in an `advance`
  because a Switch is not idempotent.
- **A play's spotlight lights AFTER its entry script, not before** (2026-07-31, same branch). The
  ported engine set the vignette on step entry, which raced the script that navigates to the thing
  being spotlighted — invisibly at rehearsal speed (the script finished inside the 1.5s wait) and
  visibly at presentation speed, where it timed out and reported a missing target. Attaching after the
  script is both correct and better paced: dim, then halo, once the cursor has arrived. Worth
  recording because the CI run would never have found it: **a speed control means the gate and the
  audience are not watching the same thing**, and only watching it at real speed caught it.
- **Tenant/org 404 resolution consolidated into one helper, replacing 22 call sites across 15
  routes** (2026-07-31, `fix/full-code-review-findings`). A full-codebase review found the same six
  lines — resolve `tenantIdForSlug`, 404 `unknown tenant`, resolve `orgIdForSlug`, 404 `unknown org`
  — pasted across every product route that needs the active org (tickets, escalations, attachments,
  jobs, webhook-endpoints, org invite, notification prefs, assistant). Nothing was wrong yet, but 22
  independent copies of a 404 contract are 22 places it can quietly drift the next time one route's
  error body changes and the others don't. Replaced with `resolveOrgContext`/`resolveTenantId` in
  `apps/showcase/src/app/api/org-context.ts`, called by every route that used to inline the lookup;
  callers return the `Response` verbatim on the `instanceof Response` branch. Same treatment for the
  five copies of the DB-test `ids()` helper (`audit.test.ts`, `jobs.test.ts`, `webhooks.test.ts`,
  `attachments.test.ts`, `escalations.test.ts`), which now wrap the same exported lookups instead of
  hand-rolling the `tenants`/`organizations` queries each carried.
- **The cursor is opaque, canonical, and its own codec** (2026-07-31, `feat/keyset-pagination`).
  base64url over `"<iso-instant>|<id>"`, hand-rolled in `packages/keel/src/core/keyset.ts` for the same
  reason `webhook-signing.ts` hand-rolls SHA-256: the module must run identically on the server and
  inside a `file://` bundle, so no node builtin and no environment-dependent global (`btoa`/`atob` are
  latin1-oriented and their availability is an assumption, not a property of the code). The payload is
  ASCII by construction — both halves are pattern-checked before encoding — so it is a plain byte↔char
  map with no UTF-8 machinery, cross-checked against `Buffer.toString('base64url')` in test. Decoding
  rejects padding, a dangling character, and non-zero padding bits, which makes the encoding CANONICAL:
  one position has exactly one cursor, so a malleated cursor is refused rather than quietly normalised.
- **A malformed cursor is a 400, and validation is split across the two layers that can enforce it**
  (2026-07-31, same branch). `parseKeysetCursor` (pure) validates the transport shape — a strict
  ISO-8601 UTC instant and a bounded `[A-Za-z0-9_-]{1,64}` id — and `parseDbKeysetCursor` adds the one
  constraint only the SQL layer knows: the id must be a uuid, since that is what it will be bound as, and
  a non-uuid could only ever have become a cast error (a 500, and a probe signal) inside the statement.
  Routes over SQL use the second; the static-demo twin uses the first, whose row handles are not uuids.
  The route returns 400 rather than silently serving page one — a cursor the server cannot read means the
  client is confused and should hear about it — but the failure mode if a route forgot that is a repeated
  FIRST page, never a widened one, because scope never came from the cursor in the first place.
  Calendar validation is a round trip, not a parse: JS silently rolls `2026-02-31` over to March 3rd
  rather than reporting NaN.
- **The desk's page size is 5, and the seed grew an archive to make it visible** (2026-07-31, same
  branch). A page size no seeded world ever reaches is a pagination feature nobody can watch working, so
  the frontline queue gained six older resolved tickets (11 total, three pages). Two constraints shaped
  them, both from things that already read the queue: they are all OLDER than the existing five, so page
  one is byte-for-byte the list that was there before paging existed (the ticket play asserts `NW-1028`;
  the SLA banner counts the loaded rows), and they are numbered BELOW `NW-1041`, so the next reference
  the desk issues is still `NW-1042`, which that play says out loud in its narration.
- **A mutation re-anchors the paged queue to page one rather than patching the loaded pages**
  (2026-07-31, same branch). A create lands at the head, a delete leaves a hole, and a status edit can
  move a row — so after any of them the only honest thing to show is what the server says the queue is
  now. The static-demo twin differs, in its favour and deliberately: it holds a page COUNT rather than a
  cursor and re-walks the chain from the start on every render, because the whole world is in memory and
  re-walking is free. A ticket arriving at the head (an inbound email) therefore appears immediately
  without disturbing how far down the reader has walked.
- **Ports are derived per checkout; `workers` stays 1; CI parallelises by sharding** (2026-07-31,
  `fix/e2e-port-isolation`). Three decisions from one investigation. (1) `scripts/ports.mjs`
  derives every port from the checkout path, so a linked worktree under `.claude/worktrees/` gets its
  own and two agent sessions stop adopting each other's dev server — the failure `build-notes` records
  three times. The MAIN checkout keeps :3000/:3100 deliberately, so every runbook and ADR that names a
  port stays true for a human reading it; only worktrees derive. Derivation is a pure function of the
  path rather than a free-port scan because showcase's `test:e2e` is two Playwright invocations that
  must agree without talking to each other. (2) `workers: 1` stays, but the REASON in the config is
  replaced: it was "10GB VM, renderers get OOM-killed", and the measurement says flakes scale with
  parallelism on a 64GB machine too, because every worker shares one `.data` behind one dev server.
  (3) Therefore CI stops trying to buy parallelism inside a shard and buys it ACROSS runners instead —
  the `e2e` job is now a matrix of showcase / showcase-destructive / starter, plus a separate
  `demo-static` job, so wall clock is the slowest shard rather than the sum. Separate runners have
  separate worlds, which is the property that makes it safe. This also supersedes the
  `--workspace-concurrency=1` reasoning above for `e2e:demo-static`, which was never justified: those
  specs drive `file://` with no server and no shared state at all.
- **The Simulator vocabulary: every noun in the panel is now literal.** SUPERSEDES the earlier
  "Backstage naming: the app is the stage, the panel is backstage" entry above, which framed the panel
  as a theatre metaphor. Five renames landed together: Cast → **People** (and `Persona` → `Person`
  through the seed, so the tab and the type finally agree), Scenes → **Snapshots**, Plays → **Tours**,
  Backstage → **Simulator**, `isFakeMode` → **`isSimulated`**. The rule that came out of it is recorded
  in ADR-0012's 2026-07-31 addendum: one proper noun per half (`keel`, `Simulator`), everything inside
  literal. The diagnostic that produced it: a name glossed in the next line of copy is not earning its
  keep — the catalog was already writing "the five seed personas", "Save a snapshot", "Scripted
  walkthroughs" directly beneath Cast, Scenes and Plays.
- **Considered and rejected, so it is not relitigated.** For the PACKAGE: `Theater` and `AllTheWorld`
  — both name the framework after its most vivid surface, the exact mistake ADR-0012 already recorded
  when it rejected `backlot`/`soundstage`; `AllTheWorld` additionally collides with "the world", which
  the simulated half already owns. For the PANEL: Engine Room, Control Room, Cockpit, Bridge,
  Belowdecks, Workbench, Lab, Inspector, World — Engine Room was the runner-up and lost on a fact, that
  the panel exists only when everything is fake, so naming it after real machinery would have been less
  true, not more. For the ACTORS tab: Services, Processes, Counterparties (see the ADR addendum for why
  each fails); Actors stays because it is the actor model, a software term, not a theatre borrowing.
- **Spanish translates the panel name; it did not before.** `Backstage` was left untranslated as a
  proper noun. `Simulador` is translated, because every other tab in that panel is (Personas,
  Instantáneas, Recorridos) and the whole premise of the rename is that the name should need no gloss —
  which "Simulator" does not satisfy for a Spanish reader when an exact cognate exists. Two Spanish
  hazards found doing this and worth remembering: `personas` is an ordinary Spanish word, so a bare
  `personas -> people` codemod silently anglicised eight legitimate strings (caught by diffing es.json
  values against HEAD, now the standard check); and `escena` contains no `scene` substring, so the
  Spanish values needed updating deliberately rather than mechanically.
- **A codemod is verified by grepping for the old token AND its all-caps form.** The case-preserving
  rules used here covered `Foo`/`foo` and twice missed `FOO` — `SCENE_NAME_PATTERN`, `EMPTY_SCENES`,
  and three `PLAYS` in comments — each caught by a case-sensitive sweep afterwards, never by the
  guards. Traps that DID hold, and are worth keeping on any future list here: `cast error` (17 times in
  SQL comments), `personal`, `impersonates`, `refactor`/`factory`/`factor`, `Playwright`, `display`,
  `replay`, `playbook`, `multiplayer`, `error-scenario`, and the generated Panda tokens
  `animation-play-state` / `media-play-button` (which is why `styles/generated/` is skipped outright).
- **The Simulator rename requires wiping `.data`, and nothing persisted is migrated.** The seed person
  ids changed (`persona-admin` -> `person-admin`), and those ids are the opaque user ids every table
  stores — assignees, escalation creators, attachment uploaders, notification recipients, audit
  `actor_user_id`. The framework seeder is guarded by "does this world have any rows yet", so a stale
  world keeps the old ids while sign-in mints the new ones: signed-out sessions and orphaned assignees,
  with nothing crashing to tell you. Wipe `apps/*/.data` after pulling this.
  Deliberately NOT migrated, because this is `isSimulated`-only surface that degrades cleanly and a
  migration for preferences would be more code than the problem: the eight `app-backstage-*` browser
  keys (now `app-simulator-*`, including `app-backstage-play` -> `app-simulator-tour`), the
  `_backstage_viewpoint` cookie, `.data/backstage/` -> `.data/simulator/`, `.data/scenes/` ->
  `.data/snapshots/`, and `.data/auth/personas.json` -> `people.json`. Consequences an existing world
  will show: panel width/tab/collapse reset, the coachmark re-shows, a mid-tour resume marker is
  dropped, previously saved Scenes are invisible to the Snapshots list, and invite-accepted dynamic
  people vanish while `invites.json` (name unchanged) is still read. Every read path defaults cleanly
  and the old tab id is unreachable through the new key, so none of it is a break — it is a reset.

## keel's own tests get a fixture app (2026-07-31, `feat/keel-test-fixture-app`)

- **The framework's test seam lives at `packages/keel/test-fixture`, outside `src/`.** Four tools treat
  `packages/keel/src` as the framework — the ESLint fence, `.jscpd.json`'s `{apps/*/src,packages/*/src}`
  pattern, knip's `includeEntryExports`, and the root tsconfig's `include` — and a fixture app inside
  `src/` would have had to fight all four (most sharply jscpd, where a fixture seed is a near-clone of
  `apps/starter/src/seed`). One directory up costs nothing and weakens nothing; each of the four was
  verified rather than assumed.
- **Exemption staleness in `authorized-mutations.test.ts` is now measured against the FIXTURE tree, not
  the apps.** The alternative was deleting the five exemptions backed only by the demo
  (`profile/`, `assistant/`, `analytics/page-view/`, `auth/accept-invite/`, `storage-upload/`), which
  would have made the map a description of whichever apps happen to be checked out and would delete
  real, considered reasoning the moment an adopter ejects. The fixture backs all eight exact exemptions
  and all three prefixes, so the map stays a statement about the FRAMEWORK's classes of route. What is
  given up is honest and small: an app deleting its own assistant route no longer marks that exemption
  stale. What is kept: every app route is still scanned, still has to call `authorize(...)` or match an
  exemption, and every `mustMatch` gate is still enforced on the file that claims it.
- **The fixture's vocabulary is deliberately unlike either app's** (`harbor`/`lakeside`,
  `depot`/`annex`/`steward`/`wharf`, `fixture-*`, `dockets`, `export-dockets`). Reusing the starter's
  `northwind`/`ops` would have been less typing and would have hidden exactly the regression the fixture
  exists to catch: a framework test quietly reading a host app's world and passing because the slugs
  coincided.
- **`scripts/llm-record.ts` moved into `apps/showcase/scripts/`.** It reads one app's assistant
  registration and writes that app's `fixtures/llm`, so it was app code sitting in a repo-level
  directory; the root program compiling it was the thing that made this visible. Two side benefits:
  `--eject-showcase` no longer needs a special case to delete it, and it is now typechecked against the
  seam it actually runs under.
- **The CSV-escaping coverage moved to the app that owns the code.** RFC-4180 quoting and CSV
  formula-injection neutralization live in `apps/showcase/src/jobs/export-tickets.ts`, but their only
  test was riding along inside keel's fake-jobs suite. That coverage would have died with the move, so
  it became `apps/showcase/src/jobs/export-tickets.test.ts` (driving the handler with stub ports, no
  pglite) and was extended while it was being written — every formula trigger, not just `=`, plus the
  header-only no-team case. keel's test now asserts only the framework's half.
- **No `FRAMEWORK_SUITE_APP` any more.** `vitest.config.ts` had to name one app to carry keel's suite;
  that choice is gone, and with it the reason `init-app` had to rewrite a second literal in that file.

## The starter's leftover content is documented, not gated (2026-10-02, `docs/adopting-starter-content`)

An adopter reported that their product's static demo opened on the starter's tenants and Items card
four days after adoption. `docs/adopting.md` had told them to "keep the shape" of the seed world, they
read that as "keep the fixtures", and built their own world beside the starter's.

- **The fix is the sentence, plus an inventory.** `docs/adopting.md` gains "The starter's content is
  still wired into your UI" — the seed world, `welcome.subtitle`, the Items slice and the static demo's
  composition root, each with where it shows — and `scripts/init-app.ts` prints the same four as their
  own closing section — only when the app being kept has the starter's layout, since `--app showcase`
  keeps an app with neither that seed directory nor an Items slice. The advice is to REPLACE the seed world: only the starter's own two specs and
  `staffOrgSlug` read its names, and all three are the adopter's files.
- **No residue check.** The report proposed a scan for UI code still importing the starter's fixtures.
  There is no symbol to scan for: the seed is one world behind `@app-config/seed`, so starter content
  is identifiable only by its VALUES. A check would need a manifest of those values, which drifts from
  the seed, cannot run in `pnpm verify` (it is red on keel itself by definition), and goes meaningless
  the first time an adopter renames a tenant.
- **No "not offered at sign-in" flag on `SeedPerson`.** The adopter's local fix hid the starter's
  people from the product pickers while leaving them reachable from the Simulator. Putting that in
  `keel/seed/contracts` would make the framework support the arrangement the doc now tells adopters not
  to build — two worlds in one seed — and would touch both apps, the fixture seam and the static demo
  to do it.
- **The printed section is pinned by a test, and the pin checks paths, not prose.**
  `tests/docs/adopter-identity.test.ts` asserts the section is printed and that the seed, seam,
  catalog and demo paths it names exist in the ejected tree. Watched failing with the heading changed
  and one path misspelled.
- **Removing the content by command is deferred**, not rejected:
  `.claude/future-tasks/init-app-blank-option.md`. The seed cannot go to zero and the Items slice can,
  but an app with no tables and no subjects has never been built here, and deleting Items deletes the
  RLS example the scaffolds cite.

## Simulator People `orgs` mirrors `SeedMembership`; actor keep-alive is lazy, then sticky (2026-10-03, `feat/simulator-people-orgs-actor-keepalive`)

- **`Person.orgs` is `{ orgSlug, role }[]`, not the `{ slug, role }` the task sketched.** It is
  `SeedMembership`'s own shape, so both row builders pass `memberships` through untouched. Renaming the
  key needs a call on the array, which trips a misdirected `react-hooks/purity` error in the static twin
  (see build-notes). `role` stays on `Person` so an app that never sets `orgs` renders as before.
- **`keepMounted` is lazy, then sticky, not always-on.** An always-on Actors tab would start its tick
  loops at page load, so every spec and tour would begin in a world that is already moving. Nothing
  mounts until the tab is first opened; from then on it stays mounted, hidden, through tab switches and
  collapse. The collapsed panel keeps its hidden aside at the same tree position, because an iframe
  that moves reloads. Replaced: "a host-built tab's content exists only while that tab is active".
- **Actors off the page stay undecided.** Running an actor with no page open contradicts the stated
  "client-side processes, in same-origin iframes" design and can never work on the `file://` host; it
  stays open in `.claude/future-tasks/actors-as-independent-systems.md`.

## Simulator actors run from page load, held by a world flag; People chips show only what distinguishes (2026-10-03, `feat/actors-always-on`)

- **Actors are always on.** Replaced: the same day's "`keepMounted` is lazy, then sticky". A real
  counterparty doesn't wait for someone to open a Simulator tab, so the Actors tab now mounts from page
  load. Lazy mounting existed only to keep specs and tours quiet; that job moves to an explicit world
  switch, the showcase's `actors-held` Snapshots flag. `ActorShell` asks its host's `held()` before
  every autonomous tick, keeps its schedule while held, and shows a `held` state; a manual Step ignores
  the hold, because stepping is an explicit operator act. Specs that drive held jobs by hand turn it on.
- **The flag is the app's, not the framework's.** Actors are app content (`@app-config/actors`), so the
  switch that holds them is registered on the same seam (`@app-config/simulator` flags). The framework
  supplies only the `held` hook, so an app with no actors — the starter — shows no such toggle.
- **People chips derive from the rows, not from configuration.** Every keel app HAS a tenant and an org
  for every person (the auth port requires both), but many only ever run one of each. The tenant chip
  shows only when the rows span more than one tenant, and the org name only when they span more than
  one org (`people-dimensions.ts`); role always shows. A second tenant or team makes the chip appear on
  its own.

## A `date` column reads as a string, on both engines (2026-10-03, `feat/upstream-date-storage-keyset`)

- **The return type is the wire string, `'YYYY-MM-DD'`, not a `Date`.** A `date` is a calendar day
  with no time and no zone; any `Date` built from it has to pick a zone, and each driver's default
  picks a different one. `pg` builds local midnight, so a server east of UTC hands back the previous
  day once the value is read as UTC (watched: `2026-10-03` came back as `2026-10-02T15:00:00.000Z`
  under `TZ=Asia/Tokyo`). pglite builds UTC midnight, so the fake and the real engine disagreed on the
  same row. The string is also what the schema types already promised (`string`), it sorts and
  compares correctly as-is, and `'infinity'` survives (pglite's default turned it into `null`).
  `date[]` reads as `string[]` for the same reason.
- **Per pool, not process-global.** The real adapter passes a `types` override to its own `Pool`
  rather than calling `pg.types.setTypeParser`, which would rewrite the parser for every `pg` client
  in the process from whichever module happened to load first. Only text-format `date`/`date[]` are
  overridden; everything else falls through to `pg`'s defaults.
- **pglite gets the same override, and the tests use it.** The claim that pglite could not take a
  parser was wrong: `PGliteOptions.parsers` does exactly this. Every pglite the framework opens now
  comes from one factory (`openPglite`, `packages/keel/src/adapters/fake/pglite-dialect.ts`), and the
  pglite RLS suite builds its engine there too. Before this it called `new PGlite()` directly, so it
  proved a configuration the app never ran.
- **keel's fixture got its own contract database.** The proof is a `date` column on the fixture's
  `dockets` table (`1002_dockets_due_on`), and the fixture's migrations had never run on real Postgres:
  the contract runner held a single app. `vitest.contract.config.ts` now has a second project, `keel`,
  aliased at the fixture seam. Its harness
  (`packages/keel/src/adapters/real/db.contract.test.ts`) creates `keel_contract` on whichever server
  it is given and drives the real adapter's `createRealDb`, so the contract run proves the pool
  configuration production uses. Files run one at a time because both harnesses default to the same
  derived embedded-postgres port. The showcase harness is unchanged. It still builds its own `Pool`,
  and with no `date` columns in its proofs that difference is harmless today. Watched failing:
  removing the `date` override, then the `date[]` override, from the real adapter turns the `keel`
  contract project red, and removing pglite's turns the pglite suite red.

## Per-person cloud workspaces: a recipe, not a port (2026-10-03, `upstream-mechanical-bundle`)

A future task proposed a `workspace` port generic over the backend, with its adapter selection gated
independently of `APP_MODE`. It is resolved the other way, as `docs/recipes/workspace-coder.md`.

- **Fails both vendor-code tests.** Almost no instance provisions per-person dev environments
  (universality), and an authenticated REST vendor behind a polled long-running operation is a class
  the LLM, email and webhook-dispatch adapters already teach (new-class).
- **The implementation it was drawn from broke doctrine twice**: it chose its adapter from the
  backend's own env vars rather than `APP_MODE`, and it let product vocabulary into the adapter
  registry. Writing the plan down, rather than lifting the code, is what keeps both out.
- **The one legitimate need survives as an explicit override.** A real backend inside an otherwise
  simulated demo is allowed only as a named, fail-closed switch with its costs stated in the recipe —
  never an adapter that turns itself on because its env vars happen to be present.

## What a derived app's mechanical changes did NOT bring back (2026-10-03, `upstream-mechanical-bundle`)

A derived app's change list was mined for small, mechanical items worth taking back into keel. Four of
them were declined, each for the same reason: keel has no caller for them, and dead exports fail the
gate (`knip`) as surely as dead vendor code fails the doctrine.

- **`BadRequestError` / `ConflictError` in `packages/keel/src/ports/errors.ts`.** The derived app throws
  them from adapters keel does not ship (a workspace backend — now `docs/recipes/workspace-coder.md`,
  which tells an adopter to export their own typed conflict from that port) and maps them in its own
  respond helper. The nearest keel candidate is the fake storage adapter's path-escape refusal, but
  making that a 400 would give the fake a failure mode the real S3 adapter does not have, which is the
  opposite of what a fake is for. Revisit when a real keel adapter has a caller-input failure to report.
- **Optional `themePrimaryColor` / `themeRadius` on `SeedTenant`.** `getTenantTheme`
  (`packages/keel/src/theme.ts`) already falls back when they are missing, but every keel seed world —
  both apps and the fixture — sets both, so optional fields would be a contract widened for nobody.
- **A `label` prop on the user menu.** Generic presentation (text and a chevron beside the avatar),
  not a framework invariant made visible; it fails the component test in
  `docs/development-approach.md`, and no keel shell draws a name in its top bar.
- **Out of scope by choice, not by test:** stopping the invite flow from emailing admins (a product
  decision), a caller-named org for `sendInvite` and the live-org list it needs, a fake-person helper,
  and a package licence file.

## Demo presets are declarative, registered beside the flags, and replayed per host (2026-10-03, `prebaked-demo-presets`)

- **No prebaked `.data/` worlds.** The task proposed a `pnpm snapshots:seed` that drove the fake
  adapters and saved through `saveSnapshot()`. Those copies carry pglite's binary state, so they could
  only ever restore on a server, and the task's own second half asks for the `file://` demo too. Presets
  are a seed-relative script instead (`keel/core/presets.ts`), replayed fresh on each load. Nothing
  binary is generated or committed, and nothing goes stale when a migration changes the database.
  Directory snapshots stay as the server's "save what I clicked together".
- **Registered on `@app-config/simulator`, not a new seam module.** Presets are Simulator content,
  like the flags beside them, and `simulator` is already on ADR-0012's list of value imports. A new
  module would cost every app and the fixture one more file to say nothing in. The starter registers
  `presets = []`; the fixture registers one preset in its own vocabulary, because the server replay's
  test must replay keel's world, not an app's.
- **Three operations: `invite` and `inbound` name their actor and team; `flag` is world-wide.** That set
  covers the task's worlds (a pending invite, unread mail, tenant rows, both tenants busy). App rows
  come in through inbound email, which the app already registers handlers for on both hosts, so
  presets need no app-registered operation kinds yet. That stays a possible extension point; nothing
  needs it today. Operations never mean "whoever is signed in", so a replay is deterministic.
- **Authorization moves to build time.** A replay has no session. Instead of authorizing at replay
  time, `presetProblems` holds every registered preset to the product's own rules: the inviter must
  manage the team, the role must be grantable, no duplicate addresses, and handlers and flags must
  exist. It runs as a seam-conformance test under every app and the fixture. The server replay throws
  on anything it cannot perform, rather than skipping it, because getting that far means the gate was
  bypassed.
- **The invite flow was extracted, not copied.** Everything after the org route's decision to invite
  (mint, audit, email, analytics, admins' notification) is now `keel/server-lib/invite.ts`
  `sendOrgInvite`, shared by the route and the replay. The route keeps authorization, validation and
  the duplicate check, which genuinely differ by caller.
- **The viewpoint is who the restorer sits down as, not captured state.** It is a per-browser cookie
  and the world is shared. A preset may name a seed person, and loading it signs in only the browser
  that loaded it (cookies on that one response). Other browsers keep their viewpoint. If theirs
  pointed at a person the reset removed, they land on sign-in, as after any reset. Viewpoint capture
  for directory snapshots was not added: it would raise the same question with no good answer.
- **One resolution order for a world-start name: `'reset'` → preset → saved snapshot**
  (`resolveWorldStart`), shared by both hosts' tour starts (and the showcase test that checks every tour's
  start). Saving a snapshot under
  `reset` or a preset id is refused, in the UI and with a 403 from `saveSnapshot`, so a tour's
  `snapshot` can never name two worlds. Restore and delete stay permitted, so a snapshot saved before a
  preset took its name is not orphaned.
- **A tour start a host cannot honour is a miss.** `useTours`' `onSnapshot` may now answer `false`.
  The static shell does that for a saved-snapshot name, so a tour that only works on a server fails the
  `file://` walkthrough gate, and a unit test in the showcase says so without building a bundle. The
  server glue's reset/restore/preset handlers answer a promise that settles `false` on refusal and
  never settles on success, because the page is reloading. This also closed a race that predates
  presets: step 1 used to render on the doomed document, and a Next pressed there was lost.
- **A second tour, rather than re-pointing the flagship one.** `invite-from-preset` starts from
  `mid-demo` and walks the pending invite to a member, so a preset start runs end to end in CI. The
  ticket tour keeps `'reset'` and its "press Next to become Dana" opening, which is its first lesson.

## Presets move to their own seam module and gain `extends` (2026-10-03, `presets-own-module`)

- **A seam module of their own.** Replaced: the same day's "registered on `@app-config/simulator`, not a
  new seam module". A list expected to grow to dozens of entries, now with composition, is its own
  registry, and `simulator.ts` goes back to being the panel's tabs and flags. Each preset is one file
  under `presets/`, listed in `presets.ts`. The cost is one more file for the starter (`presets = []`)
  and the fixture, which is now an 18-module seam.
- **Single inheritance only.** A preset has at most one `extends`. A list of bases raises ordering and
  conflict questions (whose viewpoint wins, whose duplicate invite) that nobody needs answered yet. The
  rule today is the plain one: base operations first, the nearest viewpoint wins.
- **`operations` is optional.** A preset can differ from its base by viewpoint alone ("mid-demo, signed
  in as someone else"), without restating the script.
- **Validation runs on the expanded list.** `presetProblems` checks what actually replays, so a duplicate
  invite split across a base and its child is caught, and a child that overrides a bad viewpoint is not
  blamed for it. The price is that a base's own problem repeats under each child, and operation numbers
  count in the expanded list.
- **A consequence in the showcase.** `multi-tenant` now builds on `mid-demo`, so it also contains
  Jordan's pending invite, which it did not before. The static-shell spec that proved "loading another
  preset is a reset underneath" by Jordan's absence now proves it with a hand-made flag flip instead.

## Preset operations become a registry keel and the app both extend (2026-10-03, `preset-operations`)

- **The operation kinds are a registry, not a closed union.** `invite`, `inbound` and `flag` were a
  union in `keel/core/presets.ts` that each host replayed with its own hard-coded `switch`, so an adopter
  could neither add a kind ("assign a ticket") nor make a preset follow a customized invite flow. Now keel
  contributes its kinds, the app registers its own on the seam (`appPresetOperations`, typed by an
  `AppPresetOperation` union composed like job kinds), and each host dispatches every step through ONE
  function that looks the kind up: `performPresetOperation` on the server, its twin in the static world.
- **Three parts per kind, never in one module.** A pure DEFINITION (argument schema, the product rules
  as `check`, the named results it `consumes`) on `@app-config/presets`; a SERVER half on the new
  server-only `@app-config/preset-operations`; a STATIC half supplied by the static composition root
  through `DemoWorldOptions.presetOperations`. The split is physical, not stylistic: a server half
  reaches `server-only` modules and pglite, and the `file://` demo is one browser bundle that fails to
  load with either inside it. It is the same split inbound email already had (server registry vs the
  static twins in `inboundHandlers`). The bundle carries no `pglite` string after the change.
- **Replacement by kind name.** Definitions and both halves compose `{ ...framework, ...app }` keyed by
  kind, so an app entry named `invite` replaces keel's. keel's server halves are published
  (`keel/server-lib/preset-operations`) and its static halves reach an app half through the context's
  `framework` map, so a replacement can WRAP keel's behaviour instead of copying it — the fixture's `flag`
  does exactly that, and keel's replay test proves the app entry is the one that ran.
- **Standard Schema, with Valibot for keel's own kinds.** `PresetOperationDefinition.args` is typed
  against the Standard Schema v1 interface, vendored as types only (`keel/core/standard-schema.ts`), so
  an app may write its kinds in Zod or ArkType. keel's three kinds, the fixture's and the showcase's use
  Valibot, which makes it a new runtime dependency of `keel/core` (allowed: the core fence bans
  frameworks and vendor SDKs, not small pure libraries). Valibot over Zod for the static demo's byte
  budget: Valibot is standalone functions a bundler can keep one at a time, where Zod's default API
  hangs its methods on schema classes (Zod was not measured here). Measured: the showcase's `dist-demo/index.html` went from 938,049 to 942,766 bytes (+4,717;
  budget 950,000, unchanged), the starter's from 849,632 to 853,371 (+3,739). About 3 KB of each is
  Valibot's four schema constructors and issue plumbing, which the bundler keeps although the static
  world never calls them (no host validates at replay time; the conformance gate does): annotating the
  schema calls `/* @__PURE__ */` brought the showcase to +1,690 in a trial, and was not adopted because
  every app author would have to repeat it on every nested call.
- **Shape in the schema, rules in `check`.** keel's `invite` schema accepts any role (`v.picklist(ROLES)`)
  and any string as the email; "cannot be granted by invite" and the email shape stay in `check`, with
  their old sentences. A preset asking for `admin` is a product rule being broken, and the gate should
  answer with the org screen's own words. `check` runs only once the shape passes, and it receives the
  script's earlier valid operations (`earlier`), which is what the duplicate-invite rule always needed.
- **Named results.** An operation may say `as: 'refund'`; the id of what it created is bound to that
  name for the rest of the replay, and a later operation names it in an argument its kind `consumes`.
  Each host keeps its own name → id map (a uuid on the server, the twin's id in the static world), so a
  script never holds a host's ids. `presetProblems` holds names to be unique and bound EARLIER; an
  unbound name throws on the server and settles the static replay false. For `inbound` to produce a
  name, a handler's 'handled' result (and the static twin's) gains an optional `subjectId` — the row it
  created — which intake passes through on `IntakeOutcome`. Additive: no existing handler had to change,
  and the compose route's response simply gains the field.
- **Operations, not a bus, for product code a preset drives.** The showcase's `ticket.assign` does not
  re-implement assignment or post an event a listener reacts to. The PATCH ticket route's post-authorize
  body — write, `ticket.assigned`/`ticket.updated` audit, the assignee's notification — moved, with the
  session's user replaced by an explicit actor, into a named domain operation, `applyTicketChanges` (`apps/showcase/src/domain/ticket-changes.ts`),
  which the route and the preset's server half both call; the route keeps parsing, validation,
  `requireUser`, org resolution, the org-scoped lookup and `authorize(...)`. The core takes the ticket
  as the caller resolved it, rather than its id, so the org-scoped lookup cannot be skipped and the
  route makes no extra read. The static twin got the same treatment (`applyDemoTicketChanges`, shared
  by the ticket card and the static half). The route's unit suite passed unchanged across the move.
- **Coverage where each half lives.** The seam-conformance suite holds definitions and server halves to
  each other both ways under every app. Static halves are built at runtime by the composition root, out
  of a unit test's sight, so the static-shell e2e loads every registered preset and waits for its
  "Preset loaded" notice: a kind with no static half settles the replay false and the notice never comes.

## Holding one actor is a preset operation kind, answered per actor (2026-10-03, `preset-actor-holds`)

The Simulator's actors have had ONE hold, the app's world-wide `actors-held` flag. A demo preset can now
hold a single counterparty (`{ op: 'actor.hold', actor: 'partner-desk', held: true }`), which `multi-tenant`
uses: the outsourced desk has gone quiet, the bundle analyzer keeps running.

- **An operation kind, not a field on `DemoPreset`.** A `holds: [...]` field would have been a second
  mechanism beside the script, with its own replay path on each host and no place in the ordered, named,
  recordable list a preset already is. As a kind it reuses all of it: the same conformance gate, the same
  `extends` composition (a child can release what its base held), and the same two halves. It also
  prepares the next step. Per-actor scenario settings (an actor that fails a given share of its calls,
  say) become more fields on the SAME per-actor world state this slice adds, and more operation kinds
  or arguments over it, rather than another channel.
- **World state is a per-actor map.** Server: `readActorHolds`/`setActorHold` in the fake Simulator state
  (`keel/adapters/fake/simulator`), persisted at `.data/simulator/actor-holds.json`. That directory is
  already a LIVE_DIR, so reset, save and restore cover it with no new code, and a test proves each. Static:
  `actorHolds` in the in-memory world, cleared by `resetWorld` and exposed on `DemoWorld`.
- **The server host asks one question per tick.** The actor frame used to fetch every flag from
  `GET /api/simulator/flags` and pick `actors-held` out. It now calls `GET /api/simulator/actors/held?actor=<id>`,
  which answers `{ held }` for exactly that actor: the world-wide flag OR its own hold. The flags route stays
  (its POST is how the Snapshots tab and the specs flip a flag; its GET, the read-out of every flag, has no
  caller left in this repo, and was kept rather than removed in a slice about something else). The static host computes the same OR in memory
  (`actorsHeld || actorHolds[id]`).
- **The framework still does not value-import the actor registry at runtime.** keel's `actor.hold` `check`
  needs the registered ids, so `PresetWorld` gains `actors`, derived in the seam-conformance suite from the
  seam's `actors` list. That is a value read by a TEST only, but it means `@app-config/actors` is no longer
  type-only: the starter registers `actors = []` and the fixture one actor, `fixture-tug` (ADR-0012
  addendum). Neither host's half validates the id at replay, since neither could without that import; an
  unknown id would write a hold nothing reads, and the gate rejects the preset first.
- **Deferred: an Actors-tab toggle.** A per-actor hold switch in the Snapshots or Actors tab is a natural
  follow-up (it would call a route that writes the same file, and the static twin would set `actorHolds`).
  Not built here: the slice's job was the preset path, and a toggle needs its own copy in both catalogs and
  its own specs.
- **Measured:** the showcase's `dist-demo/index.html` went from 942,766 to 942,996 bytes (+230; budget
  950,000), the starter's from 853,371 to 853,483 (+112).

## Demo presets: final-review fixes before `main` (2026-10-03, `presets-main-sync`)

- **A replay that cannot finish says so, on both hosts.**
    - **Static demo:** an abandoned queue now pushes `noticePresetFailed`, rather than leaving the "World reset" notice over a half-replayed world.
    - **Server:** a refused or failed load shows the same notice and does NOT reload. Reloading would show the reset world, but it would also hand a waiting tour to its resume marker, so the tour could never record the miss. The notice tells the viewer the world is only partly set up and to reset it.
- **The server replay holds the world lock across the reset AND the script** (`resetWorldThen` in `keel/adapters/fake/simulator-admin.ts`). Before, the lock covered only the reset, so a second load arriving mid-script wiped the first one's world under it. A test running two loads at once was seen failing without the lock.
- **A throwing inbound handler twin is filed `failed`**, as the server intake files it, instead of escaping the static replay.
- **The static shell tracks the in-flight load.** The Snapshots tab's "one world rewrite at a time" is now true on the `file://` host too, not only on the server.
- **A tour start that rejects outright is a recorded miss,** never an unhandled rejection that leaves a resume marker for a tour that never began.
- **CLAUDE.md no longer counts the fixture's seam modules.** The number had no stated counting rule: top-level files, `db/` files and `presets/operations/` files each gave a different answer, and it drifted three times in one day. The sentence now says what the fixture registers: every `@app-config/*` module the framework reads.
- **`main`'s role check (`isAssignableRole`) lives in the static `sendInvite`**, the path that mirrors the route, not in the shared `inviteInto`. A preset's invite is held to the same rule at build time, by the `invite` kind's check.

## Demo size budgets re-based, and the starter's is the adopter's (2026-11-16, `demo-size-headroom`)

Requested by an adopter whose ejected app sat at 873,581 of its 880,000-byte budget with one small screen.

- **Prune the demo's CSS instead of raising a budget.** The budget file's rule is that its tightness is
  deliberate, and the growth since 2026-08-01 (+18,787 showcase, +10,061 starter) was mostly the presets, a
  feature. But the most avoidable thing in the artifact was never growth: the dead 15% of it, rules of Mantine's whole stylesheet that no shipped component can match.
  Removing what no shipped component can match is a smaller change in what the artifact IS than raising the
  number 25 KB and calling the next 25 KB a decision. Rejected: per-component CSS imports (a hand-kept list
  whose misses are silent), and trimming only what grew.
- **Budgets went down.** Showcase 950,000 → 840,000, starter 880,000 → 820,000, each below its unpruned
  size, so the savings are not slack and a regression in the pruning is a red gate. The showcase keeps ~3%
  headroom on purpose, as the Tours raise did.
- **The starter's budget is the adopter's, and is sized for them.** An adopter inherits it. A budget kept
  3% over the framework's own size is 3% for their first screens. So the two apps' numbers now have two jobs: the showcase's paces the
  framework (every framework screen and twin is in it, so a framework change costs bytes there first); the
  starter's lets the starter grow to the showcase's size before it asks anything, and still fails on gross
  bloat and on the pruning stopping. Rejected: a gate that
  separates framework baseline from app growth (the bundle has no such attribution, and the adopter wants
  a ceiling, not a ledger); a tight starter budget plus a note (red on their second screen); raising 880,000.
  **JP's call to overrule:** if the starter's number should pace as tightly as the showcase's, set it to ~745,000 (721,386 plus 3%).
- **Prior art, and what changes.** The 2026-10-03 entry "Standard Schema, with Valibot for keel's own kinds"
  measured ~3 KB of valibot in each demo and accepted it (`/* @__PURE__ */` on the schema calls was tried and
  rejected: every app author would repeat it). Building keel's own definitions by function takes keel's share
  out without asking an author anything. An app's own definition still pays ~2.8 KB.
- **The gate warns under 2% headroom** and says what to do, on CI as a workflow annotation. It passes: the
  cue to look while it is cheap. It would have fired through the whole of the presets work.
- **`init-app` should say whose number it is.** `scripts/init-app.ts` is PR B's, so this is the proposed
  wording for its "WHAT THIS DID NOT TOUCH" list, where it names deployment parameters and the cutover
  checklist:

    > • The demo size budget — apps/<slug>/package.json's `check:demo-size` passes the static demo's byte
    > budget. It is yours now: the starter ships it with room to grow to the showcase's size, which is
    > sized for an app's own screens, not for the framework's pace. Re-set it when you want a tighter
    > gate (what your app measures plus the headroom you want, in its own commit). When it goes red,
    > scripts/check-demo-size.mjs says what to look at first.

- **Not done.** An app's own preset operation definition still ships in its demo (~2.8 KB on the showcase);
  fixing it is a seam change for 0.3% of the file, recorded in
  `.claude/future-tasks/resolved/demo-size-budget-headroom-thin.md`. The Next apps still serve the whole
  Mantine stylesheet; nothing gates their page weight.

## Adopter papercuts: the repo name, the identity gate, one-tenant seeds (2026-11-16, `fix/adopter-papercuts`)

Four gaps a first adopter reported, decided together. Each is a small change; the reasons are the part
worth keeping.

- **The repo name is a flag, `--repo`, and a placeholder without it. It is not read from `git remote`.**
  `init-app` wrote the app's slug into the repository position of the advisory and discussions links, which
  is right only when a repo is named after its one app (an app `console` kept in a repo `pages` got
  `…/console/security/advisories/new`, a link that 404s and looks plausible). Rejected: deriving it from
  `origin`. At adoption time that remote is often still the template, or a fork under its default name, so
  the derived value would be plausible and wrong with nothing to flag it, and `--dry-run` would print a
  different plan on each machine. The flag takes the NAME only (not `owner/name`, because the owner also
  fills CODEOWNERS, where it may be a team). Without it the links carry `PLACEHOLDER_GITHUB_REPO` beside
  `PLACEHOLDER_GITHUB_OWNER`, which the closing output names and `git grep` finds. "I forgot the flag" is a
  re-run: `pnpm init-app --repo <name>` alone replaces the placeholder segment in the three files (whatever
  the owner says by then, since filling the owner first is the natural order) and does nothing else; it
  refuses on a tree init-app has not adopted, where it would scrub the identity and nothing else. On links that already
  name a repository a `--repo` is reported as ignored, and the summary and closing text are driven by the
  state the run found in the files, not by the flag, so they never claim a change that did not happen.
- **`tests/docs/adopter-identity.test.ts` classifies its tree before asserting, rather than skipping.** It
  ran `init-app acme --eject-showcase` on a copy of whatever tree it was in and asserted what the rewrite
  produced. In an adopted tree the rewrite has nothing to replace (it replaces the template's literals),
  so the assertions read the adopter's own files and went red on their slug and, once filled in, their
  owner. It was green in the `adoption-probe` job only because that job also adopts as `acme`. The test
  now runs the `init-app` suite only in the pristine template, which it recognises by STRUCTURE
  (`apps/showcase` exists and the root package is still `keel-workspace`; every adopting `init-app` run
  renames the root or deletes the showcase). Everywhere else it checks the real files directly: none may
  name the template's maintainer, which is also the check that catches an upstream merge adding a
  `@jpslav`-owned line to an adopter's CODEOWNERS. In the template all four must name him. The first
  version recognised the template by the identity strings themselves, and review found the hole in that:
  move the maintainer's identity in the four files and nothing else, and every file reads as "adopted", the
  suite switches itself off and `init-app` silently stops scrubbing anything. A sentinel comparing the
  test's constants with `init-app`'s literals was added to patch it, then dropped once the structural
  test made it redundant (and it was red in adopters who scrubbed the script). Exact-spelling matching is
  deliberate: the template's files use one spelling and the rewrite is a literal replace.
  Rejected: skipping on "`apps/showcase` is absent" (the probe's ejected tree has none, so it would switch
  the gate off where it is meant to run), and having `init-app` delete the test (ADR-0013 makes updates a
  merge, so a file deleted in the fork and edited upstream is a modify/delete conflict on every merge).
- **ADR-0004's two-seeded-tenants rule is scoped, by an addendum, with no new gate.** keel's own apps and
  multi-tenant adopters keep two; a one-tenant-per-deployment app may seed one if its RLS proof half still
  uses two tenants. Nothing in the framework reads the seed's tenant count, and the proof runner makes its
  own two tenants per run, so the seed cannot starve a proof. No cheap check says whether an app's proof half
  crosses a tenant boundary (a comment satisfies a presence check, and an app with no tables legitimately has
  an empty half), so it stays a convention, and `/new-entity` and `/new-slice` now say to write the
  table's proof section with both tenants. That convention was not written down anywhere before.
- **`CLAUDE.md` said the authorization scan walks `apps/*/src/app/api`; it walks the whole
  `apps/*/src/app`.** The behaviour was right and stricter than the sentence: a mutating `route.ts` outside
  `api/` is scanned and, since exemption keys are measured from `src/app/api`, can match no exemption.
  Watched failing with a bare `POST` at `src/app/[locale]/danger/route.ts`.

## App-owned vendor adapters (2026-11-16, `feat/app-owned-adapters`)

- **An app may own a port, fake and real adapter, and the vendor zone is `apps/<app>/src/adapters/real/`,
  not the whole adapters directory.** An adopter asked for a lint-allowed `apps/*/src/adapters/`. The
  narrower zone keeps the app's registry and fakes under the same vendor and `process.env` bans as the
  rest of the app, which is what makes them hermetic by construction. ADR-0012's 2026-11-16 addendum has
  the full fence and the rejected alternatives.
- **Declined: a key-value port in keel.** It was offered as the alternative and fails both the
  universality and the new-class tests.
- **The app's real adapters read `process.env`, not imported `params.ts` values.** keel's own real adapters
  already work this way, and secret values cannot live in the repo. `params.ts` keeps recording names,
  placeholders and cutover rows.
- **A static import of an app's `adapters/real` is banned outside the adapters directory, and `import()` is
  not.** The dynamic form inside an `!isSimulated` branch is how keel's own real-mode sign-in form is
  loaded, so banning it would forbid the one legitimate case. Inside the directory it is stricter: the
  registry reaches `real/` only by `import()`, and a fake not at all, statically or dynamically. The
  pre-PR review found the static gap (and the first version's registry test passing vacuously); review
  round 1 found the dynamic one, in that fix.
- **`process.env` is now banned in `apps/*/config/` too.** Nothing there read it, and without the ban it was
  the obvious place for a helper handing the registry its own reading of `APP_MODE` (pre-PR review).
- **The app's registry does not import `server-only` itself.** It takes `isSimulated` from
  `keel/adapters/index`, which imports `server-only`, so the guard arrives transitively. Neither app lists
  `server-only` as a dependency, and knip flagged it as unlisted when a scratch registry imported it
  directly.
- **No lint rule keeps a registry out of the static demo.** The import arrives transitively in practice,
  which lint cannot follow. The measured backstop is `check:demo-size` (54 MB against 880,000 bytes on the
  starter) and then the static e2e.
- **No worked example in the starter or the showcase.** A recipe (`docs/recipes/app-owned-adapter.md`), an
  updated `/new-port` and a lint gate test (`tests/lint/app-owned-adapters.test.ts`) instead. The recipe was
  checked by building a scratch port, fake, real adapter and registry in the starter: typecheck, lint and
  knip passed, and the same files still lint clean under the final config. The scratch files were never
  committed.
- **Recipes that predate this** (`e-sign.md`, `workspace-coder.md`) still put their ports in keel's tree.
  Each now says the app-owned alternative exists. Retargeting them fully is a follow-up
  (`.claude/future-tasks/retarget-vendor-recipes-app-owned.md`).

## Storage port: `copy(from, to)` (2026-11-16, `storage-copy`)

Requested by an app that stages uploads and finalizes them by copying into place. Without a copy it reads
and re-`put`s every file, which in a deployment streams each one through the app's Lambda. It is a generic
primitive (S3 `CopyObject` server-side; a file copy in the fake), so it passes the universality test.

- **The port has no tenant scoping of its own, so `copy` has none.** Keys are full keys the CALLER builds
  server-side (`attachments/<tenantId>/<uuid>/<name>`, `apps/showcase/src/app/api/attachments/route.ts`);
  `put`, `get`, `list` and `delete` never look inside one. `copy(from, to)` takes two keys of the same kind
  and likewise inspects neither: a stage-then-finalize flow builds both from the same tenant. What the
  port DOES guarantee is that a copy never leaves the store: the real adapter's source bucket is always its
  own (`other-bucket/x` is the key `other-bucket/x` of THIS bucket), and the fake resolves both keys inside
  its store directory and refuses an escape in either.
- **A missing source throws `NotFoundError`, where `get` returns `null`.** `get` has a natural "nothing"
  to return; `copy` has none, and a silent no-op would let a finalize step carry on and report success for
  a file that was never put in place. Both adapters throw it; the real one maps only S3's `NoSuchKey` to it (a
  missing bucket is a misconfiguration and is not reported as a missing object).
- **An existing destination is overwritten**, as `put` does and as S3's `CopyObject` does, so a retried
  finalize converges. `copy` does not delete the source; "move" is `copy` then `delete`, and there is no
  `move` method because S3 has no atomic move and a method of that name would hide the gap between the two.
- **`from === to` is refused on both**, before any request on the real adapter: a copy onto itself changes
  nothing, and is nearly always two keys built the same way by mistake. (The fake compares resolved paths, so
  `a/../a` is the same key there; S3 would see two keys. That is the fake's existing quirk for every method.)
- **The real adapter encodes `CopySource` per path segment**, with `encodeURIComponent` on each and the
  slashes left alone, and sends `MetadataDirective: 'COPY'` so the content type and user metadata carry
  over. The SDK does not encode `CopySource`; `encodeURI` leaves `+`, `?` and `#` alone, and encoding the whole
  key turns every `/` into `%2F`. The test asserts the exact input for a space, a `+`, non-ASCII, `?`, `%`,
  `#`, `&`, `;` and empty segments.
- **Over 5 GB it fails with a clear error; multipart copy is not implemented.** AWS's CopyObject reference
  gives 5 GB for one call and `UploadPartCopy` above it. A multipart copy (parts, plus carrying the content
  type and metadata by hand and aborting on failure) is a real feature with its own failure modes. The port's
  upload ceiling, `UploadConstraints.maxBytes`, is the app's own, so an app that accepts uploads above 5 GB
  cannot copy them with this method and should keep `maxBytes` below it. The error is mapped from S3's
  wording, which has not been seen from a real bucket (the cutover row says how to prove it).
- **The fake stages both copies, then publishes.** Each file is copied to a temp name beside its destination;
  only when both exist whole are they renamed in, the sidecar first and the body last, so a key exists (to
  `get` and `list`) only once complete and with its content type in place, and a failure or a source deleted
  mid-copy leaves nothing behind. A directory is not an object, so it is a missing source.
  Known gaps, all of the fake: over an existing destination the content type changes a moment before the
  bytes; a body that cannot be published after its sidecar was (a destination that is an existing directory)
  leaves a stray sidecar, invisible to `get` and `list`; and a source rewritten while it is copied can pair
  one version's bytes with another's content type, where S3 snapshots an object. `put` has the same gap
  between its own two files, and this is a fake.
- **No static-demo twin:** the static demo implements no storage port, so there is nothing to mirror. **No
  IAM change:** the app role's `grantReadWrite` already covers `s3:GetObject*` on the source and `s3:PutObject`
  on the destination, plus the `s3:List*` that (per AWS's GetObject reference) makes a missing key a 404 and not
  a 403. Cutover row
  `storage-copy` carries what only a real bucket can prove.
- **How an app calls it** (stage, then finalize):

    ```ts
    // at finalize, with both keys built server-side from the same tenant:
    await storage.copy(stagedKey, finalKey) // NotFoundError if the staged file is gone
    await storage.delete([stagedKey]) // idempotent, so a retry after this line is harmless
    ```

    A retry after a finalize that failed between the two calls re-copies over `finalKey` and converges; a retry
    after both succeeded gets `NotFoundError` from `copy` (the staged file is gone), which the caller reads as
    "already finalized" by checking `finalKey` exists.

## `init-app` says the demo size budget is the adopter's (2026-11-16, `fix/init-app-demo-budget`)

- **"WHAT THIS DID NOT TOUCH" gains a bullet, after the cutover checklist.** It is the line the demo-size
  headroom work proposed (`.claude/future-tasks/resolved/demo-size-budget-headroom-thin.md`), built from the
  survivor's own `check:demo-size` script instead of fixed text, because what is true depends on it. The
  starter passes a number, which is stated back as read from `package.json`; a survivor that passes none
  (a renamed showcase) is told `DEFAULT_BUDGET_BYTES` is its budget and that it is thin on purpose; an app
  without the script, or whose script is neither of those two shapes (a number then more shell, a quoted or
  underscored number the script would reject), gets no bullet rather than a wrong one. `<slug>` is the survivor's directory name, as everywhere else in that
  list. The "roomy on purpose" wording is only used where a number is passed, since that is the starter's.
  The proposal's "room to grow to the showcase's size" is dropped: after an eject there is no showcase to
  measure against.
- **A note, not a rewrite, for `scripts/check-demo-size.mjs` after an eject.** Its header is two apps'
  history plus a measurements table, and `DEFAULT_BUDGET_BYTES` (the showcase's) goes unused by a survivor
  that passes its own number. `ejectShowcase` used to rewrite one phrase there ("the showcase's size" to "the reference
  app's size"), which left line 2 saying the reference app measures 814660 bytes, a number nothing in an
  ejected tree has. That rewrite is removed and the script is left exactly as the template has it. Rewriting
  any of it is the false-sentence trap `.claude/future-tasks/eject-rewrites-prose-into-false-sentences.md`
  describes, so the bullet says the header and the default describe the showcase you removed and only the
  number you pass counts. The sentence appears only when the showcase is gone.
- **Pinned in `tests/docs/adopter-identity.test.ts`.** The number is read back from the probe's own
  `package.json`, so a change to the starter's script fails the test rather than leaving the output wrong; the
  removal sentence is checked present after an eject and absent after a rename; the script must still carry
  `DEFAULT_BUDGET_BYTES` and `WHEN IT GOES RED`; the no-number branch is reached by a `--dry-run` rename
  of the showcase; a script that is neither shape gets no bullet; and a renamed showcase counts as still
  there on a dry run and a real one alike. Each was watched failing against a deliberate break.

## Catching up October's minor-and-patch group (2026-11-16, `deps/catch-up-2026-11`)

- **keel's peer floors move with the apps' floors.** Dependabot's group PR (#30) raised `next`,
  `next-intl`, `react` and `@mantine/core` in the root and both apps but left `packages/keel`'s
  `peerDependencies` at the old floors. Before it, each of the four peer floors was the floor the apps
  named. Leaving keel's lower is what kept the old `next-intl` and `@mantine/core` in keel's part of the
  lockfile (build-notes, same date, has the mechanism). keel's peer ranges now match the apps' again:
  `^16.4.6`, `^4.14.9` and `^9.7.3`, and `react` at `~19.2.8` for the hold below. A lower floor would
  mean something only to a consumer installing keel from a registry with an older host, and nobody does:
  `packages/keel` is `private` and ships by fork and merge (ADR-0013).
- **next 16.4.6, not the group's 16.4.2.** GHSA-mfr8-8qww-v76h (medium, published 2026-11-16) covers next
  16.3.0 through 16.4.4 and is fixed in 16.4.5. keel calls neither `'use cache'` nor `unstable_cache`, so
  its code was not exposed, but 16.4.2 is the version `next dev` stopped on (build-notes). 16.4.6 is the
  newest 16.4 patch and was published on 2026-11-09, past the two-day `minimumReleaseAge`.
  `@next/eslint-plugin-next` moves with it.
- **`@axe-core/playwright` is held at `~4.12.1`.** The group took it to 4.14.0, whose `axe-core` turns
  on `label-content-name-mismatch` by default. Twelve showcase e2e tests then failed on that one rule,
  on four framework controls whose `aria-label` replaces their visible text. The finding is real (WCAG
  2.5.3, Level A), but fixing it means choosing new accessible names in two locales, which is a11y design
  work rather than part of a dependency catch-up. The tilde keeps the hold through a lockfile
  regeneration: with 4.14.0 already in the lockfile, `^4.12.1` resolved to 4.14.0. The fix and the way to
  lift the hold are in `.claude/future-tasks/label-in-name-axe-4-14.md`.
- **`react`, `react-dom` and their types are held at 19.2 (`~19.2.8`, `~19.2.17`, `~19.2.3`).** The group
  took React to 19.3.1, which put the showcase's static demo at 845,719 bytes, over the 840,000 budget
  re-based the same day (starter 755,326 of 820,000). With only `react` and `react-dom` pinned back to
  19.2.8, the showcase built at 816,387 and the starter at 725,995: React was about 29 KB of the
  showcase's ~31 KB growth. It is React's own code, not something keel can trim: react-dom's
  `cjs/react-dom-client.production.js` is 536,016 bytes in 19.2.8 and 625,168 in 19.3.1. Taking it means
  raising the showcase budget, which the budget's own rule reserves for a feature
  (`scripts/check-demo-size.mjs`, "WHEN IT GOES RED"), so that is JP's call.
  Until then the tildes keep 19.2 through a lockfile regeneration. keel's `react` peer is `~19.2.8` too,
  the same range the apps name. Holding React back took one more lockfile regeneration (build-notes,
  same date).
- **Next's generated `AGENTS.md` is switched off (`agentRules: false` in both apps' `next.config.ts`).**
  With next 16.4, `next dev` writes `apps/<app>/AGENTS.md` whenever it detects an AI coding agent, and
  the block it writes tells the agent to commit the file. CI is not an agent and never sees it, but every
  agent's `pnpm verify` starts `next dev` for e2e, so the file appeared untracked in agent worktrees, one
  add-everything commit away from landing in a PR. keel's agent guide is the root `CLAUDE.md`, so a
  second, generated one in each app is not wanted. The Next docs the block pointed to still ship with the
  installed version, under `node_modules/next/dist/docs/` (resolved from an app directory). The manager
  session that ran this catch-up decided this on JP's behalf; JP can overrule it when approving the PR.
- **Next's upgrade advisor is switched off (`experimental.agentUpgrade: false` in both apps).** next 16.4
  added it with the default `'security'`: every `next dev` outside CI queries npm's advisory feed, as does
  `next build` when an agent runs it or the CLI can prompt at a terminal, and an agent's run stops when an
  advisory matches (build-notes, same date). The CLAUDE.md hard rule that `pnpm dev` makes no network calls
  decides this, so it is not a new choice. It does not make `pnpm dev` offline: the dev overlay's version
  check, which next 16.2 already had, still fetches `next`'s dist-tags. Advisories now have to reach keel
  another way, through Dependabot security updates (currently off in the repository settings) or review.

## Lint fences cover every extension; carve-outs name what their runner loads (2026-11-16, `fix/lint-fence-gaps`)

- **Fence globs take their extensions from one constant, `SRC_EXT`.** They named `{ts,tsx}`, so a `.mjs`
  file in `apps/*/src`, `packages/keel/src` or keel's test fixture got past the vendor, `process.env` and
  `getDb` bans. `SRC_EXT` lists all eight extensions ESLint lints here, `.mts` and `.cts` included.
- **Carve-outs do NOT use `SRC_EXT`.** A test carve-out names what vitest runs (`*.test.{ts,tsx}`), the story
  carve-out what Ladle loads, the `next.config` carve-out the four names Next reads, the instrumentation one
  Next's default `pageExtensions`. Widening each to every extension was the alternative. It was rejected
  because a `.test.mjs` that vitest never runs is an ordinary module a route can import.
- **The app's registry stays `adapters/index.ts` by name.** An `index.mjs` beside it is one more module
  that may not load `real/`. Widening the registry exemption across extensions was the alternative. It was
  rejected because the recipe names one file, and a second registry-shaped file is the thing to catch.
- **Selectors that implement one rule travel as one array** (`getDbSelectors`, `runModeEnvSelectors`),
  replacing re-listing them one by one. Re-listing is what let the a11y block drop the computed `getDb` form.
- **Tests under an app's adapters directory stay exempt from the dynamic `real/` ban**, as they are from
  the other syntax bans there. A story beside a fake was given it back, since the static form was already
  banned in stories.

## The RDS Data API transport (2026-11-16, `feat/rds-data-api-dialect`)

- **JP decided, 2026-11-16: it lives in keel, as an opt-in.** Tenant isolation through any transport is
  keel's to prove. So the transport sits beside the `pg` one in `packages/keel/src/adapters/real/`. `pg`
  stays the default, and the Data API is chosen per deployment.
- **The switch is `DATABASE_TRANSPORT=pg|data-api`.** Each app records it as `params.database.transport`
  in its `config/params.ts`. It is never inferred from which variables are set, and an unknown value
  throws. `DATABASE_URL` left `REQUIRED_ENV`: each transport's variables come from `DATABASE_ENV`
  (`packages/keel/src/adapters/real/database-transport.ts`), so only on `data-api` do its three replace it.
  "Transport" rather than "driver": both paths are Kysely over Postgres, and what differs is how the SQL
  travels.
- **Loaded only when chosen.** `db-data-api.ts` is reached by dynamic import alone, so a `pg` deployment
  never loads the RDS Data SDK. `packages/keel/src/adapters/real/index.test.ts` proves it by watching the
  module loads. A static import of the module was watched turning it red, whichever test runs first.
- **`withTenant` sets the role and the tenant in one statement**, with `set_config('role', 'app_user', true)`
  beside the tenant's `set_config` (ADR-0004 addendum). On the Data API, every statement is an HTTPS call.
- **Hand-written, not `kysely-data-api`.** That package peers on `kysely ^0.27`, sends parameters untyped
  and turns `date` into a `Date`. ADR-0002 hand-rolled the pglite dialect for the same kind of reason.
- **Parameters are typed by PREPARE, not by guessing.** Guessing a `UUID` type hint from the value breaks
  `set_config`'s text argument as soon as a tenant id is passed to it. Postgres's own inference, read back
  once per SQL shape, gives node-postgres's semantics exactly. Rejected as well: inlining escaped literals.
  It would be safe if escaped correctly, but ADR-0004 keeps the tenant id a real parameter on purpose.
- **SDK retries off (`maxAttempts: 1`); resume retried by hand.** AWS warns that retrying a statement
  whose call timed out can write twice. A paused Serverless v2's `DatabaseResumingException` means the
  request never ran, so the dialect retries that one alone, for about 15 seconds.
- **Errors carry `code` and `constraint`.** They are read from a stated SQLSTATE when the Data API gives
  one, and otherwise from Postgres's wording. Reports differ on whether the Data API includes the
  SQLSTATE, and the showcase's ticket-reference retry keys on `23505`.
- **Proven through a strict emulator; the live proof is deferred.** `pnpm test:contract` runs the
  migrations, the full RLS suite and a pg-parity battery through the dialect against
  `packages/keel/src/adapters/real/rds-data-emulator.ts`. The live check is `docs/runbooks/data-api.md`,
  for the `data-api` cutover row. The community `local-data-api` emulator was rejected: it binds untyped
  strings as `unknown`, so it passes exactly the queries Aurora rejects.
- **The migrator runs all pending migrations in one Data API transaction**, as it does on `pg`. That
  transaction opens with `pg_advisory_xact_lock` on Kysely's lock id. Kysely's own session-level lock
  would be dropped by the connection reset, and Kysely creates its tables before locking at all. A
  single statement over 45 seconds, or a run over an hour, fails loudly. A migration that cannot fit runs
  on the `pg` transport from inside the VPC. The pre-PR review found the lock gap. A race test of two
  migrators on an empty database, which first failed on Kysely's create-before-lock, proves the fix.
- **The emulator lives in `packages/keel/src/adapters/real/`, not in `test-fixture/`.** It needs `pg` and
  the RDS Data SDK, which only an adapters directory may import. Test-only modules in `src/` have
  precedent in `rls-proof-runner.ts`. Nothing in an app or a deployment imports it, and knip would report
  it if nothing did.
- **Review rounds 1 and 2 (Opus) found the same shape twice, so it was swept rather than run a third time.**
  An explicit CAST truncates or pads where node-postgres's untyped parameter is refused: first
  `char(n)`/`bit(n)`, whose inferred type printed as `character`/`bit` (length 1), then domains over
  `char`/`varchar`/`bit`. The sweep found the divergence only in length-bearing types: inferred base types
  carry no length, and a domain is the only other way a length reaches the cast. So the dialect now walks
  each domain down to its base type and prints it with `format_type(…, -1)`. The parity battery covers
  `char(3)`, `bit(4)`, `char(3)[]` and two domains, and a too-long domain value is refused on both
  transports.
- **The same rounds found two transaction-state bugs, both fixed and pinned.** A transaction Postgres had
  aborted (a caught statement error) was reported as committed; it now throws Kysely's
  `AbortedTransactionError`, as the `pg` driver does. And a raw `ROLLBACK TO SAVEPOINT`, the recovery
  available inside `withTenant`, did not count as recovery.
- **Declined: invalidating the type cache.** A statement that fails inside a transaction has already
  aborted it, so a retry with fresh types could only help outside one. It is an accepted limit (ADR-0002
  addendum): deploys replace processes.
- **Round 2's fixes were reviewed as a diff, not by a third general round** (Opus): its findings were one
  more instance of round 1's shape, now swept, and one defect in round 1's fix. The diff review found
  nothing at MEDIUM. Fixed from its LOWs: EXPLAIN is recognised after a comment, as `ANALYSE`, and before
  a parenthesised statement; a contract test now runs a parameterised EXPLAIN through the dialect, which
  nothing did; and the too-long-value test asserts each refusal's reason, not merely that something
  failed. Accepted as limits (ADR-0002 addendum): an explicit `::domain` cast in the SQL, and a colon
  before a column name, as in `a[lo:hi]`.
- **An independent cold review (2026-11-17, on a different model) found no tenant-isolation or injection
  defect.** The manager decided on every finding, and all were made:
    - A leading `;` hid COMMIT from the guard, and a statement after a `;` was never looked at, so `;commit`
      inside `withTenant` ended the tenant's transaction. Now one scanner (`sqlSegments`) says where code
      is, for the dialect and the emulator alike. A multistatement is refused before calling, and the
      emulator refuses one as AWS does, before running any of it.
    - The emulator's own colon scanner was weaker than the dialect's (E-strings, nested comments). It now
      uses the dialect's.
    - Parameter types expire after five minutes. Within them a type change is silent; ADR-0002 says so.
    - A commit counts only when CommitTransaction answers "Transaction Committed".
    - The runbook now proves migrations through the Data API on an empty database, sends statements on
      ended transaction ids, and asks whether AWS accepts 0001's `DO` block. If it does not, 0001 changes;
      that is written down, not built.
    - The 1 MiB response cap meeting a page of unbounded text is an accepted limit.

## The Data API network shape in the infra draft (2026-11-16, `feat/rds-data-api-infra`)

- **The stack takes `params.database.transport`, passed in by `infra/app.ts`.** It does not read its own
  CDK context. One value decides both what the app's runtime does and what network it gets, so the two
  cannot disagree. It is a prop rather than an import inside the stack so that `infra/check-shapes.ts`
  can build both shapes.
- **On `data-api`, the VPC still exists, but holds only the database.** The subnets are isolated, with
  no NAT gateway and no internet gateway. A cluster has to live in a VPC. Nothing else in the stack needs
  a route out of one once the Lambdas run outside it.
- **The `pg` shape stays the default.** The Data API transport is proven only through its emulator until
  its cutover row closes, and a socket is faster per statement. Its limits (45 seconds per call, 1 MiB
  per response, an hour per transaction) are the app's limits on that shape.
- **CDK's `grantDataApiAccess`, not a hand-written policy.** It grants exactly the five `rds-data`
  actions on the cluster's ARN, plus read on its secret, as the synthesized `data-api` shape shows.
  `BatchExecuteStatement` is among them although the dialect never sends it; it allows nothing that
  `ExecuteStatement` does not. The `data-api-access` cutover row checks the deployed policy, and that a
  role without it is refused.
- **Both shapes are checked by a gate.** `pnpm --filter infra synth`, which CI runs, now also runs
  `infra/check-shapes.ts`. It found what review found missing: nothing built the `data-api` shape, and
  nothing tied its environment to `DATABASE_ENV` in `packages/keel/src/adapters/real/database-transport.ts`.
  knip needs no entry for it: it reads the `synth` script.
- **The gate checks the way in, not only the wiring** (the independent cold review, 2026-11-17). It passed
  with `secretsmanager:GetSecretValue` on `*` and the database port open to `0.0.0.0/0`. Now every
  Secrets Manager grant must name the cluster's own secret alone, on both shapes; every `rds-data` grant
  must name this cluster alone; and on `data-api` the database's security group must admit nothing. The
  grants are read from every IAM policy, managed policy and role's inline policy in the stack, after the
  mechanical re-check showed a second stack secret, a managed policy and an inline policy slipping past an
  earlier version. The review's re-check then showed `Action: "*"` on `Resource: "*"` passing, because
  statements were picked by the text `rds-data:` or `secretsmanager:`. Now a statement counts if it can
  grant the service at all: a wildcard action that reaches it, or any `NotAction`. Since the contents of an
  AWS-managed policy cannot be read from the template, a role may attach only the two Lambda execution
  policies. Each check was seen red by a mutation of the stack.

## Security patches the October group did not cover (2026-11-17, `deps/security-patches-2026-11`)

- **Three packages raised past their advisories, staying on their current majors.** `@sentry/nextjs`
  `^10.75.2` (resolves 10.78.0) clears GHSA-mchm-gjx6-7h55, a critical middleware bypass through the
  tunnel route. keel configures no `tunnelRoute`, but the version is raised anyway rather than relying on
  that. `vitest` and `@vitest/coverage-v8` `^4.1.12` (resolve 4.1.12) clear GHSA-82fw-gwwq-j7x9 (fixed in
  4.1.11) and two `@vitest/mocker` advisories fixed only in 4.1.12, GHSA-qxg6-89mg-rqv8 and
  GHSA-xp26-3454-mjgp. Review caught that the first floor, `^4.1.11`, still admitted both.
  `happy-dom` `^21.0.4` clears GHSA-5fpq-26gf-qwcr, GHSA-c8p4-j97h-3vg8 and GHSA-834v-8h66-3h79. The
  last two have no fix on 20.x, so this is a major bump. 21.0.0's one breaking change turns off CSS-file
  and iframe loading by default, its fix for the SSRF; no keel test configures happy-dom or loads either.
  GitHub's advisory database lists nothing against any of the four resolved versions. Not taken: Sentry 11
  and vitest 5 (new majors, no advisory requiring them).
- **`withSentryConfig` stays imported from `@sentry/nextjs`.** Since 10.73.0 Sentry also exports it from
  `@sentry/nextjs/config`, its v11 path, and calling the old export logs a deprecation warning once.
  `apps/showcase/next.config.ts` imports it on every `next dev` and build, but calls it only when a DSN is
  set (cutover row `errors`), so no run here prints the warning. Moving it belongs with the Sentry 11
  upgrade.

## `authorize()` judges actors that are not sessions (2026-11-16, `feat/authorize-non-session-actors`)

The design is in the ADR-0012 addendum of the same date. The port method is in ADR-0003's. These are
the calls the work made that no plan anticipated.

- **The requester's evidence.** The sharing site's console (`safeinsights/pages`) names its callers in
  `apps/console/src/domain/pages/callers.ts`: a session, a CLI's API token, and later CI's GitHub OIDC
  token. On its `main`, read before the requester's shape arrived, `sessionUser(ctx)` throws
  `AuthRequiredError` for anything but a session. The worker on its token branch then reported the
  design of record, relayed by the keel manager; that branch was not read here. The token is PERSONAL: it acts as the publisher who approved it, its console role is
  resolved afresh on every call, removing the publisher stops it at once, and it never wields
  `manageAll`. Its stand-in actor is an `AuthUser` with placeholder role and locale. Its audit rows read
  exactly like browser ones. CI is a principal of its own.
- **The machine design was built first, and the person kind came after.** The first cut gave keel
  machine actors only, for keel's own service keys and for CI. The requester's answer showed that the
  caller it has NOW is a person holding a token, which a roleless machine cannot express. Both kinds
  shipped in one PR. They share the `Actor` union, the `Credential` vocabulary, the `authorize`
  overload, the audit columns and one addendum, so a split would have landed the overload with half its
  union and rewritten the same functions in the second PR. The commits are separate: machine actors,
  then the person kind.
- **The person's standing is read by keel, through the auth port, on every call.**
  `abilityActorFromCredential` takes no role at all, so "never cache a role in the token" is a property
  of the function's signature rather than a convention. `listMembers` could not supply it, because
  `restricted` is not on `Membership`, so the port gained `getMember` (ADR-0003 addendum). Inbound email
  had guessed `restricted` from the role; it now uses the same rule a session does (`isRestricted`).
- **`manageAll` is a STATED session's alone, enforced in `defineAbilitiesFor`.** It is not left to
  whoever builds the actor. A token's owner acting in the operator org is an ordinary member there. The
  first version read a missing credential as a session, so a hand-built actor that left the field out
  and set `manageAll` from the org would still have wielded it. The pre-PR review caught that, and a
  missing credential now means "not stated".
- **Credential kinds are composed, not closed.** `PersonCredentialKind` and `MachineCredentialKind`
  each add the app's kinds from the abilities seam, as subjects and audit verbs already do. The
  console's one-time `cli-login` kind is app vocabulary; keel never edits a base union for it.
- **Narrowing by kind, not per-credential scopes.** The console's narrowing ("publisher administration
  takes a browser session") is by credential KIND, and the app's rules can see the kind. That makes
  per-credential scopes (option b of the fork sent to JP) unnecessary for now. The place where a
  per-credential cap would intersect `can()` is marked in `defineAbilitiesFor`, and nothing is built
  there.
- **Machines get a separate rule function, not a role.** Giving a machine a role and passing it to
  `appAbilityRules` fails open: both apps' person rules let any member who is not restricted author the app's own subjects (the showcase's tickets and attachments, the starter's items). `appMachineAbilityRules` with a `return false` default fails closed. It is also one new
  export for an adopter, not a changed signature.
- **The framework's one machine grant names a credential kind.** Job `read`/`update` in the caller's
  own org goes to `service-key` only. `machineActor` refuses that kind, keel's person kinds and
  `system`, so an app's machine cannot pass for any of them.
- **The audit columns are nullable, and NULL means "not recorded".** Rows before 0014, `system:*`
  writers, and session routes that don't yet pass a credential all record NULL. A NOT NULL default
  would have had to claim a kind for rows nobody can vouch for. The session routes are left as they were.
  Making them record `session` would touch every audited route in the showcase, in a PR about callers
  that are not sessions.
- **An overload, not a migration.** `authorize(actor, action, subject)` sits beside the four-argument
  session form. Changing the 19 existing calls (16 in the showcase, one in the starter, two fixture
  routes) and their tests would have been mechanical here, but every adopter's routes would have
  changed too (the console has nine calls), and the four-argument form is still the right shorthand
  for a session.
- **`kind` and `credential` are optional on the person actor.** Requiring them would have broken every
  `AbilityActor` literal: the preset checks, both static demos and every adopter's tests. A literal with
  no credential keeps the person rules but neither wields `manageAll` nor records a credential. The
  three literals in this repo that stand for a session (both static shells and the ticket-assign
  preset check) now say so.
- **The seam's machine rules are bound at call time.** `defineAbilitiesFor` assigns
  `appMachineAbilityRules` to `MachineAbilityRules` inside the function, not at module load. That lets
  the empty registration take no parameters, and a seam module that later value-imports
  `keel/core/abilities` cannot hit the binding before it is initialized.
- **The `service/` exemption is retired, and the scan says what to do instead.** Once a service route
  can authorize, an exemption that says it need not is a second way through the gate. The scan's
  failure message names the three non-session constructors, so an adopter whose old service route goes
  red learns the fix from the failure itself.
- **Token storage stays in the app.** keel owns what `authorize()` needs, and the token itself is the
  app's for now: `.claude/future-tasks/personal-api-tokens.md` records the console's shape for when keel
  takes it.
- **The migrator runs unordered, so a framework migration can reach an existing database.** The first
  run of the full gate after 0014 failed the starter's e2e. Its local world had run `1001_items`, and
  Kysely's strict ordering refused a new migration that sorts before it. The alternatives were worse.
  Wiping `.data` fixes a laptop, not a deployment. Numbering framework migrations above the app's range
  breaks the "framework first" order for a fresh database. `allowUnorderedMigrations: true` keeps
  name order for pending migrations and keeps the missing-migration check.
- **Unordered migration needed a rule and a gate.** Strict ordering had also been what refused an app
  migration numbered into 0001–0999, and an unordered framework migration that sweeps the catalog
  (`GRANT … ON ALL TABLES`) would leave an upgraded database different from a fresh one. Both are now
  `packages/keel/src/db/migrate.test.ts`, a seam-conformance test run against the fixture and each app.
  It checks the numbering, and it compares an upgraded schema with a fresh one. Both checks were seen
  failing.
- **Kept as built, after review:**
    - `abilityActorFromCredential` takes `org: { id, slug }` rather than resolving one from the other.
      The auth port names orgs by slug, as Clerk does, and resolving inside would couple `authz` to the
      database. The docstring now requires both from one organizations row.
    - `machineActor` is kept although only keel's own tests call it. Its consumer is the first adopter's
      planned CI identity, and its run-time checks are what a hand-written `MachineActor` would lack.
- **What three review rounds changed** (a pre-PR review and two code rounds, all on Opus):
    - `service/` routes still need their verifying wrapper (`REQUIRED_ALONGSIDE`). Without it,
      retiring the exemption had let a request-built machine literal pass the scan.
    - Restriction has one rule, `isRestricted(flag, role)`, in both adapters. This changes real-mode
      sessions.
    - The credential-kind check runs in both directions and refuses `string`.
    - The migrator refuses an out-of-order migration within its own sequence and keeps Kysely's "is
      missing" error. `schemaOf` now covers RLS flags, constraints, triggers, functions and column grants.
    - The intake's system rows record no credential.
    - The real `getMember` matches the membership by user and returns null for an unknown org.
- **Declined after review, with reasons:**
    - A lint ban on hand-built `kind: 'machine'` literals: keel never guarded against a route building
      an `AuthUser` either, and the fixture builds actors by hand on purpose.
    - Requiring `authorize(ctx.actor…)` by name under `service/`: brittle, and bypassable by renaming.
    - An advisory lock around the migration preflight: two releases migrating one database at the same
      moment is outside keel's deploy model.
- **JP decided the fork (2026-11-16, via the keel manager).** A machine's powers come from the app's
  abilities seam, through a deny-by-default `appMachineAbilityRules`, and per-token scopes are not built.
  The place for a later per-credential cap stays marked in `defineAbilitiesFor`, and retiring the
  `service/` exemption stands.
- **An independent review, decided by the keel manager.** A cold review by a different model, at
  `833638a`, found three MEDIUMs:
    - The upgrade test's "old" database could not hold an app migration that builds on the newest framework
      one. Fixed by building it one migration at a time.
    - A banned user kept their standing. They now have none, and `locked` deliberately still does.
    - A possibly-true `manageAll` without a session failed closed silently. It is now a type error.
- **The administrative subjects are a manager decision, the conservative one, and JP was told.** They are
  Membership, Org and WebhookEndpoint, and non-read actions on them take a stated session. An app widens
  one subject at a time through `nonSessionAdministration`.
- **Also from that review:**
    - the inbound handler now reports its credential instead of the intake inferring it;
    - `isRestricted` is used at every remaining literal;
    - malformed actors are denied;
    - an org's id and slug come from one row (`orgIdentityForSlug`);
    - the numbering test no longer requires an app migration, and the four-digit rule is in
      `docs/adopting.md`;
    - one ADR sentence about un-forced RLS was corrected in place, since the addendum is today's.
- **The independent re-check found one regression of this PR's own (N1), and the manager made three more
  calls.** N1: the validated actor was read through its prototype, but the judged one was `{ ...actor }`,
  so a restricted admin built as a class with getters, or with `Object.create`, could author. The person
  is now copied field by field by name, that copy is validated, and only it is judged. Seen failing
  first. The three calls below are the MANAGER's, recorded as such and open to JP:
    - Accepting terms (AgreementAcceptance `create`) takes a stated session. It is a legal act a person makes
      in a browser, so it joins the session-only subjects, and the app hook may widen it.
    - `nonSessionAdministration` may not widen to `inbound-email`, by type (`WidenableCredentialKind`) or
      at run time. An email's From line is the weakest credential keel has.
    - `OrgIdentity` is branded: `orgIdentityForSlug` is its only producer, and tests cast deliberately. The
      inbound intake now gets `ctx.org` through it, at the cost of one more indexed read per email.

## Nothing an upstream merge brings should need the adopter to edit keel's files (2026-11-16, `fix/adopter-merge-friction`)

Two reports from the first adopter's second upstream merge, one bug class: keel depending on, or telling an
adopter to edit, something a later merge (ADR-0013) will change. `init-app` runs once; a merge happens every
update.

- **A doc citing the reference apps no longer turns an adopter's path gate red.** Reproduced first: a tree
  adopted from the commit before the app-owned-adapters work, then given that work's new docs verbatim as a
  merge would, failed `doc-paths.test.ts` on `docs/recipes/app-owned-adapter.md:167`
  (`apps/starter/src/app/[locale]/signin/page.tsx`). `resolves` in `tests/docs/doc-set.ts` now treats a
  citation under `apps/showcase/` or `apps/starter/` as keel's whenever that app is not in the tree, and checks
  it like any other wherever the app exists. "In the tree" is the app's `package.json`, not its directory: review
  found that a merge brings back any new file upstream adds under `apps/showcase/` even after the adopter
  deleted the app, and a directory holding one stray file had switched the rule off. The template stays strict (a broken one fails, watched
  failing), a rename-only tree is strict about the showcase it kept, and the adopter's own app and
  `packages/keel` are strict everywhere. Rejected: asking every doc to cite `apps/<app>/…` (it depends on
  each future author, and the live docs hold 159 citations of the showcase in 46 files and 46 of the
  starter in 17 (counted 2026-11-17), most of them pointing at keel's worked examples and not at the reader's own app), and a rule in the
  test alone (`init-app` asks `resolves` which citations are gone before it generalizes them, so the rule
  lives where both read it). The list is closed at two names: `init-app` reserves `showcase`, and an adopter
  who keeps the name `starter` has the directory, so their own citations of it are still checked.
- **keel's demo size script holds no number and no history.** Its header told an adopter to record every
  budget change in it, and its default was the showcase's number, so changing either meant editing a file
  upstream also edits. The budget is now a required argument from each app's `package.json` (the showcase
  passes `840000` explicitly). The starter's history moved, split per app and lightly reworded (every number
  checked), into `apps/starter/DEMO-SIZE.md` beside its number, and the script's header is generic. That file
  keeps the adopter's "Changes" section above keel's history, so a later upstream addition to the history and
  an adopter's own entries sit in different regions. The showcase's history is in this log, below, and NOT in a
  file in `apps/showcase/`: an adopter deletes that app, and review showed a file keel adds there afterwards
  comes back on the next merge (and two same-named new files in both app directories make git refuse to map
  them for an adopter who ejected and renamed). Rejected: a comment in `package.json` (JSON has none), and a
  `DEMO-SIZE.md` for the showcase. `init-app`'s bullet from the previous change lost its no-number branch and
  its "the header still describes the showcase" sentence, since neither is true any more, and points at
  `DEMO-SIZE.md` only when the app has one.
- **The sweep for other instructions of this kind** fixed the one that was plainly wrong (`docs/adopting.md`
  told adopters to promote a keel module "by adding one line" to `packages/keel/package.json`, which ADR-0013
  says never to carry in a fork). The rest each need a decision and are in
  `.claude/future-tasks/adopter-instructions-edit-keel-owned-files.md`, including the largest: `init-app`'s
  day-one rewrite of about 60 docs, which is a conflict waiting at every later upstream edit.

## The showcase's demo size budget history, moved out of `scripts/check-demo-size.mjs` (2026-11-16, `fix/adopter-merge-friction`)

This was the HISTORY section of that script's header, and the showcase has no `DEMO-SIZE.md` of its own: an
adopter deletes the showcase, and a file keel adds under `apps/showcase/` after that comes back on the next
merge. The starter's history is in `apps/starter/DEMO-SIZE.md`, where an adopter inherits it. Moved, split per
app, lightly reworded; every number was checked against the original.

What the number is for: the showcase's budget is the framework's pace-setter: about 3% over what it measures, deliberately thin, so that
growth is a decision someone makes on purpose. Every framework screen and twin is in the showcase, so a
framework change that costs bytes costs them here first.

**Re-based 2026-11-16, 950000 → 840000**

Since the first commit (925623 bytes) the demo had grown 18787 bytes, to 99.4% of its budget. Per merge: demo
presets (#26) +16924, the Simulator's people-and-orgs work (#15) +810, actors that start with the page (#16)
+855, the mechanical bundle (#19) +198. Two things were removed:

- 493 bytes were incidental: keel's four preset operation definitions were module-level constants, so valibot
  and four schemas rode in every app's bundle although the demo never validates a preset. They are built by
  function now, and `tests/tooling/static-demo-bundle.test.ts` holds it. (An app's OWN definition is not
  covered: the showcase's `ticket.assign` still carries about 2.8 KB, its definition and valibot's schema
  functions.)
- 129257 bytes were Mantine's stylesheet. The apps import `@mantine/core/styles.css` whole, 273 KB for ~100
  components, of which the demo's bundle reaches 33. The static demo's build now drops every rule whose hashed
  class is in no shipped file (`scripts/vite-prune-mantine-css.ts`, wired in each app's `vite.demo.config.ts`):
  14-15% of the file.

What stays is the presets themselves: net of the trim about 16.4 KB on the showcase, real code (the static
twin's replay, the operation registry, the seam module with `extends`) plus its copy and its tour.

`pnpm build:demo-static`, bytes: 925623 at the first commit, 944410 before the re-base, 814660 after it. The
budget is 840000, which leaves 25340 bytes (3.0%).

The budget went DOWN, so the bytes saved are not slack: they are the margin above, on purpose. If the pruning
or the lazy definitions regress, the number turns red, which is the point of it.

**Raised 2026-07-31, 920000 → 950000, for tours**

The tour engine (ghost cursor driver, engine hook, narration bar, Tours tab) plus the showcase's 16-step
walkthrough and its narration in both locales cost 25244 bytes, 2.8% of the artifact: 10932 of that is the
engine (measured against the starter, which registers no tours and still passed its own unchanged budget) and
about 14300 is the tour itself, most of it narration in two locales. That is the one feature whose whole point
IS that file: a stakeholder who is emailed `dist-demo/index.html` can now press Start instead of reading a
runbook and clicking fifteen things in the right order.

## The getDb ban is deny-by-default; two fences hold outside declarations (2026-11-16, `fix/lint-import-fences-getdb-default`)

- **The getDb ban covers all of an app's `src/`, keel's screens (`components/`, `demo-static/`) and the
  fixture.** It used to name `app/`, `components/`, `domain/` and `jobs/`. The alternative was adding
  `actions/` and `lib/` to the list. It was rejected because the next directory would be missing in the
  same way. The one exception is tests outside routes, screens and the fixture, which arrange cases through
  the fake db. No production module needs the raw client today; one that does is added by exact path.
- **The ban is a rule of its own id, `keel/no-raw-db-handle`**, not `no-restricted-syntax` selectors. Its
  three selectors and messages are unchanged.
- **keel's own `src/` outside its screens stays outside the ban.** keel/db's helpers and keel's adapters are
  what open `withTenant`, and they are what the ban's message sends request code to.
- **The framework/app fence and keel/core's fence gained declarationless halves** (`keel/no-dynamic-app-import`,
  `keel/no-dynamic-framework-import-in-core`). They match through the `ignore` package loaded from ESLint, as
  `no-restricted-imports` does. A regex converter was the alternative, as the future task sketched; it was
  rejected because it would read some specifiers differently from the static half.
- **The vendor rule keeps its own matcher, `isVendorSpecifier`.** The static vendor ban's bare names (`pg`,
  `posthog-js`, `posthog-node`, `mailgun.js`) match at any depth and ignore case, so it flags a local `./pg`, which a test
  from the app-owned adapters work pins as not a vendor for the declarationless half. Matching both halves the
  same way means anchoring those names in `vendorSdkPattern`, which changes the static ban, so it is left for
  its own change.
- **The vendor rule gained the type position too.** It now shares the factory, so `type T = import('pg').X`
  outside an adapters directory is a finding, as `import type` from `pg` already was.

## Storage port: `head(key)` and `copy`'s `ifMatch` (2026-11-17, `storage-head`)

Requested because `copy` alone cannot serve a finalize step that re-checks each staged file's size and content
type before making it live: the port could only read them by fetching the whole object. A metadata read is a
generic primitive (S3 `HeadObject`; a stat in the fake).

- **Named `head`, after the port's verbs.** `put`, `get` and `delete` are HTTP verbs already; `head` is `get`
  without the body and is S3's own name for it. `stat` would have been the filesystem's.
- **It returns `StoredObjectInfo { size, contentType, etag, lastModified }`.** Size and content type are what
  finalize needs. The etag is there so the check can be tied to the copy (below); it pins the bytes, so the size
  check is exact, while the content-type check stays advisory, because neither adapter's etag covers the content
  type (a rewrite with identical bytes and another type keeps it). A flow that must hold the type relies on the
  upload target's `eq Content-Type` condition. `lastModified` is the one
  field nobody asked for; both adapters give it truthfully and a stat without a time looks wrong, but nothing
  else depends on it.
- **The etag is opaque.** AWS's own reference calls it "an opaque identifier", so callers compare two for equality
  and pass one back UNCHANGED as `ifMatch`; the port promises no format and not whether rewriting identical
  bytes changes it. Real: exactly what S3 sent, quotes included. Fake: a quoted SHA-256 of the bytes, shaped like
  S3's so a caller that mishandles the quotes fails here too. The fake computes size, modification time and hash
  from ONE open handle, so a writer that renames a new file over the old one cannot make them describe two
  versions; the cost is that a fake `head` reads the whole file.
- **A missing object is `null`, as for `get`; `copy` throws.** A read has a natural "nothing" to return, so a
  caller asks `if (!info)`; `copy` has nothing to return and a silent no-op would hide a lost file. Both
  adapters agree: the real one maps S3's `NotFound` (the SDK's error for a HEAD 404) and `NoSuchKey`; the fake
  answers `null` for anything that is not a regular file (a directory, a bookkeeping name).
- **What S3's HEAD cannot say.** A HEAD response has no body, so AWS gives only a generic status ("It's not
  possible to retrieve the exact exception"): a missing BUCKET, which S3 also reports as a 404 (not stated on the HeadObject page, so the
  cutover row confirms it), could not be told apart and reads as `null`, where `put` or `get` would surface it. A 403 (the role lacks `s3:ListBucket`, so a missing key is not a 404) is not
  mapped and throws, as in `copy`. A response without a size, ETag or date throws: defaulting a size to 0
  would let a maximum-size check pass on something S3 never said.
- **A stat-then-copy check is advisory; `ifMatch` makes it exact.** The object can change between the two
  calls, so `copy(from, to, { ifMatch: info.etag })` copies only if the source is still that version, else throws
  the new `PreconditionFailedError` and copies nothing. Real: S3's `CopySourceIfMatch`, which S3 evaluates with
  the copy. Fake: it compares the staged copy's hash, the very bytes about to be published, so the bytes that land
  are exactly the ones that matched even if a writer replaces the source mid-copy (a test races exactly that). The order
  of the other checks is same key, missing source, precondition (the real adapter leaves the last two to S3, whose order for a
  missing source with an `ifMatch` is unconfirmed; the cutover row asks). An `ifMatch` that is empty or `*` is refused first of all, on both adapters, with a
  plain `Error`: HTTP gives an empty If-Match no meaning and `*` the meaning "any version", so S3 could read either as no
  condition and copy unchecked where the fake refuses (what S3 does with them is unverified, and no etag `head` returns is
  either). No route glue maps the new error; the caller says
  409 or 412.
- **412 is inferred, not read.** The CopyObject reference states 412 for its other conditional headers and gives no
  code for `x-amz-copy-source-if-match`, which is HTTP's rule for a failed If-Match. The adapter maps the name
  `PreconditionFailed` or a bare 412, and the cutover row `storage-head` asks to confirm it.
- **No IAM change** (`HeadObject` needs `s3:GetObject` per AWS; `grantReadWrite` has `s3:GetObject*` and
  `s3:List*`), **no static-demo twin** (no storage port there). **Not done:** `copy` returning the new object's
  info, a create-only copy (`ifNoneMatch`), and reading a specific version.
- **The finalize sequence an app uses:**

    ```ts
    import { NotFoundError, PreconditionFailedError } from 'keel/ports/errors'

    const info = await storage.head(stagedKey)
    if (!info) return (await storage.head(finalKey)) ? alreadyFinalized : stagedFileVanished
    if (info.size > MAX_BYTES || info.contentType !== EXPECTED_TYPE) {
        await storage.delete([stagedKey])
        return rejected
    }
    try {
        // exactly the version that was checked, copied server-side
        await storage.copy(stagedKey, finalKey, { ifMatch: info.etag })
    } catch (error) {
        if (error instanceof PreconditionFailedError) return changedAfterTheCheck // re-head, or reject
        if (error instanceof NotFoundError) return stagedFileVanished
        throw error
    }
    await storage.delete([stagedKey]) // idempotent
    ```

    A retry after a copy that succeeded and a delete that failed finds the staged file again, gets the same etag,
    and converges over `finalKey`. A retry after both succeeded gets `null` from `head(stagedKey)`, which the
    first line of the snippet reads as "already finalized" by checking `head(finalKey)`.

## The migrating role may switch to `app_user` (2026-11-16, `fix/grant-app-user-to-owner`)

The design is in ADR-0004's addendum of the same date.

- **A framework migration, not a deploy step.** The grant has to exist before the first tenant query on
  any database keel migrates, and the migrator is the one role every deployment runs. A runbook line
  would be forgotten exactly once, and that once is every request failing.
- **Guarded by `pg_has_role(current_user, 'app_user', 'SET')`, not a bare GRANT.** The guard makes it a
  no-op for a superuser and on a re-run (a fresh superuser in the contract suite pins it). Separately, the
  block's `insufficient_privilege` handler means a role that cannot grant the switch to itself fails with
  the statement to run, instead of a bare `permission denied to grant role`.
- **INHERIT FALSE for the migrator, INHERIT TRUE for a separate app role.** The migrator owns every table,
  so it needs only the switch. A separate app role owns nothing and reads `tenants`, `organizations` and
  `service_keys` before any tenant is set, and those grants are `app_user`'s.
- **The non-superuser pass runs the existing proofs, not a new suite.** `RlsProofContext` gained
  `appDb`: every `runWithTenant` and every `SET LOCAL ROLE app_user` in the framework's and all three
  seams' proofs moved to it. Seeding and the negative control stay on the superuser. So every isolation
  claim is now proved for the connection a deployment actually uses, and an adopter's own proof half that
  still switches on `db` keeps passing, just less strictly.
- **The shared-server problem is measured, not assumed.** `app_user` is cluster-wide, and CI's suites
  share one Postgres. The pass measures what this server gives a role's creator, then gives the owner
  exactly that where `app_user` already exists. The pass runs twice in its file, so the genuine path (the
  owner's own 0001 creates `app_user`) and that one both run every time. Before that, a scratch run on a
  fresh cluster had checked the genuine path: the owner created `app_user`, failed without 0015, and passed
  with it.
- **`down` is a no-op.** Revoking the switch would take every tenant query down with it, and keel never
  runs `down` migrations.
- **A self-granted membership keeps its INHERIT.** If an operator set `createrole_self_grant`, the
  creator already holds a membership it granted itself, and a plain GRANT would rewrite that row's
  INHERIT. 0015 adds SET to that row instead (found in review; tested on real Postgres).
- **A migrator with no ADMIN on `app_user` now fails at 0015, deliberately.** That happens on a shared
  cluster where another role created `app_user`, or with a migrator that never runs the app. It used to
  migrate cleanly. Now it stops with the one statement to run. The alternative, migrating anyway, would
  leave a role that might be the app's unable to serve a single tenant query, discovered at the first
  request instead of at deploy.
- **A second owner on one cluster fails at 0015 rather than migrating, and the failure carries its
  remedy.** Staging and production on one Aurora cluster, migrated by different owners, is a real setup.
  A reviewer proved that the second owner's grant fails. Skipping 0015 there would have migrated a database
  whose owner cannot serve a tenant query. So it stops, rolls back, and prints the GRANT. The contract
  suite runs the case end to end, executing the printed statement as written.
- **A role name with capitals broke 0015, and the second-owner test found it.** `current_user::regrole`
  parses its input as an unquoted identifier and folds it to lower case, so a role named `Keel_Second_…`
  was "not found". 0015 now finds the role by its exact name in `pg_roles`, and the remedy it prints quotes
  the name (`quote_ident`), so copying it runs as-is. The test's second owner has a mixed-case name to pin
  both. Its remedy is run by an ADMIN-only creator, not the superuser, so the docs' "a role holding ADMIN"
  is what is tested.
- **Postgres 16 or later is stated as keel's minimum, not branched on.** 0015's `pg_has_role(…, 'SET')`
  and `GRANT … WITH SET` arrived in 16, and nothing in the repo stated a minimum version (found in the
  independent re-check). Every server keel targets is 16 or later (Aurora 16.10, CI's postgres:16, pglite
  18.6), so a `server_version_num` branch for 15 would be code no gate runs. The minimum is in
  `docs/adopting.md`, the ADR addendum and 0015's header.
- **A logical restore carries the ledger, not the grant.** `pg_dump` dumps one database, and roles and
  their memberships are cluster-wide. Restored into another cluster, the ledger says 0001 and 0015 ran, so
  neither runs again, and neither `app_user` nor anyone's switch to it came along. The
  `db-role-not-superuser` cutover row says what to do before and after a restore.

## JSX banned in keel/core; paths into apps/ fenced; getDb as a string banned (2026-11-16, `fix/lint-core-jsx-app-paths-getdb-string`)

- **JSX in keel/core is banned with a rule of its own, `keel/no-jsx-in-core`,** reported for each outermost
  element or fragment, so a disable comment on one does not hide the next. Banning `*.{tsx,jsx}` files under
  core was the alternative. It was rejected because the extension is not what imports React: the JSX is.
- **A path into app code is judged by where it lands, not how it is spelled.** `keel/no-path-to-app-code`
  resolves a relative or absolute specifier against the importing file, following symlinks, and reports it if it
  lands in `apps/` or `packages/seed/`. The first version was a `regex` on the spelling (an `apps/` segment anywhere in a
  specifier). It closed the seam for `@app-config/apps/…`; round 1's fix, which kept `@` specifiers out of it, let
  `@scope/../../apps/…` through; and each review round found a spelling it missed. Listing the two
  apps' directories was rejected too: an adopter renames and adds apps.
- **A `..` in any package or alias specifier is banned** (`bareTraversalPattern`), not only after
  `@app-config/`: no package specifier has a reason to climb, and TypeScript resolves one that does out of
  node_modules. So is **any specifier through `node_modules`** (`nodeModulesPathPattern`), where pnpm links the apps
  and the seed. Both travel with `appCodePattern` as `appCodePatterns`.
- **A specifier two patterns match is two findings, in both halves.** The declarationless half now reports every
  pattern a specifier matches, as `no-restricted-imports` does. The alternative, exempting from the traversal ban
  what the alias pattern "already bans", was tried and rejected: written as spellings, the exemptions let
  `@\..\..\apps\…` and then `@//../../apps/…` through, because the alias group matches neither.
- **The app's aliases are a `regex`, not a `group`** (`^(@[\\/]|@app[\\/]+seed([\\/]|$))`). A fuzz of 7,069 specifier
  spellings against TypeScript's resolver found `@//domain/tickets` past the `@/*` group, whose gitignore syntax
  does not match an empty segment. The regex matches every specifier the group did on the fuzz's corpus, plus the
  empty-segment and backslash spellings, which no published package uses.
- **The getDb ban also matches the name as a string.** Type positions are left out because they load nothing,
  and so are keys that define a member. Strings the computed and destructure selectors already report are left
  to them, so each finding is reported once. A spy's key (`vi.spyOn(db, 'getDb')`) is exempt in a test file
  only: a spy calls through, so anywhere else it is the raw handle.
- **Two gaps stay documented and filed, not fixed:** a hand-written `.mjs` in the generated styles directory
  (`.claude/future-tasks/generated-styles-mjs-unlinted.md`), and the vendor ban's two halves reading the list
  differently (`.claude/future-tasks/vendor-ban-matcher-parity.md`).

## App-owned lint exceptions (2026-11-16, `fix/lint-core-jsx-app-paths-getdb-string`)

- **An app's exceptions to a fence live in `apps/<app>/lint-exceptions.mjs`**, read by `eslint.config.mjs` for
  every app at load. The alternative, an exact path in `eslint.config.mjs`, stops matching after `pnpm init-app`: the path named
  the app's directory, which `pnpm init-app` renames without rewriting keel's config. Every upstream change to the
  file would also conflict with the adopter's edit.
- **Only `keel/no-raw-db-handle` takes one.** It is the one fence the docs tell an adopter to except a module
  from. The recipe and `/new-port` still say to add a vendor to `vendorSdkPattern` in `eslint.config.mjs`. That
  widens a ban rather than excepting a file, and is left where it is.
- **Each entry names one existing file under the app's `src/` and gives a reason, or the config fails to load.**
  The alternative was warning on a broad glob. It was rejected because a warning is easy to scroll past, while a
  failed load names the entry. A Next route's `[locale]` is escaped, so the path matches literally.
- **`KEEL_LINT_EXCEPTIONS_ROOT` points the loader at a scratch tree**, for the one test that runs the real config
  end to end without writing into this repo's `apps/`. It is read only under vitest, so a variable left in a shell
  cannot swap the exceptions; that guards against accidents and is not a boundary.

## Audit events take the simulated world's time; an ejected app carries the cron route (2026-11-17, `fix/audit-clock-and-cron-route`)

Two requests from the first adopter (pages), both written so they work the same whether an app takes keel by fork
or as a package: the logic is in `packages/keel`, and the app holds thin wrappers.

- **An audit event's time comes from the database port, never from a caller.** `audit_events.at` defaulted to the
  database's `now()` and nothing set it, so a demo that advanced the Simulator's world clock still recorded events
  in real time, and anything comparing an event's age with that clock (a retention demo) never lined up. `DbPort`
  gains an optional `now(): Date`; the fake database implements it as the world clock (`worldNow()`), and
  `recordAuditEvent` stamps `at` from it when it exists. A real adapter must not define it, so `at` stays
  Postgres's `now()` there. Rejected: an `at` field on `AuditEventInput`, which is exactly what must not exist
  (every route could then supply a time, and "real mode ignores it" is a rule somebody has to keep); and reading
  `isSimulated` inside `recordAuditEvent` (it would couple the db module to the adapter registry, and the port
  already is the place that differs between modes). Every writer reaches the table through that one function, so
  schedules, webhooks, inbound mail and invites are covered without a change. The file:// demo twin had the same
  defect (`appendAudit` defaulted to real time, and the inbound-mail path passed a real-time `at` explicitly); it
  now uses its own world clock, with the inbound ROW keeping real time as the server's `inbound_emails.created_at`
  does. Known consequence, not fixed: the Simulator's "reset clock" returns to real time while the database
  persists, so events recorded afterwards sort below ones stamped in the advanced future in the Events tab, which
  orders by `at desc`; and because that tab shows the newest 100, a world holding 100 or more future-stamped rows
  hides every event recorded after the reset until it is re-seeded (a sequence column would fix the order; it is
  not worth a migration for a demo-only tab). Not changed here: the other timestamp columns (`jobs`, notifications, deliveries) still use
  the database's `now()`; only the audit trail was asked for.
- **The starter has the scheduled-tick route.** The showcase's `/api/webhooks/cron` route held the whole tick, so an
  app built from the starter had no route and nothing ticked keel's scheduler in a deployment (the `scheduled-tick`
  cutover row needs it). The tick is now keel's `runScheduledTick` (`keel/server-lib/scheduled-tick`, one new
  published subpath, 131), and both apps' routes are `withWebhookSecret(...)` around it. `withWebhookSecret` joins
  `keel/service-auth/webhook` (no new module for it) and maps nothing but the opaque 401; the showcase keeps its
  own guard of the same name, which also maps port errors. The route has to name `withWebhookSecret(` in its own
  file because the authorization scan accepts a `webhooks/` route on that text, so a bare re-export of a framework
  handler would fail the scan; watched failing with the guard removed. The starter's coverage is a route test and
  the framework's tests, not an e2e: its e2e is deliberately one claim.
- **`pnpm dev` without the Simulator has no tick source, and that is documented, not fixed.** The showcase's
  Simulator controls are buttons; nothing polls. An automatic dev ticker would change when the showcase's e2e and
  demos see digests fire, so `docs/adopting.md` ("The scheduled tick") says how to tick by hand with the dev
  secret instead. A `pnpm tick` helper or an opt-in ticker is the next step if it is wanted.
- **The audit write is total against a bad clock file; the tick is not, and that is left as it was.** A corrupt or
  absurd `.data/simulator/clock.json` makes `fakeDb.now()` fall back to real time (any instant Postgres cannot
  store counts as absurd: past year 9999 or before year 0), because an audited mutation has already committed
  and must not answer 500 with no audit row. `runScheduledTick` calls `worldNow()` directly, so the same file
  makes the cron route answer 500 until it is fixed, exactly as the showcase's route did before this change; a
  tick that silently ran on real time would hide that the demo's clock is broken. Not worth a second fallback.
- **Corrected figure:** the adopter guide said the starter imports 32 of keel's published subpaths; it was 33 before
  this change (every counting rule gives 33) and is 35 of 131 now from the starter's source, 37 counting its tests (the new cron route test imports
  `keel/adapters/fake/db` and `keel/adapters/fake/service-auth`), so from here on the figure depends on the rule: say which.
