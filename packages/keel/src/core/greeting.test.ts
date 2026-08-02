import { describe, expect, test } from 'vitest'
import { normalizeDisplayName } from './greeting'

describe('normalizeDisplayName', () => {
    test('trims and collapses whitespace', () => {
        expect(normalizeDisplayName('  ada   lovelace ')).toBe('Ada Lovelace')
    })

    test('capitalizes each word', () => {
        expect(normalizeDisplayName('grace hopper')).toBe('Grace Hopper')
    })

    test('returns empty string for blank input', () => {
        expect(normalizeDisplayName('   ')).toBe('')
    })

    test('handles non-ASCII names', () => {
        expect(normalizeDisplayName('águeda núñez')).toBe('Águeda Núñez')
    })
})
