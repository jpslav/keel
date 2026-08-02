# App coverage gaps — round 2: from one reference app to the app-type space

**How the template decided what to ship.** Round 1 measured the scaffold against a single
real application — a regulated-data research product — and closed the eleven gaps that one comparison
surfaced. Measuring against one app tells you what that app needs, and nothing about what the next one
will. This document is round 2: instead of one reference app, it tests the template against the _space_ of
app types it might host, asks what each would need, and triages what the sweep found. Five build slices
came out of it, and are built.

Its lasting value is therefore not the roadmap. It is the method, the triage decisions, and the doctrine
that emerged from making them — written down so the next sweep does not re-derive them, and so an adopter
can see exactly where the line between "the template ships this" and "your instance builds this" was
drawn, and why.

As with round 1, everything here is slice-level intent under the one-way/two-way door rule: each build
slice makes its own detailed design decisions when it starts and records them in `docs/decision-log.md`.

## Method: app types until saturation

Nineteen app types, chosen not as a fixed quota but by **saturation** — keep adding types until
new ones stop surfacing new capability requirements:

(1) B2B SaaS workflow (CRM/projects), (2) marketplace (two-sided), (3) e-commerce storefront,
(4) realtime collaboration suite, (5) analytics/BI product, (6) CMS/content publishing,
(7) community/social, (8) booking & scheduling, (9) fintech/billing-ops, (10) regulated-data
research/health (round 1's reference app — the covered baseline), (11) developer tool/API-first, (12) AI-native
product, (13) internal ops/admin tooling, (14) LMS/education, (15) helpdesk/support,
(16) monitoring/IoT telemetry, (17) forms/survey builder, (18) document management,
(19) event/ticketing.

Saturation evidence: types 14–19 each added at most one or two new capability rows (LMS: none;
helpdesk: inbound email; monitoring: time-series + alert rules; forms: user-defined schemas;
document management: versioning + per-item ACL; events: essentially none). Type 19's marginal
contribution was ~zero, so the list stops there. Each type was decomposed into the capabilities
it needs as _core_ (not nice-to-have), and each capability checked against the repo as it stands
after round 1.

## The template/instance doctrine

Triage forced the question round 1 never had to answer: where is the line between what the
template ships and what an instance builds? Round 1's implicit answer, made explicit here —
the template ships exactly three kinds of things:

1. **Universal capabilities, fully worked.** Things essentially every instance turns on: auth,
   db, storage, email, analytics, jobs. These get a port, a real adapter for a default vendor,
   a fake, and Simulator presence. The vendor adapter is justified because every instance uses
   it or consciously swaps it.
2. **One worked example per integration class.** The value of jobs+CodeBuild is not CodeBuild —
   it is the proven end-to-end shape for "async external counterparty with callback."
   Likewise llm+Anthropic for streaming vendor APIs, storage+S3 for presigned browser flows,
   service-auth for verified machine callers, and (new this round) outbound webhooks for
   signed egress with retries.
3. **Recipes for everything else** — written down precisely so known patterns don't get built
   early (the realtime-recipe precedent, `docs/development-approach.md`).

Instances ship: domain features, plus additional members of already-demonstrated classes —
more job kinds, more webhook events, more email handlers, more vendor adapters written by
following the worked example.

**The two tests for shipping vendor code:** _universality_ (will every instance use it?) and
_new-class_ (does it demonstrate integration mechanics the template doesn't already teach?).
Fail both → recipe. A vendor adapter most instances would delete is not coverage; it is dead
code with a maintenance bill, and it fights the repo's own dead-code discipline and the
"buy non-differentiating things when you need them" principle.

Note the port test is _not_ the capability test: authz, audit, and escalations all shipped
port-less in round 1 because they pass universality (or, for gates below, new-class). The port
test governs vendor code specifically.

**Key consequence.** Once signed egress lands, the template's integration classes are
complete for callback-driven vendors: outbound API call, inbound verified webhook, state
machine, artifacts. From then on, a Zoho-Sign- or Twilio-class integration is instance work by
recipe — building one in the template would be demonstrating an existing class twice with a
different logo.

## Capability × demand matrix

Demand = how many of the 19 types need the capability as core. Status is the repo today.

| Capability                                                           | Demand            | Status today                                                                     |
| -------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------- |
| Generic list/table kit (paginate/sort/filter/bulk)                   | 16                | Split — keyset pagination worked in keel; the grid is `docs/recipes/list-kit.md` |
| Settings surface (org settings, notification prefs)                  | 15                | Partial — profile only; Security placeholder                                     |
| Full-text search                                                     | 13                | Missing                                                                          |
| Billing & subscriptions (plans, entitlements, invoices)              | 12                | Missing                                                                          |
| Scheduled/recurring work (reminders, digests, SLA, dunning)          | 12                | Worked — `job_schedules` + cron tick + digest email                              |
| Notifications beyond email (in-app, prefs, more channels)            | 12                | Worked — in-app bell + prefs + channel fan-out                                   |
| Charts/dashboard kit                                                 | 10                | Missing                                                                          |
| CSV import + generalized export                                      | 10                | Partial — a CSV export job kind + an LLM analysis one; no import                 |
| Rich text editing                                                    | 9                 | Missing — recorded deliberate non-gap (round 1)                                  |
| Multi-step wizard/onboarding                                         | 8                 | Missing                                                                          |
| Rate limiting + quotas/usage metering                                | 8                 | Missing                                                                          |
| Public data-backed pages + SEO                                       | 8                 | Partial — public routes exist, no SEO pattern                                    |
| GDPR/data lifecycle (export/delete/retention)                        | 8                 | Partial — jobs+artifacts give export mechanics                                   |
| Outbound webhooks (signed, retried, DLQ)                             | 7                 | Worked — signed egress + retries; DLQ = `dead`                                   |
| File previews/thumbnails/media pipeline                              | 7                 | Partial — store/download only                                                    |
| Per-item sharing/ACL, share links                                    | 6                 | Missing — abilities are role×subject-type                                        |
| Versioning/revision history                                          | 5                 | Missing — audit log ≠ content versions                                           |
| Activity feeds (product-facing)                                      | 5                 | Partial — audit_events is the seam                                               |
| Custom fields/user-defined schemas                                   | 5                 | Missing                                                                          |
| Calendar/recurrence/timezones                                        | 5                 | Missing                                                                          |
| Realtime/multiplayer                                                 | 5                 | Recipe (deliberate — holds)                                                      |
| Access gating with resolution flows (ToS, verification, entitlement) | ~19 low-intensity | Worked — gate class + clickwrap; riders/e-sign by recipe                         |
| Self-serve API keys + customer API surface                           | 4                 | Partial — service_keys is M2M; UI deliberately deferred                          |
| SMS/push channels                                                    | 4                 | Fake SMS channel + recipes; web-push = recipe                                    |
| Moderation/flagging                                                  | 4                 | Missing (largely composable from existing patterns)                              |
| Formal e-signature (vendor ceremony)                                 | 3                 | Recipe — externally-resolved gate, `docs/recipes/e-sign.md`                      |
| Inbound email processing                                             | 3                 | Worked — signed Mailgun intake + handler registry                                |
| Ledger/double-entry money                                            | 3                 | Missing                                                                          |
| Time-series ingest + alert rules                                     | 2                 | Missing                                                                          |

(An earlier draft had one "e-signature (2/19)" row; it split into near-universal **clickwrap
acceptance** — subsumed into the access-gating row — and low-demand **formal e-sign**.)

Capabilities demanded everywhere and already covered, for the record: auth/orgs/roles/invites,
tenancy/RLS, authz + audit, file upload, async jobs + timelines, approval flows, M2M + inbound
webhooks, LLM + tool loops, email send, analytics + flags, i18n, per-tenant theming, demo mode.

## Triage

Priority for building = demand breadth × retrofit pain × house leverage (where a
port+fake+Simulator+static-twin treatment is the template's unique value versus app code
anyone writes later), filtered through the doctrine above. Round-2 focus, decided during
triage: the template concentrates on capabilities involving external-service seams and missing
classes; UI kits are tracked on their own list rather than built speculatively.

### Build — the five slices

Notably, the build list ships **zero new vendors**. The only vendor code is an EventBridge tick
(AWS is already the deployment target, ADR-0001) and a Mailgun inbound verifier (already the outbound
vendor, ADR-0011, now used in both directions). Everything else is app-owned machinery, patterns, and
in-slice recipes.

**Scheduled & recurring work**. The external service is just a tick source;
everything else is app-owned. Org-scoped `job_schedules` (RLS per `1001_tickets.ts`) with pure next-run
computation in `packages/keel/src/core/schedules.ts` (interval / daily / weekly; no cron-lib, no RRULE —
that stays a recipe). Real tick = EventBridge rule → `POST /api/webhooks/cron` on the existing webhook-secret
seam; fake tick = Simulator Jobs tab grows "advance clock / run due now" (extending the run-pending
precedent), and the actor runtime ticks. `runDueSchedules(now)` scans due rows, spawns through the existing
jobs port, records audit events. Demo payoff: a `digest-email` scheduled kind lands a digest in Simulator
Mail. Cutover row `scheduled-tick`. **Size: M.** Unlocks the core loop of ~12/19 types (reminders, digests,
SLA timers, dunning) and the outbound-webhook retries.

_Built 2026-07-23, as intended, with these small design choices recorded in `docs/decision-log.md`:_
the three spec shapes are UTC-only with documented scheduled-time (anti-drift) anchoring and
coalescing of missed slots; `runDueSchedules` advances `next_run_at` in the SAME `FOR UPDATE`
transaction as the spawn (idempotent) and reuses the existing jobs path verbatim. The Simulator
world clock is a `.data/simulator/clock.json` offset (a Snapshots LIVE_DIR, so reset clears it), and
_advancing the clock also drains due schedules_ (so the digest appears in one click) alongside a
manual "run due now" and "reset clock". The `digest-email` is addressed to the team's admin so it
lands in a real Simulator inbox; a schedule firing is audited as `schedule.fired` by a synthetic
`system:scheduler` actor (new ability `SubjectType` `JobSchedule`). No new vendor; the EventBridge
tick is authored only as the `scheduled-tick` cutover row + a stack comment (a correct API-
Destination construct depends on the not-yet-provisioned `job-runner` secret).

**Outbound webhooks**. The last missing integration class: signed egress.
Org-scoped `webhook_endpoints` + operational (full-CRUD) `webhook_deliveries`; HMAC-SHA256 + timestamp signing
— new (today's inbound job webhook, `packages/keel/src/service-auth/webhook.ts`, is a plain shared-secret
bearer check with no HMAC or timestamp; the storage-upload target's HMAC-signed fields are the closer
precedent); real delivery = fetch, fake delivery = a Simulator counterparty that receives and displays (the
Actors precedent). A small event registry in `packages/keel/src/core`; demo emitters: job status changes,
escalation events. Retry backoff computed in core, `next_attempt_at` drained by the scheduled-work drain. Minimal
org-admin endpoint card, `authorize()`-gated. **Size: M.**

_Built 2026-07-23, as intended, with these design choices recorded in `docs/decision-log.md`:_ the HMAC-SHA256
signer landed in `packages/keel/src/core` (pure isomorphic TS, no `node:crypto`/`crypto.subtle`) rather
than server-lib, because the static-demo twin must sign too on `file://` — cross-checked against `node:crypto`
in test; BOTH halves ship (sign + `verifyWebhookSignature` with a replay window, the e2e verifies real
egress). Dispatch is an app-owned seam (server-lib `fetch` + `adapters/fake` catch-store,
`isSimulated`-selected) INJECTED into the drain so `packages/keel/src/db` stays free of `@/adapters`.
Delivery is at-least-once via a claim-then-dispatch drain (`runDueDeliveries`, the per-tenant `tenants ×
withTenant` shape) wired into the same ticks that drain schedules; backoff 1m/5m/30m/2h/6h, 5 attempts →
`dead`. `webhook_deliveries` is operational (in-place status UPDATE + `ON DELETE CASCADE`), the durable record
being the append-only audit trail (`webhook.delivered`/`webhook.dead`). Simulator grew a **Hooks** tab
(endpoints + deliveries with the signed body/header inspectable, a per-endpoint failure toggle, "deliver due
now"); the org card shows the server-generated secret once (plaintext at rest — a real instance may vault it).
No cutover row — customer URLs/secrets are runtime data, not deploy params, and no vendor is forced.

**Notifications**. A prefs-driven fan-out seam
(`packages/keel/src/server-lib/notify.ts` — app-owned server machinery, not a vendor port) over channels:
**in-app** (new `notifications` table, header bell + unread via the house polling doctrine), **email** (the
existing port), and a **fake SMS channel** captured to a Simulator Messages view — the second consumer that
keeps the channel abstraction honest without shipping vendor code. Twilio and web-push/VAPID channels are
written as in-slice recipes (the web-push one records the service-worker caveat for the static demo).
`notification_prefs` (user × kind × channel) with a prefs section on the profile screen. First producers:
invite, job completion, escalation received. **Size: M.**

_Built 2026-07-23, as intended, with these design choices recorded in `docs/decision-log.md`:_ the fan-out is
app-owned server machinery (`packages/keel/src/server-lib/notify.ts` + injected deps), NOT a vendor port
— the webhook-dispatch settlement, since `in_app` is the db, `email` the existing port, and `sms` an app-owned
fake-only seam (`packages/keel/src/server-lib/sms.ts`, `.data/sms/` catch-store, NO-OP in real mode; so
the plan's `packages/keel/src/ports/notify.ts` never materialised). The pure decision
(`resolveEnabledChannels`, `notificationCopy`) lives in `packages/keel/src/core/notifications.ts`, shared
verbatim by server and the static twin. Prefs are OPT-OUT (every channel on unless a row disables it) and
org-scoped; the fan-out resolves them by the notification's org. Recipients where the obvious one is absent:
`org.invited` → the inviting team's other admins (the invitee has no account yet); `job.completed` → the org's
admins for the user-facing `export-tickets` kind only (the `jobs` table has no creator column);
`escalation.received` → the responder team's admins (the demo headline). `in_app` is written synchronously
(durable bell), `email`/`sms` ride `deferAfterResponse` with per-channel fault isolation. The header bell
polls on the house doctrine and marks ALL read on open; `Notification` / `NotificationPref` are new self-only
ability subjects. Simulator grew a read-only **Messages** tab (the SMS catch-store, a new LIVE_DIR). The
Twilio and web-push channels ship as `docs/recipes/sms-twilio.md` + `docs/recipes/web-push.md`. No cutover row
— zero vendor is forced.

**Inbound email**. Completes the existing Mailgun vendor in both
directions. `POST /api/webhooks/email` verifying Mailgun's signature scheme (HMAC over
timestamp+token) beside the existing webhook verifier; normalized stored messages with
tenant/org resolution from the recipient address pattern; a handler registry shaped like the
job-handler registry with one demo handler (email-to-note); bounce/complaint events route
through the same entry — the near-universal deliverability case. Fake: Simulator Mail grows
"compose inbound" — the world can email the app. Cutover row `email-inbound`. **Size: S–M.**

_Built 2026-07-23, as intended, with these design choices recorded in `docs/decision-log.md`:_ the recipient
scheme is plus/sub-addressing `<org-slug>+<handler>@<domain>` (single domain, single catch-all Route; the
parser is pure in `packages/keel/src/core/inbound-email.ts`, shared by server and static twin). Org
resolution is GLOBAL-by-slug and yields the tenant too; `inbound_emails.org_id` (migration 0012, tenant RLS
per 1001) is NULLable for the real MULTI-domain path (domain→tenant, org possibly unknown) even though the
single-domain template never files a null-org row — the RLS proof exercises it directly. Mailgun's inbound
signature (`HMAC-SHA256(signingKey, timestamp+token)`) reuses
`packages/keel/src/core/webhook-signing.ts`'s primitive (a new `verifyMailgunSignature`, cross-checked
against `node:crypto`); the stateful signing-key lookup + a per-process token replay guard sit in
`packages/keel/src/service-auth/mailgun.ts` beside the bearer verifier, and the route wraps in a new
`withMailgunSignature` (the `webhooks/` authorize-exemption `mustMatch` was widened to accept it). Intake
(`packages/keel/src/inbound-email/`, the `apps/showcase/src/jobs/` registry shape) files a 'received' row, runs the
address's handler in-tenant, and records the final status; the demo `note` handler creates a note ONLY for a
sender who is a member of the resolved org (an unmatched sender or unknown handler slug files 'unmatched'; a
handler throw files 'failed' and STILL returns 200 so a poison message never triggers a Mailgun retry storm).
Audit writes `inbound-email.received` (new audit-only subject `InboundEmail`) plus the handler's own
`note.created`. Simulated mode: Simulator's Mail tab grew a "compose inbound" affordance + a world inbound list,
and — the honest mechanism — compose calls the SAME intake seam directly rather than spoofing a signature.
Inbound is intake machinery, NOT a new `email` port method (ADR-0011): the app never calls "receive
email", the world does. Cutover row `email-inbound` (Route config + signing key env + bounce/complaint note).
No new vendor SDK — the HMAC is hand-implemented.

**Access gates + agreements**. A missing _class_: a condition an actor must satisfy
before proceeding, with scope (everything vs specific actions), a resolution flow, and a behavior (block vs
advisory). `authorize()` does per-action deny; nothing in the template teaches block-with-resolution.
`packages/keel/src/core/gates.ts` evaluates actor + registered gates

- facts → pending gates; one hook in the protected layout glue renders a generic interstitial
  shell for blocking gates; a seam note covers action-scoped gates via abilities. The worked
  example is **agreements/clickwrap**: tenant-scoped versioned `agreements` with gating behavior
  as data (block-all / block-actions / advisory) + append-only `agreement_acceptances` (the
  audit_events privilege pattern), re-acceptance on version bump, acceptances listed on the
  profile, Simulator version-bump as the demo story. Future riders of the same seam: email
  verification, MFA enrollment (the ADR-0003 deferral), onboarding completeness,
  training/certification gates, suspension, and billing entitlements — which is what defuses the
  billing-retrofit risk below. Formal e-sign ships as a **recipe**: an externally-resolved gate
  riding the callback class (outbound call → inbound webhook → state machine → signed artifact),
  Zoho/DocuSign port shape sketched only. **Size: M.**

    _Built 2026-07-23, as intended, with these design choices recorded in `docs/decision-log.md`:_ the
    reusable thing is the GATE class (`packages/keel/src/core/gates.ts`) — `evaluateGates(registered,
facts)` over an open `GateFacts` bag, complementing (not replacing) `authorize()`'s per-action deny;
    agreements (`packages/keel/src/core/agreements.ts`) are one rider whose block/advisory behavior is
    per-row DATA. v1 implements scope `'all'` only; action-scoped gates are TYPED and their `authorize()`-side
    hook documented, not built. Agreements are TENANT-level (a recorded deviation from the org-scoped default
    — a site's ToS applies to everyone), migration `0013` with tenant RLS + an APPEND-ONLY
    `agreement_acceptances` (the `audit_events` pattern, `agreement_version` denormalized), RLS proofs for
    both. The gate is evaluated ONCE in the protected layout RSC; a blocking agreement renders a generic
    `GateInterstitial` in place (no separate route, no loop), an advisory one a dismissible banner. Accept is
    a self-only authorized mutation (`AgreementAcceptance` ability subject) + audit; the version bump is a
    simulated-mode Simulator Snapshots-tab god op (the demo story). The seed pre-accepts all seed people + records
    clickwrap-on-join for invited people, keeping every existing e2e green; the world stays stable until an
    operator bumps. Formal e-sign shipped as a recipe (`docs/recipes/e-sign.md`) — an externally-resolved gate
    riding the existing callback class, port shape sketched only. Full static-twin parity (same pure core over
    in-memory state). No new vendor.

### Defer — port-class

- **Billing & subscriptions.** The largest single gap by demand (12/19) and the worst
  retrofit-pain profile — entitlement checks infect authz. Deferred anyway as a deliberate
  call; the gate seam is the pre-cut for entitlements, which is most of what made late
  billing expensive. When built: `billing` port, Stripe default vendor, Simulator Billing tab
  (simulate plan change / payment failure / dunning), Stripe webhook on the existing seam.
- **Rate limiting + quotas/metering.** No consumer without billing; rate limiting alone is
  middleware, not an external-service seam. Revisit with billing.

### Defer — UI backlog (tracked here, deliberately not built)

The round-2 focus decision: these are real demand, but they are app-buildable UI over existing
seams, and speculative UI kits age badly. Highest demand first: generic list/table kit (16/19 —
the single most-demanded gap on any list; **resolved 2026-07-31, see below**),
settings surface (15/19), CSV import/export UI (10/19), chart/dashboard kit (10/19), rich text
(9/19 — also a recorded round-1 non-gap), wizard/stepper + onboarding (8/19), media/preview UI
(7/19).

**The list/table kit, resolved 2026-07-31 — and the doctrine it forced.** Taking the top row off this
list did not mean building it. Asking "should keel ship a `<DataTable>`?" exposed that the two tests
above govern _vendor_ code and nothing governed _components_, even though keel already ships around
thirty screens. The answer, now recorded in `docs/development-approach.md` as a third test: **does this
component encode a framework invariant, or is it generic presentation?** Every keel screen is the
presentation half of a capability keel owns (auth needs a sign-in screen; gates need an interstitial); a
sortable table has no capability behind it, and shipping one would put the framework in competition with
Mantine, which ADR-0005 chose as the only component library. So the grid is a recipe
(`docs/recipes/list-kit.md`, over Mantine + TanStack Table).

But the same test identified the part that IS an invariant and had to be extracted: **a paginated read
of a tenant-scoped table**. A cursor is client input, so page seven must be scoped exactly like page
one; the ordering must be total; the page size must be capped server-side. That shipped as
`packages/keel/src/core/keyset.ts` + `packages/keel/src/db/keyset.ts`, is proven in both halves of the
RLS suite on both engines (including against a cursor minted in another tenant, and one hand-crafted to
name another tenant's row), and is demonstrated on the showcase's ticket queue with a static-demo twin.
The matrix row above is split accordingly. The rest of this list is untouched — and the same UI test now
applies to each of them when its turn comes.

### Defer — recipe-class (listed; written only when an app forces them)

Search (Postgres tsvector pattern — additive migrations + a header slot, low retrofit cost,
which is why it can wait despite 13/19 demand), per-item ACL/share links, custom fields/JSONB
schemas, versioning history, public SEO pattern, calendar/recurrence/RRULE, ledger,
time-series + alerts, GDPR lifecycle, moderation. Recipes that ARE being written, riding their
slices: Twilio SMS channel and web-push channel (now written:
`docs/recipes/sms-twilio.md`, `docs/recipes/web-push.md`), e-sign (now written:
`docs/recipes/e-sign.md`).

## The slices

| Slice                         | Status |
| ----------------------------- | ------ |
| Scheduled & recurring work    | landed |
| Outbound webhooks             | landed |
| Notifications seam + channels | landed |
| Inbound email                 | landed |
| Access gates + agreements     | landed |

Each slice is its own branch/PR done the house way: fake in the same PR, demoable, static-demo
parity twin, e2e proof, cutover row for any real adapter, `pnpm verify` (+ `pnpm test:contract`
for migrations), doc-steward pass.

With all five landed, the honest claim becomes: _of the nineteen app types surveyed, every
capability that is universal or class-defining is either worked in the template or written down
as a recipe — what remains missing is, by recorded decision, either an instance's job or a
deliberate deferral with its trigger named._ That is the bar this document exists to reach.

**Round executed 2026-07-23**: all five slices — scheduled work, outbound webhooks,
notifications, inbound email, access gates + agreements — landed the house
way (fake in the same PR, static-demo twin, e2e proof, cutover row where a real adapter was
authored, `pnpm verify` + `pnpm test:contract`, doc-steward pass). The capability matrix and
table of slices above reflect the landed state.
