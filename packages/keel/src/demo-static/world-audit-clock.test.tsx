import { loadAppMessages } from '@app-config/messages'
import { NextIntlClientProvider } from 'next-intl'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enFramework from '../i18n/messages/en.json'
import { mergeMessages } from '../i18n/messages'
import { useDemoWorld } from './world'

/**
 * The static demo dates its audit events with ITS world clock, as the server does through `DbPort.now`: real time
 * plus the offset the demo advanced. Two properties are easy to lose and both were: the time must MOVE (an early
 * version used the mount-time anchor, so every event between two clock jumps carried one frozen instant), and it
 * must follow a jump. Fake timers pin "now", so the assertions are exact.
 */

type World = ReturnType<typeof useDemoWorld>

const DAY_MS = 86_400_000

async function renderWorld(): Promise<{ current: World }> {
    const messages = mergeMessages(enFramework, await loadAppMessages('en'))
    const result = {} as { current: World }
    function Probe() {
        result.current = useDemoWorld()
        return null
    }
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
    vi.useRealTimers()
})

async function invite(world: { current: World }, email: string): Promise<void> {
    await act(() => world.current.sendInvite({ email, role: 'member' }))
}

/** The `at` of the audit row an invite to `email` just wrote (newest first). */
const latestAuditAt = (world: { current: World }) => Date.parse(world.current.auditEntries[0]!.at)

describe('the demo twin dates audit events with its world clock', () => {
    it('moves with real time: two events a few seconds apart carry different times', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const start = new Date('2026-11-17T12:00:00.000Z').getTime()
        vi.setSystemTime(start)
        const world = await renderWorld()
        act(() => world.current.signIn('fixture-lead'))

        await invite(world, 'first@example.test')
        const first = latestAuditAt(world)
        vi.setSystemTime(start + 5_000)
        await invite(world, 'second@example.test')
        const second = latestAuditAt(world)

        expect(first).toBe(start)
        expect(second).toBe(start + 5_000)
    })

    it('follows a jump of the demo clock: an event after advancing a week is dated a week on', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const start = new Date('2026-11-17T12:00:00.000Z').getTime()
        vi.setSystemTime(start)
        const world = await renderWorld()
        act(() => world.current.signIn('fixture-lead'))

        act(() => world.current.clock.advance(7 * DAY_MS))
        await invite(world, 'after-the-jump@example.test')

        expect(latestAuditAt(world)).toBe(start + 7 * DAY_MS)
    })
})
