import { describe, expect, it } from 'vitest'
import { APP_NOTIFICATION_NAMESPACE, isNotificationKind, notificationCopy } from 'keel/core/notifications'
import { resolveEnabledChannels } from 'keel/core/notifications'
import { appNotificationKinds } from './notifications'

// The APP's notification kinds, and proof they compose into the framework registry + copy mapping
// (ADR-0012). TWO kinds, deliberately: the interesting question about a registry is whether a second
// member composes, and these two differ in the thing that matters — who they are addressed to.

describe('app notification kinds', () => {
    it('registers both kinds, composed into isNotificationKind', () => {
        expect(appNotificationKinds).toEqual(['escalation.received', 'ticket.assigned'])
        for (const kind of appNotificationKinds) expect(isNotificationKind(kind)).toBe(true)
    })

    it('default-on resolves every channel for an app kind', () => {
        expect(resolveEnabledChannels([], 'escalation.received')).toEqual(['in_app', 'email', 'sms'])
        expect(resolveEnabledChannels([], 'ticket.assigned')).toEqual(['in_app', 'email', 'sms'])
    })

    it('maps escalation.received to subject + raising team via the composed notificationCopy', () => {
        const copy = notificationCopy('escalation.received', {
            escalationId: 'r1',
            subject: 'Access please',
            requesterOrgName: 'Beta',
        })
        expect(copy.smsKey).toBe('smsEscalationReceived')
        expect(copy.values).toEqual({ subject: 'Access please', org: 'Beta' })
    })

    it('maps ticket.assigned to the ref, subject and who did the assigning', () => {
        const copy = notificationCopy('ticket.assigned', {
            ticketId: 't1',
            ref: 'NW-1041',
            subject: 'Scanner drops out',
            assignedByName: 'Dana Okoye',
        })
        expect(copy.titleKey).toBe('titleTicketAssigned')
        expect(copy.values).toEqual({ ref: 'NW-1041', subject: 'Scanner drops out', by: 'Dana Okoye' })
    })

    it('resolves APP copy in the APP catalog namespace, not the framework one', () => {
        // The contract that keeps app vocabulary out of keel's catalog: notificationCopy stamps the
        // namespace, so the bell/email/SMS look the app's keys up in the app's own messages.
        for (const kind of appNotificationKinds) {
            const copy = notificationCopy(kind, {
                escalationId: 'r1',
                subject: 's',
                requesterOrgName: 'o',
            } as never)
            expect(copy.namespace).toBe(APP_NOTIFICATION_NAMESPACE)
        }
        expect(notificationCopy('org.invited', { email: 'a@b.c', role: 'member', orgName: 'O' }).namespace).toBe(
            'notifications',
        )
    })
})
