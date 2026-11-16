import type { PresetOperationDefinition, PresetOperationOf } from 'keel/core/presets'
import * as v from 'valibot'

/**
 * The fixture's own preset operation kind — the DEFINITION third (pure; keel/core/presets.ts explains the
 * three parts). `by` flags a docket of `org`; `docket` is not an id but the NAME an earlier step bound with
 * `as`, which is what keel's replay test proves flows from the docket an `inbound` step opened to here.
 */
export interface DocketFlagArgs {
    by: string
    org: string
    /** A named result (`as`) of an earlier operation, never a raw id. */
    docket: string
}

export type DocketFlagOperation = PresetOperationOf<'docket.flag', DocketFlagArgs>

export const docketFlag: PresetOperationDefinition<'docket.flag', DocketFlagArgs> = {
    kind: 'docket.flag',
    args: v.strictObject({ by: v.string(), org: v.string(), docket: v.string() }),
    check(args, world) {
        const member = world.people.some(
            (person) => person.id === args.by && person.memberships.some((m) => m.orgSlug === args.org),
        )
        return member ? [] : [`"${args.by}" is not a member of "${args.org}"`]
    },
    consumes: (args) => [args.docket],
}
