import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { SmsMessage } from '../../server-lib/sms'
import { writeJsonAtomic } from './atomic-write'
import { dataDir } from './data-dir'

/**
 * The FAKE SMS channel — the second consumer that keeps the notification channel abstraction
 * honest without shipping any vendor code. It CATCHES every "send" into `.data/sms/` exactly as
 * fake/email.ts catches mail and fake/webhooks.ts catches egress: the port/seam IS the catch-point,
 * there is no SMS gateway. The Simulator Messages tab (GET /api/simulator/messages) renders this store;
 * Playwright asserts against it. `.data/sms/` is a Snapshots LIVE_DIR (simulator-admin.ts) so a reset
 * clears it and save/restore snapshot it with the rest of the world.
 *
 * A REAL instance replaces this with a Twilio adapter — see docs/recipes/sms-twilio.md; the seam in
 * packages/keel/src/server-lib/sms.ts is the swap point, and in real mode today the channel is a no-op stub there.
 */

export interface CaughtSms extends SmsMessage {
    id: string
    at: string
}

let counter = 0

export async function fakeSendSms(message: SmsMessage): Promise<void> {
    const caught: CaughtSms = {
        id: `${Date.now()}-${(counter++).toString().padStart(3, '0')}`,
        at: new Date().toISOString(),
        ...message,
    }
    await writeJsonAtomic(path.join(dataDir('sms'), `${caught.id}.json`), caught)
}

/** Simulated-mode-only surface for the Simulator Messages tab (NOT part of the SMS seam). The tab is
 *  read-only — a Snapshots RESET wipes `.data/sms/`, so there's no separate clear control here. */
export function listCaughtSms(): CaughtSms[] {
    const dir = dataDir('sms')
    return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as CaughtSms)
        .sort((a, b) => (a.id < b.id ? 1 : -1))
}
