/**
 * Static seed records — the demo world's DATA, and the showcase's product corpus.
 *
 * The showcase is a SUPPORT DESK: two sites (tenants) run the same desk product. Northwind Support is
 * the busy one — a frontline desk, a platform team behind it, and a small desk-operations org that
 * holds the operator seam; Pinebrook Desk is the quiet second site that proves tenant isolation and
 * the one-team (no switcher) path. The world does not start empty: the rows at the bottom of this file
 * put a queue, an open escalation, an analyzed diagnostic bundle and an unread mail on the table, so a
 * demo starts INSIDE a story instead of building one.
 *
 * This package holds data only. The framework-owned SHAPES it fills in are the seed contract
 * (keel/seed/contracts), imported as types so this stays free of runtime imports; the product-row
 * shapes are the app's own and are declared here. No framework values, no vendor SDKs. The INSERT
 * logic for the product rows lives with the app, in apps/showcase/src/app-config/db/seed-rows.ts.
 */

import type { SeedAgreement, SeedJobSchedule, SeedOrg, SeedPerson, SeedTenant } from 'keel/seed/contracts'

// Re-exported so consumers keep importing the seed vocabulary from one place (the app's seam module
// re-exports this package wholesale).
export type {
    PersonRole,
    SeedAgreement,
    SeedAgreementGating,
    SeedAgreementKind,
    SeedJobSchedule,
    SeedMembership,
    SeedOrg,
    SeedPerson,
    SeedScheduleSpec,
    SeedTenant,
} from 'keel/seed/contracts'

export const tenants: SeedTenant[] = [
    { slug: 'northwind', name: 'Northwind Support', themePrimaryColor: 'indigo', themeRadius: 'sm' },
    // grape (not teal): tenant colors must keep white-on-primary above WCAG AA at shade 8
    { slug: 'pinebrook', name: 'Pinebrook Desk', themePrimaryColor: 'grape', themeRadius: 'xl' },
]

// northwind gets three orgs (the frontline desk, the platform team it escalates to, and the desk-ops
// operator org) so team switching is visible; pinebrook gets one so the ≤1 switcher-hidden path stays
// covered. `desk-ops` is the staff seam: ACTIVE membership in it grants the manage-all ability
// WITHIN the tenant only. Its slug must match `staffOrgSlug` in
// apps/showcase/src/app-config/abilities.ts. (The org `desk-ops` is distinct from the rank-ladder role
// `'staff'` — see the disambiguation note there.)
export const organizations: SeedOrg[] = [
    { slug: 'frontline', name: 'Frontline Desk', tenantSlug: 'northwind' },
    { slug: 'platform', name: 'Platform Team', tenantSlug: 'northwind' },
    { slug: 'desk-ops', name: 'Desk Operations', tenantSlug: 'northwind' },
    { slug: 'support-crew', name: 'Support Crew', tenantSlug: 'pinebrook' },
]

/**
 * The people. The person IDS are mechanical — they are the opaque user ids every table stores, so
 * CHANGING ONE ORPHANS EVERY ROW THAT REFERENCES IT in an existing world (assignees, escalation
 * creators, attachment uploaders, notification recipients, audit `actor_user_id`). They last changed
 * on 2026-07-31 with the Simulator vocabulary (`persona-*` -> `person-*`), which is why that rename
 * required wiping `.data`: the seeder is guarded by "does this world have any rows yet", so a stale
 * world keeps the old ids while sign-in mints the new ones. Do not change them casually.
 *
 * The ROLE MATRIX is load-bearing — admin / staff / member / staff-org operator / guest / restricted,
 * plus one multi-org person so the team switcher has something to switch — and the ability tests and
 * e2e suite depend on its shape.
 */
export const people: SeedPerson[] = [
    {
        id: 'person-admin',
        name: 'Dana Okoye',
        email: 'dana.okoye@example.test',
        locale: 'en',
        tenantSlug: 'northwind',
        // The desk lead. Multi-org (switcher visible), admin on both sides of the escalation flow —
        // so ONE person can raise an escalation on the desk and decide it on the platform team.
        memberships: [
            { orgSlug: 'frontline', role: 'admin' },
            { orgSlug: 'platform', role: 'admin' },
        ],
        restricted: false,
    },
    {
        id: 'person-staff',
        name: 'Sam Rivera',
        email: 'sam.rivera@example.test',
        locale: 'en',
        tenantSlug: 'northwind',
        // Role varies per org: staff (can invite) on the desk, plain member on the platform team —
        // so the same person sees an escalation both teams share, without the decide buttons.
        memberships: [
            { orgSlug: 'frontline', role: 'staff' },
            { orgSlug: 'platform', role: 'member' },
        ],
        restricted: false,
    },
    {
        id: 'person-member',
        name: 'Marisol Vega',
        email: 'marisol.vega@example.test',
        locale: 'es',
        tenantSlug: 'northwind',
        // frontline-only: switching Dana frontline→platform visibly drops Marisol from the member list.
        memberships: [{ orgSlug: 'frontline', role: 'member' }],
        restricted: false,
    },
    {
        id: 'person-operator',
        name: 'Olive Nakamura',
        email: 'olive.nakamura@example.test',
        locale: 'en',
        tenantSlug: 'northwind',
        // The staff seam: admin in the desk-ops operator org. Acting AS desk-ops grants the
        // manage-all ability WITHIN tenant northwind (never across tenants — ADR-0004). Single-org, so
        // her active org is always desk-ops — the manage-all activation is always on.
        memberships: [{ orgSlug: 'desk-ops', role: 'admin' }],
        restricted: false,
    },
    {
        id: 'person-guest',
        name: 'Gale Bennett',
        email: 'gale.bennett@example.test',
        locale: 'en',
        tenantSlug: 'pinebrook',
        memberships: [{ orgSlug: 'support-crew', role: 'guest' }],
        restricted: false,
    },
    {
        id: 'person-restricted',
        name: 'Riley Chen',
        email: 'riley.chen@example.test',
        locale: 'en',
        tenantSlug: 'pinebrook',
        memberships: [{ orgSlug: 'support-crew', role: 'restricted' }],
        restricted: true,
    },
]

/**
 * The demo's agreements. `preAcceptedByAllInTenant` encodes the seed-shape decision that
 * keeps every existing e2e green: the northwind ToS is pre-accepted by EVERYONE in that tenant, so
 * nothing is blocked until a Simulator version bump re-arms the gate (the demo story); the pinebrook
 * privacy notice is accepted by NOBODY so it demonstrates the advisory banner. See the decision log.
 *
 * All THREE AgreementKinds now have a seeded example: `tos` (blocking), `privacy` (advisory), and
 * `custom` — the support-data handling policy a desk product genuinely has, which is exactly what the
 * `custom` kind is for: an agreement whose subject the framework has no opinion about.
 */
export const agreements: SeedAgreement[] = [
    {
        tenantSlug: 'northwind',
        kind: 'tos',
        version: 1,
        title: 'Terms of Service',
        gating: 'block-all',
        preAcceptedByAllInTenant: true,
        bodyMd: [
            '# Terms of Service',
            'These sample Terms of Service stand in for the real agreement an instance would ship. They exist to demonstrate the access-gate seam: a blocking agreement everyone in the tenant must accept before using the desk.',
            '## Acceptable use',
            'Use the product lawfully and do not attempt to disrupt it for others. This is placeholder content — swap it for your own terms at cutover.',
            '## Changes',
            'When these terms change, the version is bumped and you will be asked to accept the new version before continuing.',
        ].join('\n\n'),
    },
    {
        tenantSlug: 'northwind',
        kind: 'custom',
        version: 1,
        title: 'Support Data Handling Policy',
        // Advisory, and accepted by nobody: an agent may keep working the queue while the banner asks
        // them to read it — the second half of the gating pair, on the busy tenant.
        gating: 'advisory',
        preAcceptedByAllInTenant: false,
        bodyMd: [
            '# Support Data Handling Policy',
            'A support desk sees customer data it did not ask for: log bundles, screenshots, order numbers. This sample policy is the `custom` agreement kind — one whose subject the framework has no opinion about, so an instance names it whatever its business needs.',
            '## Diagnostic bundles',
            'Treat every uploaded bundle as confidential. Share a bundle with a partner analyzer only through the escalation it belongs to.',
            '## Retention',
            'Attachments are removed with their ticket. Replace this placeholder with your own policy at cutover.',
        ].join('\n\n'),
    },
    {
        tenantSlug: 'pinebrook',
        kind: 'privacy',
        version: 1,
        title: 'Privacy Notice',
        gating: 'advisory',
        preAcceptedByAllInTenant: false,
        bodyMd: [
            '# Privacy Notice',
            'This sample privacy notice is an ADVISORY agreement: it shows a dismissible banner rather than blocking the app, proving the advisory half of the gate seam.',
            'Replace this placeholder with your real privacy notice at cutover.',
        ].join('\n\n'),
    },
]

/**
 * Seeded recurring job schedules — WHICH org gets WHICH schedule is app/demo content, so it
 * lives here rather than hard-coded in the framework seeder (keel/db/seed.ts), which only takes what
 * the data says.
 *
 * ALL THREE ScheduleSpec shapes are seeded, because a desk really does run all three cadences: a
 * weekly review, a nightly sweep, and a shift-length loop. Advancing the Simulator world clock past a
 * schedule's next_run_at fires it, so the scheduled-work demo works out of the box.
 */
export const jobSchedules: SeedJobSchedule[] = [
    // WEEKLY — Monday 13:00 UTC: the frontline desk's queue review, mailed to its lead.
    {
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        kind: 'digest-email',
        spec: { type: 'weekly', utcDay: 1, atUtcHour: 13, atUtcMinute: 0 },
        createdBy: 'seed',
    },
    // DAILY — 02:00 UTC: the overnight SLA sweep. It exports the desk's whole queue to CSV so the
    // morning stand-up has yesterday's ageing in front of it.
    {
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        kind: 'export-tickets',
        spec: { type: 'daily', atUtcHour: 2, atUtcMinute: 0 },
        createdBy: 'seed',
    },
    // INTERVAL — every 6 hours: the platform team's shift-handover digest of what escalated to them.
    {
        tenantSlug: 'northwind',
        orgSlug: 'platform',
        kind: 'digest-email',
        spec: { type: 'interval', everyMinutes: 360 },
        createdBy: 'seed',
    },
]

// ── The product corpus: the situation already in progress ─────────────────────────────────────────
//
// These shapes are the APP's, not the framework's — a desk has tickets, escalations and attachments;
// keel has no idea. apps/showcase/src/app-config/db/seed-rows.ts turns them into rows (and bytes) on
// first boot, and the whole block is skipped once the world already has a ticket, so a reset restores
// exactly this and nothing accumulates.
//
// Ages are RELATIVE (hours before boot) rather than fixed dates, so the queue looks lived-in whenever
// you start it and the oldest ticket is always visibly past its SLA.

/** One seeded ticket. `ref` is the desk's human-facing number AND this row's idempotence key. */
export interface SeedTicket {
    ref: string
    tenantSlug: string
    orgSlug: string
    subject: string
    body: string
    status: 'open' | 'pending' | 'resolved'
    /** Person id of the agent working it, or null while it sits unclaimed in the queue. */
    assigneePersonId: string | null
    /** How long ago it arrived, in hours before boot. */
    ageHours: number
}

/** One seeded cross-team escalation (the two-sided row both desks see). */
export interface SeedEscalation {
    tenantSlug: string
    requesterOrgSlug: string
    responderOrgSlug: string
    createdByPersonId: string
    subject: string
    body: string
    status: 'open' | 'accepted' | 'rejected' | 'cancelled'
    ageHours: number
}

/** One seeded attachment. `content` is written to storage so its download link works from boot. */
export interface SeedAttachment {
    tenantSlug: string
    orgSlug: string
    kind: 'attachment' | 'diagnostic-bundle'
    filename: string
    contentType: string
    uploadedByPersonId: string
    content: string
    ageHours: number
}

/** One seeded caught email — the desk's outbox as it stood when you walked in. */
export interface SeedMail {
    /** Person id of the recipient; resolved to their address at seed time. */
    toPersonId: string
    subject: string
    text: string
}

export const tickets: SeedTicket[] = [
    // The frontline queue, newest first. Two unassigned (one of them the oldest and worst), two in
    // hand, one already put to bed — the shape of every real queue.
    {
        ref: 'NW-1041',
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        subject: 'Barcode scanners drop their connection after firmware 4.2',
        body: 'Harborview Foods report that handheld scanners disconnect every few minutes since the 4.2 firmware rollout. Arrived by email to frontline+support@; nobody has picked it up yet.',
        status: 'open',
        assigneePersonId: null,
        ageHours: 3,
    },
    {
        ref: 'NW-1039',
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        subject: 'Nightly stock sync failed with a timeout',
        body: "Harborview's 01:00 stock sync has timed out three nights running. Diagnostic bundle uploaded; escalated to the platform team and waiting on their decision.",
        status: 'pending',
        assigneePersonId: 'person-staff',
        ageHours: 27,
    },
    {
        ref: 'NW-1036',
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        subject: 'Cannot add a second warehouse to the account',
        body: 'The "add warehouse" step returns a validation error with no message. Reproduced on the customer\'s account; needs a look at the plan entitlements.',
        status: 'open',
        assigneePersonId: 'person-member',
        ageHours: 52,
    },
    {
        ref: 'NW-1028',
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        subject: 'Invoice PDF shows the wrong tax rate',
        body: 'Invoices for the EU region print 19% where the account is configured for 21%. Four days old, still unassigned — this is the one the SLA sweep will shout about.',
        status: 'open',
        assigneePersonId: null,
        ageHours: 96,
    },
    {
        ref: 'NW-1024',
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        subject: 'Password reset email never arrives',
        body: 'The reset mail was landing in a quarantine rule on the customer side. Confirmed delivered after they allow-listed the sending domain.',
        status: 'resolved',
        assigneePersonId: 'person-staff',
        ageHours: 120,
    },
    // ---- the frontline desk's ARCHIVE ----
    //
    // Six resolved tickets from earlier in the week, older than everything above. A desk that has been
    // open a while has closed work behind it, and a queue with history is what makes the paged list
    // (keel/db/keyset) demonstrate something: the card opens on the five live tickets above and offers
    // "show older tickets" for these. They are deliberately (a) OLDER than NW-1024, so page one is
    // exactly the five that were there before paging existed — the ticket tour and the SLA banner both
    // read page one; and (b) numbered BELOW NW-1041, so the next reference the desk issues is still
    // NW-1042, which that tour says out loud.
    {
        ref: 'NW-1021',
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        subject: 'Stock counts drift after a partial delivery',
        body: 'Counts were off by the short-shipped quantity. Fixed by re-running the reconciliation for the affected delivery note.',
        status: 'resolved',
        assigneePersonId: 'person-member',
        ageHours: 148,
    },
    {
        ref: 'NW-1019',
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        subject: 'Weekly summary email arrives on Sunday instead of Monday',
        body: 'The digest schedule was set in the wrong timezone for this account. Corrected and confirmed with the customer.',
        status: 'resolved',
        assigneePersonId: 'person-staff',
        ageHours: 172,
    },
    {
        ref: 'NW-1015',
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        subject: 'New starter cannot sign in on the shop floor tablet',
        body: 'Their invitation had gone to a mistyped address. Re-invited to the correct one and they are in.',
        status: 'resolved',
        assigneePersonId: 'person-staff',
        ageHours: 196,
    },
    {
        ref: 'NW-1012',
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        subject: 'Purchase order export missing the supplier column',
        body: 'The export template had not been updated after the supplier field was added. New template shipped.',
        status: 'resolved',
        assigneePersonId: 'person-member',
        ageHours: 220,
    },
    {
        ref: 'NW-1008',
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        subject: 'Receipt printer cuts off the last line',
        body: 'Paper size was configured as A4 rather than the roll width. Reconfigured on both tills.',
        status: 'resolved',
        assigneePersonId: 'person-staff',
        ageHours: 244,
    },
    {
        ref: 'NW-1003',
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        subject: 'Duplicate customer records after the data import',
        body: 'The import ran twice. De-duplicated by external id and added a guard so a repeated import is a no-op.',
        status: 'resolved',
        assigneePersonId: 'person-member',
        ageHours: 268,
    },
    // The platform team keeps its own small queue, so switching teams shows a DIFFERENT list rather
    // than an empty one — the team boundary is easier to believe when both sides have something.
    {
        ref: 'NW-1040',
        tenantSlug: 'northwind',
        orgSlug: 'platform',
        subject: 'Sync worker runs out of memory on large catalogues',
        body: "Catalogues over ~200k SKUs push the worker past its memory ceiling. Suspected cause of the frontline desk's timeout reports.",
        status: 'open',
        assigneePersonId: 'person-admin',
        ageHours: 30,
    },
    // The other site has its own, entirely separate queue — the row-level-security demo has something
    // to show on BOTH sides of the boundary instead of one populated tenant and one blank one.
    {
        ref: 'PB-207',
        tenantSlug: 'pinebrook',
        orgSlug: 'support-crew',
        subject: 'Booking confirmations arrive twice',
        body: 'Two identical confirmation emails per booking since Tuesday. Reported by three customers.',
        status: 'open',
        assigneePersonId: null,
        ageHours: 19,
    },
]

export const escalations: SeedEscalation[] = [
    // ONE open escalation, awaiting a decision — the demo opens with a decision on the table.
    {
        tenantSlug: 'northwind',
        requesterOrgSlug: 'frontline',
        responderOrgSlug: 'platform',
        createdByPersonId: 'person-admin',
        subject: 'NW-1039 — nightly stock sync timing out for Harborview Foods',
        body: 'Third night running. Diagnostic bundle attached to the ticket and already analyzed: the sync worker is being OOM-killed mid-run. We need the platform team to own this one.',
        status: 'open',
        ageHours: 26,
    },
]

export const attachments: SeedAttachment[] = [
    // The bundle the customer sent in...
    {
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        kind: 'diagnostic-bundle',
        filename: 'harborview-stock-sync.bundle',
        contentType: 'text/plain',
        uploadedByPersonId: 'person-staff',
        content: [
            'harborview-foods / stock-sync / collected 01:12 UTC',
            'worker=sync-3  catalogue_skus=214880  peak_rss_mb=1974  limit_mb=2048',
            '01:04:11  batch 118/240 ok',
            '01:07:52  batch 154/240 ok  rss=1811mb',
            '01:11:03  worker terminated (out of memory)',
            '01:11:04  sync aborted, 86 batches unprocessed',
        ].join('\n'),
        ageHours: 26,
    },
    // ...and the analysis the bundle-analyzer handed back. This is the "one completed analysis": the
    // world already contains a finished piece of async work, so the Attachments card is not empty and
    // the analyze-bundle job has visible precedent before you ever run it.
    {
        tenantSlug: 'northwind',
        orgSlug: 'frontline',
        kind: 'attachment',
        filename: 'harborview-stock-sync.analysis.md',
        contentType: 'text/markdown',
        uploadedByPersonId: 'person-staff',
        content: [
            '# Bundle analysis — harborview-stock-sync',
            '',
            'The sync worker was terminated by the kernel out-of-memory killer at 01:11 UTC, 86 batches',
            'short of the end of the run. Peak resident memory reached 1974 MB against a 2048 MB limit',
            'while processing a 214,880-SKU catalogue.',
            '',
            '## Suggested next step',
            '',
            'Raise the worker memory ceiling or stream the catalogue in smaller batches. This is a',
            'platform-side change, not a desk-side configuration fix.',
        ].join('\n'),
        ageHours: 25,
    },
]

export const mail: SeedMail[] = [
    // One unread message in the desk's outbox, so the Simulator pill already carries a badge on first
    // load. It is the notification that fired when NW-1039 was handed to Sam — the same copy the live
    // `ticket.assigned` kind produces, frozen as world data.
    {
        toPersonId: 'person-staff',
        subject: 'NW-1039 — nightly stock sync failed with a timeout',
        text: 'Dana Okoye assigned you NW-1039 on the Frontline Desk. The customer has sent a diagnostic bundle; it is on the ticket.',
    },
]

export function findTenant(slug: string): SeedTenant | undefined {
    return tenants.find((t) => t.slug === slug)
}

export function findOrg(slug: string): SeedOrg | undefined {
    return organizations.find((o) => o.slug === slug)
}

export function findPerson(id: string): SeedPerson | undefined {
    return people.find((p) => p.id === id)
}
