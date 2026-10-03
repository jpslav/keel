import type { PresetOperation } from 'keel/core/presets'

/** The weekday-morning emails every busy preset opens with, sent to the Frontline Desk's front door.
 *  Simulated content, so one language — like the seed corpus and the tour's typed email (see tours.ts).
 *  Held in `mid-demo` and inherited by `multi-tenant` (`extends`), so the two share it by construction.
 *  The refund email's ticket is named `refund` (`as`), so a later step can act on it. */
export const MORNING_TICKETS: PresetOperation[] = [
    {
        op: 'inbound',
        as: 'refund',
        org: 'frontline',
        handler: 'support',
        from: 'marisol.vega@example.test',
        subject: 'Refund stuck in pending for three days',
        body: 'A customer was promised a refund on Monday and it still shows as pending. Can someone on the desk check whether it was ever sent?',
    },
    {
        op: 'inbound',
        org: 'frontline',
        handler: 'support',
        from: 'sam.rivera@example.test',
        subject: 'Checkout times out for shoppers in the EU',
        body: 'Several EU customers report the payment step spinning until it times out. US checkouts look fine.',
    },
]
