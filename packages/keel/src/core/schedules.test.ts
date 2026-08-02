import { describe, expect, it } from 'vitest'
import {
    computeNextRunAt,
    isScheduleSpec,
    MAX_INTERVAL_MINUTES,
    parseScheduleSpec,
    type ScheduleSpec,
} from './schedules'

/** ISO helper so failures read as instants, not epoch ms. */
const at = (iso: string) => new Date(iso)

describe('parseScheduleSpec', () => {
    it('accepts the three valid shapes and returns them typed', () => {
        expect(parseScheduleSpec({ type: 'interval', everyMinutes: 60 })).toEqual({
            type: 'interval',
            everyMinutes: 60,
        })
        expect(parseScheduleSpec({ type: 'daily', atUtcHour: 9, atUtcMinute: 30 })).toEqual({
            type: 'daily',
            atUtcHour: 9,
            atUtcMinute: 30,
        })
        expect(parseScheduleSpec({ type: 'weekly', utcDay: 1, atUtcHour: 0, atUtcMinute: 0 })).toEqual({
            type: 'weekly',
            utcDay: 1,
            atUtcHour: 0,
            atUtcMinute: 0,
        })
    })

    it('rejects malformed specs with a descriptive error', () => {
        expect(() => parseScheduleSpec(null)).toThrow(/object/)
        expect(() => parseScheduleSpec({ type: 'nope' })).toThrow(/unknown schedule spec type/)
        expect(() => parseScheduleSpec({ type: 'interval', everyMinutes: 0 })).toThrow(/everyMinutes/)
        expect(() => parseScheduleSpec({ type: 'interval', everyMinutes: 1.5 })).toThrow(/everyMinutes/)
        expect(() => parseScheduleSpec({ type: 'interval', everyMinutes: MAX_INTERVAL_MINUTES + 1 })).toThrow(
            /everyMinutes/,
        )
        expect(() => parseScheduleSpec({ type: 'daily', atUtcHour: 24, atUtcMinute: 0 })).toThrow(/atUtcHour/)
        expect(() => parseScheduleSpec({ type: 'daily', atUtcHour: 9, atUtcMinute: 60 })).toThrow(/atUtcMinute/)
        expect(() => parseScheduleSpec({ type: 'weekly', utcDay: 7, atUtcHour: 0, atUtcMinute: 0 })).toThrow(/utcDay/)
    })

    it('isScheduleSpec is the non-throwing predicate', () => {
        expect(isScheduleSpec({ type: 'daily', atUtcHour: 1, atUtcMinute: 2 })).toBe(true)
        expect(isScheduleSpec({ type: 'weekly', utcDay: 9 })).toBe(false)
        expect(isScheduleSpec('nope')).toBe(false)
    })
})

describe('computeNextRunAt — interval', () => {
    const spec: ScheduleSpec = { type: 'interval', everyMinutes: 60 }

    it('advances one interval from the given instant', () => {
        expect(computeNextRunAt(spec, at('2026-07-23T10:00:00.000Z')).toISOString()).toBe('2026-07-23T11:00:00.000Z')
    })

    it('does NOT drift when fed its own scheduled time back (scheduled-time anchoring)', () => {
        // Simulate a series where each next is computed from the PREVIOUS scheduled time, not a delayed
        // "now" — the phase must stay aligned to the origin no matter how late each tick runs.
        let scheduled = at('2026-07-23T00:00:00.000Z')
        for (let i = 0; i < 24; i++) scheduled = computeNextRunAt(spec, scheduled)
        expect(scheduled.toISOString()).toBe('2026-07-24T00:00:00.000Z') // exactly 24h later, no accumulated skew
    })

    it('crosses a month boundary cleanly (pure epoch-ms arithmetic)', () => {
        const spec2: ScheduleSpec = { type: 'interval', everyMinutes: 90 }
        expect(computeNextRunAt(spec2, at('2026-07-31T23:00:00.000Z')).toISOString()).toBe('2026-08-01T00:30:00.000Z')
    })
})

describe('computeNextRunAt — daily', () => {
    const spec: ScheduleSpec = { type: 'daily', atUtcHour: 9, atUtcMinute: 0 }

    it('fires later the same day when the time is still ahead', () => {
        expect(computeNextRunAt(spec, at('2026-07-23T06:00:00.000Z')).toISOString()).toBe('2026-07-23T09:00:00.000Z')
    })

    it('rolls to tomorrow when the time has passed', () => {
        expect(computeNextRunAt(spec, at('2026-07-23T09:00:00.000Z')).toISOString()).toBe('2026-07-24T09:00:00.000Z')
        expect(computeNextRunAt(spec, at('2026-07-23T12:00:00.000Z')).toISOString()).toBe('2026-07-24T09:00:00.000Z')
    })

    it('rolls across a month/year boundary', () => {
        expect(computeNextRunAt(spec, at('2026-12-31T10:00:00.000Z')).toISOString()).toBe('2027-01-01T09:00:00.000Z')
    })

    it('is DST-irrelevant: the same UTC wall time across a spring-forward boundary', () => {
        // US spring-forward is 2026-03-08. A UTC-anchored daily fire is unaffected — always 09:00Z.
        expect(computeNextRunAt(spec, at('2026-03-08T06:00:00.000Z')).toISOString()).toBe('2026-03-08T09:00:00.000Z')
        expect(computeNextRunAt(spec, at('2026-03-08T09:30:00.000Z')).toISOString()).toBe('2026-03-09T09:00:00.000Z')
    })
})

describe('computeNextRunAt — weekly', () => {
    // Monday 09:00 UTC. 2026-07-23 is a Thursday (getUTCDay 4).
    const spec: ScheduleSpec = { type: 'weekly', utcDay: 1, atUtcHour: 9, atUtcMinute: 0 }

    it('advances to the next occurrence of the weekday', () => {
        // From Thu 2026-07-23 → next Monday is 2026-07-27.
        expect(computeNextRunAt(spec, at('2026-07-23T10:00:00.000Z')).toISOString()).toBe('2026-07-27T09:00:00.000Z')
    })

    it('fires later the same day when today IS the weekday and the time is ahead', () => {
        // 2026-07-27 is a Monday.
        expect(computeNextRunAt(spec, at('2026-07-27T06:00:00.000Z')).toISOString()).toBe('2026-07-27T09:00:00.000Z')
    })

    it('rolls a full week when today is the weekday but the time has passed', () => {
        expect(computeNextRunAt(spec, at('2026-07-27T09:00:00.000Z')).toISOString()).toBe('2026-08-03T09:00:00.000Z')
    })

    it('every step is exactly seven days apart (no drift across a month boundary)', () => {
        let scheduled = at('2026-07-27T09:00:00.000Z')
        const first = computeNextRunAt(spec, scheduled)
        scheduled = computeNextRunAt(spec, first)
        expect(first.toISOString()).toBe('2026-08-03T09:00:00.000Z')
        expect(scheduled.toISOString()).toBe('2026-08-10T09:00:00.000Z')
    })
})
