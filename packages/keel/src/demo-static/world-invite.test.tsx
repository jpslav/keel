import { loadAppMessages } from '@app-config/messages'
import { NextIntlClientProvider } from 'next-intl'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import enFramework from '../i18n/messages/en.json'
import { mergeMessages } from '../i18n/messages'
import { useDemoWorld } from './world'

/**
 * The static demo's invite twin must refuse what the real invite route refuses. The org screen only
 * offers assignable roles, so nothing in the UI reaches the role check — which is exactly why it needs
 * its own test: a tour script or any other non-UI caller can pass `'admin'` straight in.
 */

type World = ReturnType<typeof useDemoWorld>

/** Mounts the world hook and returns a ref that always holds its latest render. */
async function renderWorld(): Promise<{ current: World }> {
    const messages = mergeMessages(enFramework, await loadAppMessages('en'))
    const result = {} as { current: World }
    function Probe() {
        result.current = useDemoWorld()
        return null
    }
    // React only flushes `act` updates in an environment that declares itself a test environment.
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const root = createRoot(document.createElement('div'))
    await act(async () => {
        root.render(
            <NextIntlClientProvider locale="en" messages={messages}>
                <Probe />
            </NextIntlClientProvider>,
        )
    })
    unmounts.push(() => root.unmount())
    return result
}

const unmounts: Array<() => void> = []
afterEach(() => {
    for (const unmount of unmounts.splice(0)) act(unmount)
})

describe('demo sendInvite — role assignability', () => {
    it('refuses an admin invite, even from an org admin, and records nothing', async () => {
        const world = await renderWorld()
        act(() => world.current.signIn('fixture-lead'))
        const before = {
            mail: world.current.mail.allCount,
            audit: world.current.auditEntries.length,
            notifications: world.current.notifications.length,
        }

        let rejection: unknown
        await act(async () => {
            await world.current
                .sendInvite({ email: 'new.hire@example.test', role: 'admin' })
                .catch((error: unknown) => (rejection = error))
        })

        expect(rejection).toBeInstanceOf(Error)
        // The org screen swallows the rejection and shows only `inviteError`, so it must be set.
        expect(world.current.inviteError).not.toBeNull()
        expect(world.current.invites).toHaveLength(0)
        // Nothing downstream of the check ran: no mail, no audit row, no admin notice.
        expect({
            mail: world.current.mail.allCount,
            audit: world.current.auditEntries.length,
            notifications: world.current.notifications.length,
        }).toEqual(before)
        // Counted by name, not total: signing in also navigates, and its page views land asynchronously.
        expect(world.current.events.map((e) => e.event)).not.toContain('org_invite_sent')
    })

    it('still sends an invite for an assignable role', async () => {
        const world = await renderWorld()
        act(() => world.current.signIn('fixture-lead'))

        await act(() => world.current.sendInvite({ email: 'new.hire@example.test', role: 'member' }))

        expect(world.current.inviteError).toBeNull()
        expect(world.current.invites.map((i) => i.role)).toEqual(['member'])
    })
})
