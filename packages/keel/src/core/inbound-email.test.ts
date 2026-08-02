import { describe, expect, it } from 'vitest'
import {
    formatInboundRecipient,
    normalizeEmailAddress,
    normalizeInboundBody,
    parseInboundRecipient,
} from './inbound-email'

describe('normalizeEmailAddress', () => {
    it('extracts the addr-spec from a decorated address and lowercases it', () => {
        expect(normalizeEmailAddress('"Ada Keeper" <Ada.Keeper@Example.Test>')).toBe('ada.keeper@example.test')
        expect(normalizeEmailAddress('Sam <sam@x.test>')).toBe('sam@x.test')
    })

    it('passes a bare address through, trimmed and lowercased', () => {
        expect(normalizeEmailAddress('  Foo@Bar.TEST ')).toBe('foo@bar.test')
    })

    it('returns empty for anything without a single usable addr-spec', () => {
        expect(normalizeEmailAddress('not an email')).toBe('')
        expect(normalizeEmailAddress('a@b@c')).toBe('')
        expect(normalizeEmailAddress('@nope')).toBe('')
        expect(normalizeEmailAddress('nope@')).toBe('')
    })
})

describe('parseInboundRecipient', () => {
    it('parses <org-slug>+<handler>@domain', () => {
        expect(parseInboundRecipient('depot+support@mg.example.com')).toEqual({
            orgSlug: 'depot',
            handler: 'support',
        })
    })

    it('is case-insensitive and strips a display name', () => {
        expect(parseInboundRecipient('"Team" <Depot+Support@MG.Example.COM>')).toEqual({
            orgSlug: 'depot',
            handler: 'support',
        })
    })

    it('accepts hyphenated slugs on both halves', () => {
        expect(parseInboundRecipient('wharf+email-to-ticket@x.test')).toEqual({
            orgSlug: 'wharf',
            handler: 'email-to-ticket',
        })
    })

    it('returns null without a plus tag', () => {
        expect(parseInboundRecipient('depot@mg.example.com')).toBeNull()
    })

    it('returns null for an empty half', () => {
        expect(parseInboundRecipient('+support@x.test')).toBeNull()
        expect(parseInboundRecipient('depot+@x.test')).toBeNull()
    })

    it('returns null for a non-slug half', () => {
        expect(parseInboundRecipient('depot+sup_port@x.test')).toBeNull()
        expect(parseInboundRecipient('-depot+support@x.test')).toBeNull()
    })

    it('returns null for a non-address', () => {
        expect(parseInboundRecipient('garbage')).toBeNull()
    })

    it('round-trips with formatInboundRecipient', () => {
        const address = formatInboundRecipient('depot', 'support', 'mg.example.com')
        expect(address).toBe('depot+support@mg.example.com')
        expect(parseInboundRecipient(address)).toEqual({ orgSlug: 'depot', handler: 'support' })
    })
})

describe('normalizeInboundBody', () => {
    it('keeps a body with no reply chain, trimmed', () => {
        expect(normalizeInboundBody('  Buy milk.\n')).toBe('Buy milk.')
    })

    it('strips a Gmail/Apple-style quoted reply', () => {
        const body = [
            'Please add this to the ticket.',
            '',
            'On Tue, Jul 22, 2026 at 3:04 PM Ada Keeper <ada@x.test> wrote:',
            '> the previous message',
            '> more quoted text',
        ].join('\n')
        expect(normalizeInboundBody(body)).toBe('Please add this to the ticket.')
    })

    it('strips an Outlook "Original Message" separator', () => {
        const body = ['New thought.', '', '-----Original Message-----', 'From: someone', 'old stuff'].join('\n')
        expect(normalizeInboundBody(body)).toBe('New thought.')
    })

    it('normalizes CRLF before stripping', () => {
        const body = 'Top reply.\r\n\r\nOn Mon wrote:\r\n> quoted'
        expect(normalizeInboundBody(body)).toBe('Top reply.')
    })

    it('keeps the original when stripping would leave nothing', () => {
        // Body that is entirely a quote below an immediate marker — do not lose everything.
        const body = 'On Mon, someone wrote:\n> only quoted content'
        expect(normalizeInboundBody(body)).toBe(body.trim())
    })
})
