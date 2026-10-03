import type { DemoPreset } from 'keel/core/presets'

export const multiTenant: DemoPreset = {
    // Both sites at once, on top of mid-demo (the Frontline morning tickets and Jordan's invite come
    // from it). Pinebrook is the quiet tenant in the seed; here it has a queue of its own, and one email
    // the desk refused — Riley is restricted, so the intake files it 'unmatched' instead of opening a
    // ticket, which is the email-authoring rule visible in the inbound list. The viewpoint overrides
    // the base's: whoever loads this sits down at Pinebrook.
    id: 'multi-tenant',
    titleKey: 'presets.multiTenantTitle',
    summaryKey: 'presets.multiTenantSummary',
    extends: 'mid-demo',
    viewpoint: 'person-guest',
    operations: [
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
}
