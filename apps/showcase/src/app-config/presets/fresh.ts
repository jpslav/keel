import type { DemoPreset } from 'keel/core/presets'

export const fresh: DemoPreset = {
    // The seeded desk, already signed in: "reset" plus the one click every demo starts with.
    id: 'fresh',
    titleKey: 'presets.freshTitle',
    summaryKey: 'presets.freshSummary',
    viewpoint: 'person-admin',
    operations: [],
}
