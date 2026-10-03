/**
 * The APP's Simulator registrations (the seam side of the panel's tab strip + the Snapshots flag list,
 * ADR-0012). The framework panel (packages/keel/src/components/simulator/simulator-panel.tsx) owns its subsystem
 * tabs (people, mail, messages, events, jobs, hooks, errors, snapshots) and its two feature flags
 * (demo-banner, jobs-held — KNOWN_FLAGS in packages/keel/src/adapters/fake/analytics.ts); the app registers its OWN
 * Simulator tabs + flags + demo presets HERE. A real adopter replaces this file (its own, or none). PURE
 * TypeScript, no framework value imports (the preset contract is type-only) — shared by the server glue and the static-demo twin.
 *
 * labelKey is resolved by the HOST glue from the `simulator` i18n namespace (matching how the panel
 * labels its own tabs): the seam carries the key, the host translates it and supplies the ReactNode
 * content, so the panel stays router-/data-blind (ADR-0006).
 */

import type { DemoPreset } from 'keel/core/presets'

/** One app-registered Simulator tab. The host translates `labelKey` and supplies the tab's content. */
interface AppSimulatorTab {
    id: string
    labelKey: string
    /** Once opened, keep the content running (hidden) through tab switches and collapse — the panel's
     *  `SimulatorExtraTab.keepMounted`. */
    keepMounted?: boolean
}

/**
 * The demo's one Simulator tab: Actors — in-page automations driving the real service/webhook surfaces
 * (see src/app-config/actors.ts). Rendered between Hooks and Errors via the panel's `extraTabs` prop.
 */
// keepMounted: the actors' tick loops live in this tab's content, so leaving the tab (to watch Jobs
// drain, say) must not stop them.
export const tabs: AppSimulatorTab[] = [{ id: 'actors', labelKey: 'actorsTab', keepMounted: true }]

/** One app-registered Snapshots feature flag. `labelKey` is a FULLY-QUALIFIED path into the APP catalog
 *  (`namespace.key`) — a flag an app invents is app vocabulary, so its copy ships with the app. */
interface AppSimulatorFlag {
    id: string
    labelKey: string
}

/**
 * App feature flags for the Snapshots tab, composed into KNOWN_FLAGS
 * (packages/keel/src/adapters/fake/analytics.ts); snapshots-app.tsx resolves a registered flag's `labelKey`
 * when labelling its toggle.
 *
 * `sla-breach-banner` is the worked example the extension point used to ship without: a desk-specific
 * knob (highlight tickets past their SLA) that no framework flag could reasonably own, flipped from the
 * same Snapshots tab as the framework's own two. It is read by the tickets card, so flipping it changes
 * the product, not just the panel.
 */
export const flags: AppSimulatorFlag[] = [{ id: 'sla-breach-banner', labelKey: 'tickets.slaFlagLabel' }]

/** The weekday-morning emails both busy presets open with. Simulated content, so one language — like the
 *  seed corpus and the tour's typed email (see tours.ts). */
const MORNING_INBOUND = [
    {
        from: 'marisol.vega@example.test',
        subject: 'Refund stuck in pending for three days',
        body: 'A customer was promised a refund on Monday and it still shows as pending. Can someone on the desk check whether it was ever sent?',
    },
    {
        from: 'sam.rivera@example.test',
        subject: 'Checkout times out for shoppers in the EU',
        body: 'Several EU customers report the payment step spinning until it times out. US checkouts look fine.',
    },
] as const

/**
 * DEMO PRESETS (keel/core/presets.ts): named starting points every host can restore — the Snapshots
 * tab lists them, and a tour may name one as its `snapshot`. A preset is the seed plus a script of
 * world operations, replayed by the server through its fake adapters and by the `file://` twin through
 * its in-memory world, so "restore mid-demo" works wherever the demo runs, which a saved `.data/`
 * snapshot never can.
 *
 * Every operation is one the product would allow (keel's seam-conformance suite holds them to it):
 * Dana manages the Frontline Desk and the Platform Team, so she does the inviting; tickets arrive the
 * way the desk's real front door receives them, as email from a member.
 */
export const presets: DemoPreset[] = [
    {
        // The seeded desk, already signed in: "reset" plus the one click every demo starts with.
        id: 'fresh',
        titleKey: 'presets.freshTitle',
        summaryKey: 'presets.freshSummary',
        viewpoint: 'person-admin',
        operations: [],
    },
    {
        // A shift in progress: two new tickets in the queue and a teammate who has not joined yet — whose
        // invite is sitting unread in their inbox, ready to be accepted on camera.
        id: 'mid-demo',
        titleKey: 'presets.midDemoTitle',
        summaryKey: 'presets.midDemoSummary',
        viewpoint: 'person-admin',
        operations: [
            ...MORNING_INBOUND.map((mail) => ({
                op: 'inbound' as const,
                org: 'frontline',
                handler: 'support',
                ...mail,
            })),
            { op: 'invite', by: 'person-admin', org: 'frontline', email: 'jordan.ellis@example.test', role: 'member' },
        ],
    },
    {
        // Both sites at once. Pinebrook is the quiet tenant in the seed; here it has a queue of its own,
        // and one email the desk refused — Riley is restricted, so the intake files it 'unmatched'
        // instead of opening a ticket, which is the email-authoring rule visible in the inbound list.
        id: 'multi-tenant',
        titleKey: 'presets.multiTenantTitle',
        summaryKey: 'presets.multiTenantSummary',
        viewpoint: 'person-guest',
        operations: [
            ...MORNING_INBOUND.map((mail) => ({
                op: 'inbound' as const,
                org: 'frontline',
                handler: 'support',
                ...mail,
            })),
            {
                op: 'inbound',
                org: 'platform',
                handler: 'support',
                from: 'dana.okoye@example.test',
                subject: 'Webhook retries piling up after the deploy',
                body: 'Since the 14:00 deploy the partner webhook retry queue keeps growing. Platform, can you take a look?',
            },
            { op: 'invite', by: 'person-admin', org: 'platform', email: 'priya.shah@example.test', role: 'staff' },
            {
                op: 'inbound',
                org: 'support-crew',
                handler: 'support',
                from: 'gale.bennett@example.test',
                subject: 'Booking confirmations arrive twice',
                body: 'Guests are getting two confirmation emails for every booking since yesterday.',
            },
            {
                op: 'inbound',
                org: 'support-crew',
                handler: 'support',
                from: 'gale.bennett@example.test',
                subject: 'Gift card balance shows zero',
                body: 'A guest says their gift card balance reads zero at checkout but the card was never used.',
            },
            {
                op: 'inbound',
                org: 'support-crew',
                handler: 'support',
                from: 'riley.chen@example.test',
                subject: 'Can I reopen my old ticket?',
                body: 'I would like to reopen the ticket about my reservation from last month.',
            },
            { op: 'flag', flag: 'sla-breach-banner', enabled: true },
        ],
    },
]
