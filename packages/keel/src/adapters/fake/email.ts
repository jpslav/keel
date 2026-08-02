import { readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { EmailMessage, EmailPort } from '../../ports/email'
import { writeJsonAtomic } from './atomic-write'
import { dataDir } from './data-dir'

/**
 * Catches every send into .data/emails/ (ADR-0011) — the port is the catch-point, no SMTP
 * catcher. The Simulator panel's Mail tab (GET /api/simulator/mail) renders this store;
 * Playwright asserts against it.
 */

export interface CaughtEmail extends EmailMessage {
    id: string
    at: string
}

let counter = 0

export const fakeEmail: EmailPort = {
    async send(message) {
        const caught: CaughtEmail = {
            id: `${Date.now()}-${(counter++).toString().padStart(3, '0')}`,
            at: new Date().toISOString(),
            ...message,
        }
        await writeJsonAtomic(path.join(dataDir('emails'), `${caught.id}.json`), caught)
    },
}

/** Simulated-mode-only surface for the Simulator Mail tab's "clear mailbox" (NOT part of EmailPort). */
export function clearCaughtEmails(): void {
    const dir = dataDir('emails')
    for (const file of readdirSync(dir)) {
        if (file.endsWith('.json')) rmSync(path.join(dir, file), { force: true })
    }
}

/** Simulated-mode-only surface for the Simulator Mail tab (NOT part of EmailPort). */
export function listCaughtEmails(): CaughtEmail[] {
    const dir = dataDir('emails')
    return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as CaughtEmail)
        .sort((a, b) => (a.id < b.id ? 1 : -1))
}
