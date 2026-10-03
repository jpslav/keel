import { organizations, people } from '@app-config/seed'
import { auth, db } from '../adapters/index'
import { KNOWN_FLAGS, setFlag } from '../adapters/fake/analytics'
import { DEMO_INBOUND_DOMAIN, formatInboundRecipient } from '../core/inbound-email'
import type { FlagArgs, FrameworkPresetOperation, InboundArgs, InviteArgs } from '../core/presets'
import { orgIdForSlug } from '../db/org-lookup'
import { tenantIdForSlug } from '../db/tenant-lookup'
import { intakeInboundEmail } from '../inbound-email/intake'
import { NotFoundError } from '../ports/errors'
import { sendOrgInvite } from './invite'

/**
 * The SERVER halves of keel's own demo-preset operation kinds (keel/core/presets.ts) — what `invite`,
 * `inbound` and `flag` DO when the server replays a preset, through the same server code the product
 * runs: `sendOrgInvite` for an invite, the framework intake (and the app's registered handler) for an
 * inbound email, the fake analytics store for a flag. keel/server-lib/demo-presets.ts composes these with
 * the app's halves (`@app-config/preset-operations`) and dispatches each step to one.
 *
 * Published because an app's own server halves are written against this module: the handler and context
 * types, `resolvePresetOrg` (a preset names a team by slug; the server works in uuids), and these halves
 * themselves, so an app that REPLACES a keel kind can wrap keel's half rather than copy it. It never
 * imports the seam's `@app-config/preset-operations`, so an app half importing it closes no cycle.
 *
 * An operation the world cannot perform (a person, team or flag the seed does not have) THROWS rather
 * than being skipped: keel's seam-conformance suite already held every registered preset to these rules
 * (`presetProblems`), so reaching one means that gate was bypassed.
 */

/** The named results bound so far in this replay (`as` → the id of what that step created). */
export interface PresetRefs {
    /** The id bound to `name`; throws when no earlier step bound it. */
    resolve(name: string): string
}

export interface ServerPresetOperationContext {
    /** The request URL the replay was asked for on — where links in emails it sends must point. */
    baseUrl: string
    refs: PresetRefs
}

/**
 * One kind's server half. Returns `{ ref }` — the id of the row it created — when it created one, so a
 * step with `as` can name it; nothing when it did not. Gets its ports from keel/adapters/index itself,
 * as server code does.
 *
 * Written as a method type on purpose: method parameters are compared bivariantly, so a half typed for
 * its own kind's arguments fits the `Record<string, ServerPresetOperationHandler>` registry.
 */
export type ServerPresetOperationHandler<Args = unknown> = {
    method(args: Args, ctx: ServerPresetOperationContext): Promise<{ ref?: string } | void>
}['method']

/** A preset names a team by slug (seed vocabulary); the server's writes need its tenant and org uuids. */
export async function resolvePresetOrg(
    orgSlug: string,
): Promise<{ tenantId: string; orgId: string; orgName: string; tenantSlug: string }> {
    const org = organizations.find((candidate) => candidate.slug === orgSlug)
    const tenantId = org ? await tenantIdForSlug(db, org.tenantSlug) : null
    const orgId = org && tenantId ? await orgIdForSlug(db, tenantId, orgSlug) : null
    if (!org || !tenantId || !orgId) throw new NotFoundError(`unknown org: ${orgSlug}`)
    return { tenantId, orgId, orgName: org.name, tenantSlug: org.tenantSlug }
}

const invite: ServerPresetOperationHandler<InviteArgs> = async (args, ctx) => {
    const inviter = people.find((person) => person.id === args.by)
    const { tenantId, orgId, orgName, tenantSlug } = await resolvePresetOrg(args.org)
    if (!inviter) throw new NotFoundError(`unknown person: ${args.by}`)
    await sendOrgInvite({
        inviter,
        tenantSlug,
        tenantId,
        orgId,
        orgSlug: args.org,
        orgName,
        email: args.email,
        role: args.role,
        members: await auth.listMembers(args.org),
        baseUrl: ctx.baseUrl,
    })
}

const inbound: ServerPresetOperationHandler<InboundArgs> = async (args) => {
    const outcome = await intakeInboundEmail(db, auth, {
        to: formatInboundRecipient(args.org, args.handler, DEMO_INBOUND_DOMAIN),
        from: args.from,
        subject: args.subject,
        bodyText: args.body,
    })
    // The row the app's handler opened, if it opened one — a declined email names nothing.
    return { ref: outcome.subjectId ?? undefined }
}

const flag: ServerPresetOperationHandler<FlagArgs> = async (args) => {
    if (!KNOWN_FLAGS.includes(args.flag)) throw new NotFoundError(`unknown flag: ${args.flag}`)
    setFlag(args.flag, args.enabled)
}

/** keel's server halves, by kind — one for every framework kind (`satisfies` makes that exhaustive). An
 *  app entry of the same kind replaces one (keel/server-lib/demo-presets.ts). */
export const frameworkPresetOperationHandlers = { invite, inbound, flag } satisfies Record<
    FrameworkPresetOperation['op'],
    ServerPresetOperationHandler
>
