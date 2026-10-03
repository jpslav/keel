import type { AppPresetOperation } from '@app-config/presets'
import * as v from 'valibot'
import { canManageOrg, isRole, ORG_ASSIGNABLE_ROLES, ROLES, type Role } from './roles'
import type { StandardSchemaV1, StandardSchemaV1Issue } from './standard-schema'

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
 * presets on the ADR-0012 seam (`@app-config/presets`), with copy in its own catalog. A preset may
 * `extends` another (single inheritance, `expandPreset`), so "mid-demo, signed in as someone else" is a
 * line, not a copy.
 *
 * **An operation is something the product itself could have done.** Every one names its actor and its
 * team explicitly — never "whoever is signed in" — so a replay is deterministic, and `presetProblems`
 * below holds each one to the same rules the product enforces (an invite comes from someone who may
 * invite, into a role that may be granted). A preset can therefore only describe a world someone could
 * have clicked together; it is a shortcut to that world, never a back door into a different one.
 *
 * **The operation KINDS are a registry, not a closed list.** keel contributes `invite`, `inbound` and
 * `flag` (`frameworkPresetOperations` below); an app contributes its own on the same seam module
 * (`appPresetOperations`, typed by its `AppPresetOperation` union), and an app entry with keel's kind name
 * REPLACES keel's (`composePresetOperations`). Each kind is three parts that never share a module: this
 * pure DEFINITION (the argument schema, the product rules, the named results it consumes), a SERVER half
 * (keel/server-lib/preset-operations.ts, the app's `@app-config/preset-operations`), and a STATIC half
 * (keel/demo-static/world.ts, the app's `DemoWorldOptions.presetOperations`). The split is physical: the
 * server half reaches pglite and `server-only` modules, and the static demo is one browser bundle that
 * would fail to load with either inside it.
 *
 * **Named results.** An operation may say `as: 'refund'`; the id of the thing it created is then bound to
 * that name for the rest of the replay, and a later operation names it in an argument its kind
 * `consumes`. Each host keeps its own name → id map (a real uuid on the server, the twin's id in the
 * static world), so a script can say "assign THAT ticket" without either host's ids leaking into it.
 */

/**
 * One step of a preset's script, as written: `op` names the kind, `as` optionally names its result for
 * later steps, and every other field is the kind's argument object. Objects, not tuples (contrast tour
 * actions): an operation carries four or five named fields, and a positional list of strings would make
 * `from` and `org` easy to swap. An app spells its kinds with this too:
 * `export type AppPresetOperation = PresetOperationOf<'ticket.assign', TicketAssignArgs>`.
 */
export type PresetOperationOf<Kind extends string, Args> = { op: Kind; as?: string } & Args

/** `by` (a seed person who manages `org`) invites `email` into `org` as `role` — the invite, its email in
 *  the invitee's inbox, the audit row and the admins' notification, as the org screen does. `role` is any
 *  role, so a preset CAN ask for one no invite may grant; `presetProblems` is what says no. */
export interface InviteArgs {
    by: string
    org: string
    email: string
    role: Role
}

/** The world emails `<org>+<handler>@…` — the Simulator's compose-inbound, through the same intake and
 *  the same registered handler a real message would reach. With `as`, names the row the handler opened. */
export interface InboundArgs {
    org: string
    handler: string
    from: string
    subject: string
    body: string
}

/** A Snapshots-tab feature flag, framework (`demo-banner`, `jobs-held`) or app-registered. */
export interface FlagArgs {
    flag: string
    enabled: boolean
}

/** keel's own operation kinds, as preset authors write them. */
export type FrameworkPresetOperation =
    | PresetOperationOf<'invite', InviteArgs>
    | PresetOperationOf<'inbound', InboundArgs>
    | PresetOperationOf<'flag', FlagArgs>

/** Every operation a preset may contain: keel's kinds plus the app's, composed like job kinds (ADR-0012).
 *  The app half is a TYPE on its seam module, `never` when it registers none. */
export type PresetOperation = FrameworkPresetOperation | AppPresetOperation

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
    /**
     * The id of another registered preset, replayed FIRST: this preset's world is the base's world plus
     * its own operations, and its viewpoint overrides the base's when it names one. Single inheritance —
     * one base, which may itself extend another (`expandPreset` walks the chain).
     */
    extends?: string
    /** The script, in order. Absent = none, so a preset can differ from its base by viewpoint alone. */
    operations?: PresetOperation[]
}

/** The one world start every host has: the seeded world, with no script on top. */
const RESET_WORLD_START = 'reset'

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

/**
 * A preset with its `extends` chain flattened: the operations to replay (the base chain's, oldest base
 * first, then the preset's own) and the viewpoint to sit down as. The shape both replays run.
 */
export interface ExpandedPreset {
    operations: PresetOperation[]
    viewpoint?: string
}

/** Where an `extends` walk stopped: at a root (no base), at an id nothing registers, or back on a
 *  preset it had already visited (a cycle). */
type ChainEnd = { kind: 'root' } | { kind: 'unknown'; id: string } | { kind: 'cycle'; at: string }

/** The presets from `id` toward its root (the preset itself first), and why the walk stopped. A visited
 *  set bounds it, so a malformed registry can never loop it. An unregistered `id` yields an empty chain. */
function walkExtends(id: string, presets: readonly DemoPreset[]): { chain: DemoPreset[]; end: ChainEnd } {
    const chain: DemoPreset[] = []
    const visited = new Set<string>()
    let currentId: string | undefined = id
    while (currentId !== undefined) {
        if (visited.has(currentId)) return { chain, end: { kind: 'cycle', at: currentId } }
        visited.add(currentId)
        const preset = presets.find((candidate) => candidate.id === currentId)
        if (!preset) return { chain, end: { kind: 'unknown', id: currentId } }
        chain.push(preset)
        currentId = preset.extends
    }
    return { chain, end: { kind: 'root' } }
}

/** Flattens a walked chain (preset first, root last): operations root-first, viewpoint nearest the preset. */
function flattenChain(chain: readonly DemoPreset[]): ExpandedPreset {
    const operations = [...chain].reverse().flatMap((preset) => preset.operations ?? [])
    const viewpoint = chain.find((preset) => preset.viewpoint !== undefined)?.viewpoint
    return viewpoint === undefined ? { operations } : { operations, viewpoint }
}

/**
 * Flattens a preset's `extends` chain, base first. Operations are the chain's in order — the root's,
 * then each descendant's, the named preset's own last — and the viewpoint is the nearest one defined
 * walking from the preset toward its root, so a child overrides its base and otherwise inherits.
 *
 * Returns null for an id no preset has, a chain that names an unknown base, or a cycle: a preset that
 * cannot be fully expanded is never replayed half-way. Pure and total (the walk is bounded by a visited
 * set). `presetProblems` is what says WHICH of those it was; the replays only need to know.
 */
export function expandPreset(id: string, presets: readonly DemoPreset[]): ExpandedPreset | null {
    const { chain, end } = walkExtends(id, presets)
    return end.kind === 'root' ? flattenChain(chain) : null
}

/** The world a preset is checked against — derived from the seed and the registries, never hand-listed. */
export interface PresetWorld {
    people: {
        id: string
        email: string
        memberships: { orgSlug: string; role: string }[]
        /** The seed person's limited-access flag — what the ability model reads, so an app kind's check
         *  can ask the same question its route's `authorize` would. */
        restricted: boolean
    }[]
    orgSlugs: string[]
    /** Registered inbound-email handler slugs. */
    handlers: string[]
    /** Known Snapshots feature flags. */
    flags: string[]
}

/**
 * One operation KIND: what its arguments look like, what the product would refuse, and which named
 * results it reads. Pure — imported by both hosts' conformance checks and bundled into the static demo —
 * so it never holds the kind's behaviour; that is the server and static halves (see the module comment).
 *
 * `check` and `consumes` are METHOD signatures on purpose: method parameters are compared bivariantly, so
 * a definition typed for its own arguments still fits a `PresetOperationDefinition[]` registry.
 */
export interface PresetOperationDefinition<Kind extends string = string, Args = unknown> {
    kind: Kind
    /** Shape of the operation's arguments (everything except `op` and `as`). Any Standard Schema library;
     *  it must validate SYNCHRONOUSLY, because presetProblems is synchronous. */
    args: StandardSchemaV1<unknown, Args>
    /**
     * Rules a shape cannot express (the inviter manages the team, the sender is a seed person), as
     * sentences without the "preset … operation N" prefix. Pure. Runs only once the arguments pass the
     * schema. `earlier` is the script's earlier operations whose arguments passed theirs — what a rule
     * that spans steps needs (an address invited twice is a duplicate, whichever step did it first).
     */
    check?(args: Args, world: PresetWorld, earlier: readonly PresetOperation[]): string[]
    /** Named results this operation CONSUMES — the names it reads from earlier operations' `as`. */
    consumes?(args: Args): string[]
}

const EMAIL_SHAPE = /.+@.+\..+/

const inviteOperation: PresetOperationDefinition<'invite', InviteArgs> = {
    kind: 'invite',
    args: v.object({ by: v.string(), org: v.string(), email: v.string(), role: v.picklist(ROLES) }),
    check(args, world, earlier) {
        const problems: string[] = []
        if (!world.orgSlugs.includes(args.org)) problems.push(`unknown org "${args.org}"`)
        const inviter = world.people.find((person) => person.id === args.by)
        const membership = inviter?.memberships.find((m) => m.orgSlug === args.org)
        if (!inviter) problems.push(`inviter "${args.by}" is not a seed person`)
        else if (!membership || !isRole(membership.role) || !canManageOrg(membership.role)) {
            problems.push(`"${args.by}" may not invite into "${args.org}"`)
        }
        // Grantable-by-invite is a product RULE, not the shape: the schema accepts any role, so a preset
        // asking for `admin` gets the org screen's own sentence back rather than a type error.
        if (!ORG_ASSIGNABLE_ROLES.includes(args.role)) problems.push(`role "${args.role}" cannot be granted by invite`)
        const address = args.email.toLowerCase()
        if (!EMAIL_SHAPE.test(address)) problems.push(`"${args.email}" is not an email address`)
        // Inviting the same address twice is the duplicate the org screen refuses with a 409, whichever
        // step in the expanded script did the first. `earlier` passed its schemas, but an app may have
        // replaced `invite` with a differently-shaped kind, hence the typeof.
        const invitedEarlier = earlier.some(
            (operation) =>
                operation.op === 'invite' &&
                typeof operation.email === 'string' &&
                operation.email.toLowerCase() === address,
        )
        if (invitedEarlier || world.people.some((person) => person.email.toLowerCase() === address)) {
            problems.push(`"${args.email}" is already a person or an invite`)
        }
        return problems
    },
}

const inboundOperation: PresetOperationDefinition<'inbound', InboundArgs> = {
    kind: 'inbound',
    args: v.object({ org: v.string(), handler: v.string(), from: v.string(), subject: v.string(), body: v.string() }),
    check(args, world) {
        const problems: string[] = []
        if (!world.orgSlugs.includes(args.org)) problems.push(`unknown org "${args.org}"`)
        if (!world.handlers.includes(args.handler)) problems.push(`no inbound handler "${args.handler}"`)
        // A seed person, so a typo cannot quietly turn an intended ticket into an 'unmatched' filing.
        // Whether that person may author into the team stays the HANDLER's call — a refused email is a
        // legitimate thing for a preset to show.
        const sender = args.from.toLowerCase()
        if (!world.people.some((person) => person.email.toLowerCase() === sender)) {
            problems.push(`sender "${args.from}" is not a seed person`)
        }
        return problems
    },
}

const flagOperation: PresetOperationDefinition<'flag', FlagArgs> = {
    kind: 'flag',
    args: v.object({ flag: v.string(), enabled: v.boolean() }),
    check: (args, world) => (world.flags.includes(args.flag) ? [] : [`unknown flag "${args.flag}"`]),
}

/** keel's own operation kinds. An app may replace any of them by registering a definition of the same
 *  `kind` in its `appPresetOperations` (`/new-preset-operation --from <kind>` copies one to start from;
 *  `composePresetOperations([])[kind]` reaches keel's to wrap). */
const frameworkPresetOperations: readonly PresetOperationDefinition[] = [
    inviteOperation,
    inboundOperation,
    flagOperation,
]

/**
 * The operation registry a preset is checked against: keel's kinds, then the app's, keyed by kind — so an
 * app definition with keel's kind name REPLACES keel's, the same `{ ...framework, ...app }` composition
 * every other registry on the seam uses.
 */
export function composePresetOperations(
    appDefinitions: readonly PresetOperationDefinition[],
): Readonly<Record<string, PresetOperationDefinition>> {
    const composed: Record<string, PresetOperationDefinition> = {}
    for (const definition of [...frameworkPresetOperations, ...appDefinitions]) composed[definition.kind] = definition
    return composed
}

/** "email" for a top-level key, "items.0.name" for a nested one, "" for the value itself. */
function issuePath(issue: StandardSchemaV1Issue): string {
    return (issue.path ?? []).map((segment) => String(typeof segment === 'object' ? segment.key : segment)).join('.')
}

/**
 * Everything wrong with a preset list, as readable sentences (empty = valid). A preset that replays on
 * one host and silently does nothing on the other is the failure this exists to stop, so the checks
 * mirror what each operation's server path would refuse — run in every app's seam-conformance suite,
 * not at replay time, so a broken preset fails the build rather than a demo.
 *
 * `definitions` is the composed registry (`composePresetOperations(appPresetOperations)`). Each
 * operation is held, in order, to: a registered kind (`no operation kind "X"`); its kind's argument
 * schema, one sentence per issue naming the path; then its kind's `check`. Named results are checked
 * across the script: an `as` names one operation only, and every name a kind `consumes` must be bound by
 * an EARLIER operation's `as` — replay is in order, so a name bound later is as missing as one never bound.
 *
 * Operations and the viewpoint are checked on the EXPANDED preset (`expandPreset`): what actually
 * replays, so a duplicate invite split across a base and its child is caught, and a child that
 * overrides a bad viewpoint is not blamed for it. Consequences, both deliberate: an operation's number
 * (`operation 3`) counts in the expanded list, base operations first; and a base's own problem repeats
 * under every preset that extends it, because each of them replays it. A cycle is reported once on each
 * preset that is IN it (a preset merely leading into one is not), and an unknown base on the preset that
 * names it; either way the operations reachable before the chain broke are still checked.
 */
export function presetProblems(
    presets: readonly DemoPreset[],
    world: PresetWorld,
    definitions: Readonly<Record<string, PresetOperationDefinition>>,
): string[] {
    const problems: string[] = []
    const seen = new Set<string>()

    for (const preset of presets) {
        const where = `preset "${preset.id}"`
        if (!WORLD_START_NAME_PATTERN.test(preset.id)) problems.push(`${where}: id is not a valid world-start name`)
        if (preset.id === RESET_WORLD_START) problems.push(`${where}: "reset" is reserved for the seeded world`)
        if (seen.has(preset.id)) problems.push(`${where}: registered twice`)
        seen.add(preset.id)

        const { chain, end } = walkExtends(preset.id, presets)
        if (end.kind === 'unknown' && chain.length === 1) problems.push(`${where}: extends unknown preset "${end.id}"`)
        if (end.kind === 'cycle' && end.at === preset.id) problems.push(`${where}: extends chain has a cycle`)
        const { operations, viewpoint } = flattenChain(chain)

        if (viewpoint !== undefined && !world.people.some((person) => person.id === viewpoint)) {
            problems.push(`${where}: viewpoint "${viewpoint}" is not a seed person`)
        }

        // Earlier operations whose arguments passed their schema — what a kind's `check` may look back at.
        const passed: PresetOperation[] = []
        // Each `as` name → the (1-based) operation that bound it first.
        const boundAt = new Map<string, number>()
        for (const [index, operation] of operations.entries()) {
            const number = index + 1
            const at = `${where} operation ${number} (${operation.op})`
            const { op, as, ...args } = operation

            if (as !== undefined) {
                const first = boundAt.get(as)
                if (first !== undefined) problems.push(`${at}: "${as}" is already the name of operation ${first}`)
                else boundAt.set(as, number)
            }

            // An own-property lookup, so a kind named like an Object.prototype member is just unknown.
            const definition = Object.hasOwn(definitions, op) ? definitions[op] : undefined
            if (!definition) {
                problems.push(`${at}: no operation kind "${op}"`)
                continue
            }
            const result = definition.args['~standard'].validate(args)
            if (result instanceof Promise) {
                problems.push(
                    `${at}: schema for kind "${op}" validated asynchronously; preset schemas must be synchronous`,
                )
                continue
            }
            if (result.issues) {
                for (const issue of result.issues) {
                    const path = issuePath(issue)
                    problems.push(`${at}: ${path ? `${path}: ` : ''}${issue.message}`)
                }
                continue
            }

            for (const problem of definition.check?.(result.value, world, passed) ?? [])
                problems.push(`${at}: ${problem}`)
            for (const name of definition.consumes?.(result.value) ?? []) {
                const bound = boundAt.get(name)
                if (bound !== undefined && bound < number) continue
                const later = operations.findIndex((candidate, i) => i > index && candidate.as === name)
                problems.push(
                    later === -1
                        ? `${at}: no earlier operation is named "${name}"`
                        : `${at}: "${name}" is not named until operation ${later + 1}, after this one`,
                )
            }
            passed.push(operation)
        }
    }
    return problems
}
