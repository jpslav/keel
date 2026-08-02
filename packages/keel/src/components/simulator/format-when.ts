/**
 * Human timestamp for Simulator surfaces (mail rows, snapshot rows, event log). Falls back to the
 * raw value when it isn't a parseable instant (the static twin stamps some rows with plain
 * labels). Pure helper — locale arrives from the caller's next-intl context.
 */
export function formatWhen(value: string, locale: string): string {
    const parsed = Date.parse(value)
    if (Number.isNaN(parsed)) return value
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

/**
 * Time-only variant for compact rows (the Events log's right-aligned column): drops the date so a
 * narrow row shows just the clock time. Same invalid-instant fallback as formatWhen.
 */
export function formatTimeShort(value: string, locale: string): string {
    const parsed = Date.parse(value)
    if (Number.isNaN(parsed)) return value
    return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(parsed)
}
