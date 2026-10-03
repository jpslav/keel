import { loadAppMessages } from '@app-config/messages'
import { NextIntlClientProvider } from 'next-intl'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { DemoWorldOptions } from './contracts'
import enFramework from '../i18n/messages/en.json'
import { mergeMessages } from '../i18n/messages'
import { useDemoWorld } from './world'

/**
 * The static demo's preset replay, against keel's own fixture seam (`busy-harbor`: an invite, an inbound
 * email named `crane`, the fixture's own `docket.flag` acting on it, a flag and an actor hold). The
 * fixture ships no static composition root, so the app-supplied twins a real app passes through
 * DemoWorldOptions are stand-ins here — which is also how each failure path is reached.
 *
 * What it pins: a replay that cannot finish SAYS so (a notice, and `false` to a waiting tour) instead of
 * leaving a reset-plus-partial world that passes for the preset; and an inbound handler twin that throws
 * is filed `failed`, as the server intake files it, rather than escaping the replay.
 */

type World = ReturnType<typeof useDemoWorld>

const handled: NonNullable<DemoWorldOptions['inboundHandlers']>[string] = () => ({
    status: 'handled',
    actorUserId: 'fixture-hand',
    subjectId: 'docket-crane',
})

async function renderWorld(options: DemoWorldOptions): Promise<{ current: World }> {
    const messages = mergeMessages(enFramework, await loadAppMessages('en'))
    const result = {} as { current: World }
    function Probe() {
        result.current = useDemoWorld(options)
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

/** Runs applyPreset to completion. The replay drains one step per commit, off a zero-delay timer, and
 *  `act` flushes effects only when its callback finishes — so each tick gets an `act` of its own. */
async function load(world: { current: World }, id: string): Promise<boolean> {
    let settled: boolean | undefined
    await act(async () => {
        void world.current.applyPreset(id).then((value) => (settled = value))
    })
    for (let tick = 0; tick < 50 && settled === undefined; tick += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    }
    return settled ?? false
}

const noticeTexts = (world: { current: World }) => world.current.notices.map((notice) => notice.text)

describe('static preset replay', () => {
    it('finishes, binds the named result, and announces the load', async () => {
        const flagged: string[] = []
        const world = await renderWorld({
            inboundHandlers: { support: handled },
            presetOperations: {
                'docket.flag': (args, ctx) => {
                    flagged.push(ctx.refs.resolve((args as { docket: string }).docket))
                    return {}
                },
            },
        })

        expect(await load(world, 'busy-harbor')).toBe(true)
        expect(flagged).toEqual(['docket-crane'])
        expect(world.current.actorHolds).toEqual({ 'fixture-tug': true })
        expect(world.current.person?.id).toBe('fixture-hand')
        expect(noticeTexts(world).some((text) => text.startsWith('Preset loaded'))).toBe(true)
    })

    it('a step the world cannot perform stops the replay and says so', async () => {
        const world = await renderWorld({
            inboundHandlers: { support: handled },
            presetOperations: { 'docket.flag': () => false },
        })

        expect(await load(world, 'busy-harbor')).toBe(false)
        expect(noticeTexts(world).some((text) => text.startsWith("Preset couldn't load"))).toBe(true)
        // The steps after the failure never ran: no hold, and nobody was sat down.
        expect(world.current.actorHolds).toEqual({})
        expect(world.current.person).toBeNull()
    })

    it('an inbound handler twin that throws is filed failed, like the server intake, and the replay reports it', async () => {
        const world = await renderWorld({
            inboundHandlers: {
                support: () => {
                    throw new Error('handler exploded')
                },
            },
            presetOperations: { 'docket.flag': () => ({}) },
        })

        // The email itself is kept, as `failed`; the step named `crane` created nothing to name, so the
        // replay stops there — the same place the server replay throws.
        expect(await load(world, 'busy-harbor')).toBe(false)
        expect(world.current.inbound.map((row) => [row.status, row.error])).toEqual([['failed', 'handler exploded']])
        expect(noticeTexts(world).some((text) => text.startsWith("Preset couldn't load"))).toBe(true)
    })
})
