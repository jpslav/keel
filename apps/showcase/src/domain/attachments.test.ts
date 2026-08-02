import { describe, expect, test } from 'vitest'
import { ATTACHMENT_MAX_BYTES, formatBytes, isAttachmentKind, sanitizeFilename } from './attachments'

describe('isAttachmentKind', () => {
    test('accepts the shipped kind, rejects anything else', () => {
        expect(isAttachmentKind('attachment')).toBe(true)
        expect(isAttachmentKind('results')).toBe(false)
        expect(isAttachmentKind('')).toBe(false)
    })
})

describe('sanitizeFilename', () => {
    test('keeps a plain name unchanged', () => {
        expect(sanitizeFilename('report.csv')).toBe('report.csv')
    })

    test('strips any directory portion (never a path escape in the storage key)', () => {
        expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
        expect(sanitizeFilename('a/b/c.txt')).toBe('c.txt')
        expect(sanitizeFilename('C:\\temp\\evil.exe')).toBe('evil.exe')
    })

    test('collapses unsafe characters and drops leading dots', () => {
        expect(sanitizeFilename('my file (final).pdf')).toBe('my_file_final_.pdf')
        expect(sanitizeFilename('...hidden')).toBe('hidden')
    })

    test('falls back to "file" when nothing usable remains, and caps length', () => {
        expect(sanitizeFilename('')).toBe('file')
        expect(sanitizeFilename('/'.repeat(5))).toBe('file')
        expect(sanitizeFilename(`${'a'.repeat(300)}.txt`).length).toBeLessThanOrEqual(128)
    })
})

describe('formatBytes', () => {
    test('renders locale-neutral B / KB / MB and an em dash for unknown', () => {
        expect(formatBytes(null)).toBe('—')
        expect(formatBytes(undefined)).toBe('—')
        expect(formatBytes(512)).toBe('512 B')
        expect(formatBytes(2048)).toBe('2.0 KB')
        expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    })
})

test('ATTACHMENT_MAX_BYTES is the 5 MiB scaffold default', () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(5 * 1024 * 1024)
})
