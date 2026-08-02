import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { cookies } from 'next/headers'
import { APP_SLUG } from '@app-config/identity'
import { writeJsonAtomicSync } from './atomic-write'
import { dataDir } from './data-dir'

/**
 * Simulator continuity (simulated-mode-only, NOT a port): who's who is a session (`${APP_SLUG}_session`);
 * whose WORLD you're looking at is the viewpoint. A signed-in session's viewpoint always follows
 * it; the cookie only matters when there's no session (e.g. an invited-but-unregistered viewer —
 * arrives in a later slice). `person:<id>` covers seeded/dynamic people; `invited:<inviteId>`
 * is reserved for that later slice.
 */
export type PersonKey = `person:${string}` | `invited:${string}`

const VIEWPOINT_COOKIE = `${APP_SLUG}_simulator_viewpoint`

interface PersonState {
    /** Locale-prefixed app path this person was last on (as the beacon reports it, e.g. "/en/org"). */
    lastPath?: string
    /** The org (product copy: "team") this person last had active — restored on Simulator continuity. */
    activeOrgSlug?: string
    mailSeenAt?: string
}

interface SimulatorState {
    people: Record<string, PersonState>
}

function stateFile(): string {
    return path.join(dataDir('simulator'), 'state.json')
}

export function readSimulatorState(): SimulatorState {
    const file = stateFile()
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SimulatorState) : { people: {} }
}

function writeSimulatorState(state: SimulatorState): void {
    writeJsonAtomicSync(stateFile(), state)
}

/** Merges a patch into one person's remembered state (last write per field wins). */
export function updatePersonState(key: PersonKey, patch: PersonState): PersonState {
    const state = readSimulatorState()
    const merged = { ...state.people[key], ...patch }
    state.people[key] = merged
    writeSimulatorState(state)
    return merged
}

/** Convenience wrapper for the page-view beacon: remembers where a signed-in person last was. */
export function recordLastPath(personId: string, path: string): void {
    updatePersonState(`person:${personId}`, { lastPath: path })
}

function isPersonKey(value: string | undefined): value is PersonKey {
    return value !== undefined && (value.startsWith('person:') || value.startsWith('invited:'))
}

/** The viewpoint cookie — only consulted when there's no session (see module doc above). */
export async function readViewpointCookie(): Promise<PersonKey | null> {
    const jar = await cookies()
    const value = jar.get(VIEWPOINT_COOKIE)?.value
    return isPersonKey(value) ? value : null
}

export async function writeViewpointCookie(key: PersonKey): Promise<void> {
    const jar = await cookies()
    jar.set(VIEWPOINT_COOKIE, key, { httpOnly: true, sameSite: 'lax', path: '/' })
}
