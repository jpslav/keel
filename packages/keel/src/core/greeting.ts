/**
 * Sample packages/keel/src/core module: pure TypeScript, framework-free (ADR-0006), unit-tested without any harness.
 */
export function normalizeDisplayName(input: string): string {
    const trimmed = input.trim().replace(/\s+/g, ' ')
    if (!trimmed) return ''
    return trimmed
        .split(' ')
        .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
        .join(' ')
}
