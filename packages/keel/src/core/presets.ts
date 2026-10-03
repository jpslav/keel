import { canManageOrg, isRole, ORG_ASSIGNABLE_ROLES, type Role } from './roles'

/**
 * DEMO PRESETS — named starting points for the simulated world that EVERY host can restore.
 *
 * A saved snapshot is a directory copy of `.data/` (keel/adapters/fake/simulator-admin.ts), pglite's
 * binary state included, so only a server host can restore one: a `file://` static demo has no
 * filesystem to copy it into. A preset is the other representation — **the seed plus a script of world
 * operations** — which each host replays its own way: the server through the fake adapters
 * (keel/server-lib/demo-presets.ts), the static twin through its in-memory world
 * (keel/demo-static/world.ts). The two never share bytes, only this vocabulary, which is why it is
 * pure TypeScript and lives in core.
 *
 * Preset CONTENT is app vocabulary (whose desk, which team, what the email says), so an app registers
 * presets on the ADR-0012 seam (`@app-config/simulator`'s `presets`), with copy in its own catalog.
 *
 * **An operation is something the product itself could have done.** Every one names its actor and its
 * team explicitly — never "whoever is signed in" — so a replay is deterministic, and `presetProblems`
 * below holds each one to the same rules the product enforces (an invite comes from someone who may
 * invite, into a role that may be granted). A preset can therefore only describe a world someone could
 * have clicked together; it is a shortcut to that world, never a back door into a different one.
 */

/** One step of a preset's script. Objects, not tuples (contrast tour actions): an operation carries
 *  four or five named fields, and a positional list of strings would make `from` and `org` easy to swap. */
export type PresetOperation =
    /** `by` (a seed person who manages `org`) invites `email` into `org` as `role` — the invite, its
     *  email in the invitee's inbox, the audit row and the admins' notification, as the org screen does. */
    | { op: 'invite'; by: string; org: string; email: string; role: Role }
    /** The world emails `<org>+<handler>@…` — the Simulator's compose-inbound, through the same intake
     *  and the same registered handler a real message would reach. */
    | { op: 'inbound'; org: string; handler: string; from: string; subject: string; body: string }
    /** A Snapshots-tab feature flag, framework (`demo-banner`, `jobs-held`) or app-registered. */
    | { op: 'flag'; flag: string; enabled: boolean }

/** A registered preset — what the Snapshots tab lists, and what a tour may name as its `snapshot`. */
export interface DemoPreset {
    /** Stable id: the tab's testids, and the name a tour's `snapshot` resolves. Same shape as a saved
     *  snapshot's name, and never `'reset'`. */
    id: string
    /** Fully-qualified keys into the APP's catalog (`namespace.key`), like a tour's. */
    titleKey: string
    summaryKey: string
    /**
     * The seed person the RESTORING browser is signed in as once the world is ready. Omit to leave the
     * viewpoint wherever the host's reset leaves it.
     *
     * The viewpoint is per-browser and the world is shared, so this is deliberately NOT "the viewpoint
     * captured in the preset" — it is "who the person restoring it sits down as". A second browser
     * watching the same server keeps its own viewpoint across a restore.
     */
    viewpoint?: string
    operations: PresetOperation[]
}

/** The one world start every host has: the seeded world, with no script on top. */
export const RESET_WORLD_START = 'reset'

/** The name pattern a saved snapshot uses (simulator-admin.ts) — presets share the namespace a tour's
 *  `snapshot` field resolves in, so they share its shape too. */
export const WORLD_START_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/

/** What a world-start name (a tour's `snapshot`, a Snapshots-tab click) means on a host. */
export type WorldStart =
    | { kind: 'reset' }
    | { kind: 'preset'; preset: DemoPreset }
    /** A saved directory snapshot — something only a server host can restore. */
    | { kind: 'snapshot'; name: string }

/**
 * Resolves a world-start name in a fixed order: `'reset'`, then a registered preset, then a saved
 * snapshot. Saving a snapshot under a reserved name is refused (`isReservedWorldStartName`), so the
 * order never has to break a tie.
 */
export function resolveWorldStart(name: string, presets: readonly DemoPreset[]): WorldStart {
    if (name === RESET_WORLD_START) return { kind: 'reset' }
    const preset = presets.find((candidate) => candidate.id === name)
    if (preset) return { kind: 'preset', preset }
    return { kind: 'snapshot', name }
}

/** True when a saved snapshot may not take this name: it would shadow `'reset'` or a registered preset. */
export function isReservedWorldStartName(name: string, presets: readonly DemoPreset[]): boolean {
    return name === RESET_WORLD_START || presets.some((preset) => preset.id === name)
}

/** The world a preset is checked against — derived from the seed and the registries, never hand-listed. */
export interface PresetWorld {
    people: { id: string; email: string; memberships: { orgSlug: string; role: string }[] }[]
    orgSlugs: string[]
    /** Registered inbound-email handler slugs. */
    handlers: string[]
    /** Known Snapshots feature flags. */
    flags: string[]
}

const EMAIL_SHAPE = /.+@.+\..+/

/**
 * Everything wrong with a preset list, as readable sentences (empty = valid). A preset that replays on
 * one host and silently does nothing on the other is the failure this exists to stop, so the checks
 * mirror what each operation's server path would refuse — run in every app's seam-conformance suite,
 * not at replay time, so a broken preset fails the build rather than a demo.
 */
export function presetProblems(presets: readonly DemoPreset[], world: PresetWorld): string[] {
    const problems: string[] = []
    const seen = new Set<string>()
    const emails = new Set(world.people.map((person) => person.email.toLowerCase()))

    for (const preset of presets) {
        const where = `preset "${preset.id}"`
        if (!WORLD_START_NAME_PATTERN.test(preset.id)) problems.push(`${where}: id is not a valid world-start name`)
        if (preset.id === RESET_WORLD_START) problems.push(`${where}: "reset" is reserved for the seeded world`)
        if (seen.has(preset.id)) problems.push(`${where}: registered twice`)
        seen.add(preset.id)
        if (preset.viewpoint !== undefined && !world.people.some((person) => person.id === preset.viewpoint)) {
            problems.push(`${where}: viewpoint "${preset.viewpoint}" is not a seed person`)
        }

        // Invites accumulate within one preset: inviting the same address twice is the duplicate the
        // org screen refuses with a 409.
        const invited = new Set<string>()
        for (const [index, operation] of preset.operations.entries()) {
            const at = `${where} operation ${index + 1} (${operation.op})`
            if (operation.op !== 'flag' && !world.orgSlugs.includes(operation.org)) {
                problems.push(`${at}: unknown org "${operation.org}"`)
            }
            if (operation.op === 'invite') {
                const inviter = world.people.find((person) => person.id === operation.by)
                const membership = inviter?.memberships.find((m) => m.orgSlug === operation.org)
                if (!inviter) problems.push(`${at}: inviter "${operation.by}" is not a seed person`)
                else if (!membership || !isRole(membership.role) || !canManageOrg(membership.role)) {
                    problems.push(`${at}: "${operation.by}" may not invite into "${operation.org}"`)
                }
                if (!ORG_ASSIGNABLE_ROLES.includes(operation.role)) {
                    problems.push(`${at}: role "${operation.role}" cannot be granted by invite`)
                }
                const address = operation.email.toLowerCase()
                if (!EMAIL_SHAPE.test(address)) problems.push(`${at}: "${operation.email}" is not an email address`)
                if (emails.has(address) || invited.has(address)) {
                    problems.push(`${at}: "${operation.email}" is already a person or an invite`)
                }
                invited.add(address)
            }
            if (operation.op === 'inbound' && !world.handlers.includes(operation.handler)) {
                problems.push(`${at}: no inbound handler "${operation.handler}"`)
            }
            if (operation.op === 'flag' && !world.flags.includes(operation.flag)) {
                problems.push(`${at}: unknown flag "${operation.flag}"`)
            }
        }
    }
    return problems
}
