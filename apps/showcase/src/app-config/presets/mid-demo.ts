import type { DemoPreset } from 'keel/core/presets'
import { MORNING_TICKETS } from './morning-tickets'

export const midDemo: DemoPreset = {
    // A shift in progress: two new tickets in the queue, the refund one already handed to Sam, and a
    // teammate who has not joined yet — whose invite is sitting unread in their inbox, ready to be
    // accepted on camera. Signed in as Dana, from the seeded desk it extends.
    id: 'mid-demo',
    titleKey: 'presets.midDemoTitle',
    summaryKey: 'presets.midDemoSummary',
    extends: 'fresh',
    operations: [
        ...MORNING_TICKETS,
        // The app's own kind (./operations/ticket-assign): Dana assigns the ticket the refund email opened.
        { op: 'ticket.assign', by: 'person-admin', org: 'frontline', ticket: 'refund', to: 'person-staff' },
        { op: 'invite', by: 'person-admin', org: 'frontline', email: 'jordan.ellis@example.test', role: 'member' },
    ],
}
