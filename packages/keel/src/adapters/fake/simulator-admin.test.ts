import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { makeTestTmpDir } from '../../../../../tests/support/tmp-dir'

// Point all fake-adapter state at a throwaway dir BEFORE importing the module (fake-adapters.test.ts /
// simulator.test.ts pattern). closeFakeDb() no-ops here since these tests never spin up pglite —
// resetWorld/saveSnapshot/restoreSnapshot only touch it if some earlier code in THIS process already did.
const tmp = makeTestTmpDir('app-simulator-admin-')
beforeAll(() => {
    process.env.APP_DATA_DIR = tmp
})
afterAll(() => {
    delete process.env.APP_DATA_DIR
})

describe('simulator-admin snapshots', () => {
    test('save/restore round-trips an email file and an auth overlay file', async () => {
        const { dataDir } = await import('./data-dir')
        const { saveSnapshot, restoreSnapshot } = await import('./simulator-admin')

        const emailsDir = dataDir('emails')
        const authDir = dataDir('auth')
        writeFileSync(path.join(emailsDir, 'email-1.json'), JSON.stringify({ to: 'a@example.test' }))
        writeFileSync(path.join(authDir, 'invites.json'), JSON.stringify([{ id: 'invite-1' }]))

        await saveSnapshot('checkpoint-a')

        // mutate the world after the snapshot was taken
        writeFileSync(path.join(emailsDir, 'email-2.json'), JSON.stringify({ to: 'b@example.test' }))
        writeFileSync(path.join(authDir, 'invites.json'), JSON.stringify([{ id: 'invite-1' }, { id: 'invite-2' }]))

        await restoreSnapshot('checkpoint-a')

        expect(existsSync(path.join(emailsDir, 'email-1.json'))).toBe(true)
        expect(existsSync(path.join(emailsDir, 'email-2.json'))).toBe(false)
        expect(JSON.parse(readFileSync(path.join(authDir, 'invites.json'), 'utf8'))).toEqual([{ id: 'invite-1' }])
    })

    test('listSnapshots reports saved snapshots with a timestamp, newest first', async () => {
        const { saveSnapshot, listSnapshots } = await import('./simulator-admin')

        await saveSnapshot('checkpoint-b')
        const snapshots = listSnapshots()

        const names = snapshots.map((s) => s.name)
        expect(names).toContain('checkpoint-a')
        expect(names).toContain('checkpoint-b')
        const checkpointB = snapshots.find((s) => s.name === 'checkpoint-b')!
        expect(checkpointB.at).toBeTruthy()
        // newest (checkpoint-b, saved after checkpoint-a above) sorts first
        expect(snapshots[0]!.name).toBe('checkpoint-b')
    })

    test('reset preserves the dev-secret but removes dynamic people and mail', async () => {
        const { dataDir } = await import('./data-dir')
        const { resetWorld } = await import('./simulator-admin')

        const authDir = dataDir('auth')
        const emailsDir = dataDir('emails')
        writeFileSync(path.join(authDir, 'dev-secret'), 'stable-secret-value', { mode: 0o600 })
        writeFileSync(path.join(authDir, 'people.json'), JSON.stringify([{ id: 'person-bob' }]))
        writeFileSync(path.join(emailsDir, 'leftover.json'), JSON.stringify({ to: 'x@example.test' }))

        await resetWorld()

        expect(readFileSync(path.join(authDir, 'dev-secret'), 'utf8')).toBe('stable-secret-value')
        expect(existsSync(path.join(authDir, 'people.json'))).toBe(false)
        expect(existsSync(path.join(emailsDir, 'leftover.json'))).toBe(false)
    })

    test('reset clears per-actor holds, and a snapshot saves and restores them', async () => {
        const { readActorHolds, setActorHold } = await import('./simulator')
        const { resetWorld, saveSnapshot, restoreSnapshot } = await import('./simulator-admin')

        setActorHold('fixture-tug', true)
        await saveSnapshot('holds-checkpoint')
        setActorHold('fixture-tug', false)
        setActorHold('fixture-barge', true)

        await restoreSnapshot('holds-checkpoint')
        expect(readActorHolds()).toEqual({ 'fixture-tug': true })

        await resetWorld()
        expect(readActorHolds()).toEqual({})
    })

    test("reset clears the fake LLM's request catch, as it clears the mailbox", async () => {
        const { dataDir } = await import('./data-dir')
        const { resetWorld } = await import('./simulator-admin')
        const { fakeLlm, listCaughtLlmRequests } = await import('./llm')

        await fakeLlm.complete({ purpose: 'fixture-echo', messages: [{ role: 'user', content: 'before reset' }] })
        expect(listCaughtLlmRequests()).toHaveLength(1)

        await resetWorld()

        expect(readdirSync(dataDir('llm-requests'))).toEqual([])
        expect(listCaughtLlmRequests()).toEqual([])
    })

    test('a snapshot carries the caught LLM requests it was taken with', async () => {
        const { saveSnapshot, restoreSnapshot } = await import('./simulator-admin')
        const { fakeLlm, listCaughtLlmRequests, clearCaughtLlmRequests } = await import('./llm')

        clearCaughtLlmRequests()
        await fakeLlm.complete({ purpose: 'fixture-echo', messages: [{ role: 'user', content: 'kept' }] })
        await saveSnapshot('with-llm-catch')
        await fakeLlm.complete({ purpose: 'fixture-echo', messages: [{ role: 'user', content: 'after' }] })

        await restoreSnapshot('with-llm-catch')

        expect(listCaughtLlmRequests().map((c) => c.messages[0]!.content)).toEqual(['kept'])
    })

    test('snapshot name validation rejects path traversal and uppercase', async () => {
        const { saveSnapshot, restoreSnapshot } = await import('./simulator-admin')

        await expect(saveSnapshot('../evil')).rejects.toThrow()
        await expect(saveSnapshot('UPPER')).rejects.toThrow()
        await expect(restoreSnapshot('../evil')).rejects.toThrow()
        await expect(restoreSnapshot('UPPER')).rejects.toThrow()
    })

    test('restoring an unknown (but validly named) snapshot throws', async () => {
        const { restoreSnapshot } = await import('./simulator-admin')

        await expect(restoreSnapshot('never-saved-snapshot')).rejects.toThrow(/unknown snapshot/)
    })
})
