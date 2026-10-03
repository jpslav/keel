import type { DemoPreset } from 'keel/core/presets'
import { MORNING_TICKETS } from './morning-tickets'

export const midDemo: DemoPreset = {
    // A shift in progress: two new tickets in the queue and a teammate who has not joined yet — whose
    // invite is sitting unread in their inbox, ready to be accepted on camera. Signed in as Dana, from
    // the seeded desk it extends.
    id: 'mid-demo',
    titleKey: 'presets.midDemoTitle',
    summaryKey: 'presets.midDemoSummary',
    extends: 'fresh',
    operations: [
        ...MORNING_TICKETS,
        { op: 'invite', by: 'person-admin', org: 'frontline', email: 'jordan.ellis@example.test', role: 'member' },
    ],
}
