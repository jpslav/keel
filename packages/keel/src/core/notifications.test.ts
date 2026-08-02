import { describe, expect, it } from 'vitest'
import {
    FRAMEWORK_NOTIFICATION_KINDS,
    NOTIFICATION_CHANNELS,
    NOTIFICATION_KINDS,
    type NotificationPrefRow,
    isChannelEnabled,
    isNotificationChannel,
    isNotificationKind,
    notificationCopy,
    resolveEnabledChannels,
    unreadCount,
} from './notifications'

// The app kind and its copy are exercised in src/app-config/notifications.test.ts — this covers the
// framework kinds + the composition.

describe('notification registry', () => {
    it('has the framework kinds and three channels', () => {
        expect(FRAMEWORK_NOTIFICATION_KINDS).toEqual(['org.invited', 'job.completed'])
        expect(NOTIFICATION_CHANNELS).toEqual(['in_app', 'email', 'sms'])
    })

    it('composes framework + app kinds into the registry', () => {
        // The framework kinds are always present; the app registers additional kinds (proven downstream).
        for (const kind of FRAMEWORK_NOTIFICATION_KINDS) expect(NOTIFICATION_KINDS).toContain(kind)
        expect(NOTIFICATION_KINDS.length).toBeGreaterThanOrEqual(FRAMEWORK_NOTIFICATION_KINDS.length)
    })

    it('guards kind and channel membership', () => {
        expect(isNotificationKind('org.invited')).toBe(true)
        expect(isNotificationKind('nope')).toBe(false)
        expect(isNotificationChannel('sms')).toBe(true)
        expect(isNotificationChannel('carrier-pigeon')).toBe(false)
    })
})

describe('resolveEnabledChannels — opt-out / default-on', () => {
    it('returns every channel when the user has no prefs (default-on)', () => {
        expect(resolveEnabledChannels([], 'org.invited')).toEqual(['in_app', 'email', 'sms'])
    })

    it('drops only the channel explicitly disabled for that kind', () => {
        const prefs: NotificationPrefRow[] = [{ kind: 'org.invited', channel: 'email', enabled: false }]
        expect(resolveEnabledChannels(prefs, 'org.invited')).toEqual(['in_app', 'sms'])
    })

    it('scopes a disable to its own kind — another kind is unaffected', () => {
        const prefs: NotificationPrefRow[] = [{ kind: 'job.completed', channel: 'sms', enabled: false }]
        expect(resolveEnabledChannels(prefs, 'job.completed')).toEqual(['in_app', 'email'])
        expect(resolveEnabledChannels(prefs, 'org.invited')).toEqual(['in_app', 'email', 'sms'])
    })

    it('an explicit enabled=true row is a no-op (the channel was on anyway)', () => {
        const prefs: NotificationPrefRow[] = [{ kind: 'org.invited', channel: 'sms', enabled: true }]
        expect(resolveEnabledChannels(prefs, 'org.invited')).toEqual(['in_app', 'email', 'sms'])
    })

    it('can disable every channel', () => {
        const prefs: NotificationPrefRow[] = NOTIFICATION_CHANNELS.map((channel) => ({
            kind: 'job.completed' as const,
            channel,
            enabled: false,
        }))
        expect(resolveEnabledChannels(prefs, 'job.completed')).toEqual([])
    })

    it('isChannelEnabled is the single-channel view of the resolver', () => {
        const prefs: NotificationPrefRow[] = [{ kind: 'org.invited', channel: 'email', enabled: false }]
        expect(isChannelEnabled(prefs, 'org.invited', 'email')).toBe(false)
        expect(isChannelEnabled(prefs, 'org.invited', 'in_app')).toBe(true)
    })
})

describe('notificationCopy (framework kinds)', () => {
    it('maps org.invited to its keys and values', () => {
        const copy = notificationCopy('org.invited', { email: 'x@y.z', role: 'member', orgName: 'Acme' })
        expect(copy.titleKey).toBe('titleOrgInvited')
        expect(copy.values).toEqual({ email: 'x@y.z', role: 'member', org: 'Acme' })
    })

    it('splits job.completed on status (completed vs failed)', () => {
        const done = notificationCopy('job.completed', { jobId: 'j1', jobKind: 'digest-email', status: 'completed' })
        const failed = notificationCopy('job.completed', { jobId: 'j1', jobKind: 'digest-email', status: 'failed' })
        expect(done.titleKey).toBe('titleJobCompleted')
        expect(failed.titleKey).toBe('titleJobFailed')
        expect(done.values).toEqual({ jobKind: 'digest-email' })
    })
})

describe('unreadCount', () => {
    it('counts only rows with a null readAt', () => {
        expect(unreadCount([{ readAt: null }, { readAt: '2026-07-23T00:00:00Z' }, { readAt: null }])).toBe(2)
        expect(unreadCount([])).toBe(0)
    })
})
