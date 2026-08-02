/**
 * Recurring-schedule timing. PURE TypeScript — no framework imports (ADR-0006,
 * lint-enforced). This is the single source of truth for "when does a schedule next fire", shared
 * verbatim by the server due-scan (packages/keel/src/db/schedules.ts) and the static-demo twin.
 *
 * DELIBERATELY NOT a cron/RRULE engine. Three closed spec shapes cover the reminder/digest/SLA/dunning
 * loop the round-2 sweep found (docs/app-coverage-gaps.md); arbitrary cron expressions and
 * calendar recurrence stay a recipe, not template code. Everything here is UTC — there is no timezone
 * library and no local-time interpretation, so results are identical on every host and DST can never
 * shift a fire time (a UTC day is always exactly 86_400_000 ms). An instance that needs per-user
 * local times layers a tz conversion above this, at the edge; the core stays UTC-only on purpose.
 */

/** A recurring interval, anchored to the schedule's own origin (see computeNextRunAt drift note). */
interface IntervalSpec {
    type: 'interval'
    /** Fire every N minutes. Integer, 1..MAX_INTERVAL_MINUTES (a year), so next-run math stays bounded. */
    everyMinutes: number
}

/** Fire once a day at a fixed UTC wall-clock time. */
interface DailySpec {
    type: 'daily'
    /** 0..23 */
    atUtcHour: number
    /** 0..59 */
    atUtcMinute: number
}

/** Fire once a week on a fixed UTC weekday at a fixed UTC time. */
interface WeeklySpec {
    type: 'weekly'
    /** 0 = Sunday … 6 = Saturday (matches Date.prototype.getUTCDay). */
    utcDay: number
    /** 0..23 */
    atUtcHour: number
    /** 0..59 */
    atUtcMinute: number
}

export type ScheduleSpec = IntervalSpec | DailySpec | WeeklySpec

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000
/** A year in minutes — the interval cap. Keeps the coalescing loop in the due-scan bounded. */
export const MAX_INTERVAL_MINUTES = 366 * 24 * 60

function isInt(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/**
 * Validates an untrusted value (a jsonb column, a seed literal, a request body) into a typed
 * ScheduleSpec, throwing a descriptive Error on anything malformed. Hand-rolled, no zod — validation
 * stays explicit at the boundary, the same discipline the webhook route uses. Callers that persist a
 * spec MUST run it through here first so a bad row can never reach computeNextRunAt.
 */
export function parseScheduleSpec(value: unknown): ScheduleSpec {
    if (typeof value !== 'object' || value === null) throw new Error('schedule spec must be an object')
    const spec = value as Record<string, unknown>
    switch (spec.type) {
        case 'interval':
            if (!isInt(spec.everyMinutes, 1, MAX_INTERVAL_MINUTES)) {
                throw new Error(`interval everyMinutes must be an integer 1..${MAX_INTERVAL_MINUTES}`)
            }
            return { type: 'interval', everyMinutes: spec.everyMinutes }
        case 'daily':
            if (!isInt(spec.atUtcHour, 0, 23) || !isInt(spec.atUtcMinute, 0, 59)) {
                throw new Error('daily atUtcHour must be 0..23 and atUtcMinute 0..59')
            }
            return { type: 'daily', atUtcHour: spec.atUtcHour, atUtcMinute: spec.atUtcMinute }
        case 'weekly':
            if (!isInt(spec.utcDay, 0, 6) || !isInt(spec.atUtcHour, 0, 23) || !isInt(spec.atUtcMinute, 0, 59)) {
                throw new Error('weekly utcDay must be 0..6, atUtcHour 0..23, atUtcMinute 0..59')
            }
            return {
                type: 'weekly',
                utcDay: spec.utcDay,
                atUtcHour: spec.atUtcHour,
                atUtcMinute: spec.atUtcMinute,
            }
        default:
            throw new Error(`unknown schedule spec type: ${String(spec.type)}`)
    }
}

/** Non-throwing predicate — a `parse` that returns a boolean, for guards that don't want the message. */
export function isScheduleSpec(value: unknown): value is ScheduleSpec {
    try {
        parseScheduleSpec(value)
        return true
    } catch {
        return false
    }
}

/**
 * The single next fire time STRICTLY AFTER `from`, in UTC.
 *
 * Drift policy (the decision the slice records): a schedule advances by feeding its OWN scheduled
 * next_run_at back in as `from` — never `now`, never the handler's completion time. So an interval
 * series is `origin, origin+I, origin+2I, …`, anchored to its origin and immune to tick latency or
 * handler duration; "scheduled-time anchoring", not "completion-time anchoring". Because every step is
 * exact epoch-ms arithmetic on a UTC instant, month/year rollovers and DST are non-events.
 *
 * This is a SINGLE step. When a tick is late or the demo world-clock jumps across several missed
 * slots, the due-scan coalesces by stepping from the scheduled anchor until the result passes `now`
 * (packages/keel/src/db/schedules.ts) — firing once and skipping the gap rather than dogpiling one job per missed
 * slot. Anchoring is preserved through the coalesce because each step still lands on an origin-aligned
 * slot.
 */
export function computeNextRunAt(spec: ScheduleSpec, from: Date): Date {
    const fromMs = from.getTime()
    switch (spec.type) {
        case 'interval':
            return new Date(fromMs + spec.everyMinutes * MS_PER_MINUTE)
        case 'daily': {
            const todayAt = Date.UTC(
                from.getUTCFullYear(),
                from.getUTCMonth(),
                from.getUTCDate(),
                spec.atUtcHour,
                spec.atUtcMinute,
            )
            // A UTC day is exactly MS_PER_DAY, so "tomorrow at the same wall time" is just +1 day of ms.
            return new Date(todayAt > fromMs ? todayAt : todayAt + MS_PER_DAY)
        }
        case 'weekly': {
            const todayAt = Date.UTC(
                from.getUTCFullYear(),
                from.getUTCMonth(),
                from.getUTCDate(),
                spec.atUtcHour,
                spec.atUtcMinute,
            )
            const dayDiff = (spec.utcDay - from.getUTCDay() + 7) % 7
            const candidate = todayAt + dayDiff * MS_PER_DAY
            // dayDiff 0 with the time already past today rolls to next week; a future weekday is always
            // strictly after `from` already.
            return new Date(candidate > fromMs ? candidate : candidate + 7 * MS_PER_DAY)
        }
    }
}
