import { organizations, people } from '@app-config/seed'
import { presets } from '@app-config/presets'
import { auth, db } from '../adapters/index'
import { KNOWN_FLAGS, setFlag } from '../adapters/fake/analytics'
import { devSignIn } from '../adapters/fake/auth'
import { resetWorld } from '../adapters/fake/simulator-admin'
import { DEMO_INBOUND_DOMAIN, formatInboundRecipient } from '../core/inbound-email'
import { expandPreset, type PresetOperation } from '../core/presets'
import { orgIdForSlug } from '../db/org-lookup'
import { tenantIdForSlug } from '../db/tenant-lookup'
import { intakeInboundEmail } from '../inbound-email/intake'
import { NotFoundError } from '../ports/errors'
import { sendOrgInvite } from './invite'

/**
 * The SERVER host's replay of a demo preset (keel/core/presets.ts): reset the world to the seed, then
 * perform each operation through the same server code the product runs — `sendOrgInvite` for an
 * invite, the framework intake (and the app's registered handler) for an inbound email, the fake
 * analytics store for a flag — and finally sign the RESTORING browser in as the preset's viewpoint.
 * The static twin replays the same list through its in-memory world (keel/demo-static/world.ts).
 *
 * Simulated mode only: every caller is a `/api/simulator/*` route behind its `isSimulated` 404. There
 * is no session to authorize against — a preset is a simulated-world operation, like compose-inbound —
 * so the authorization question is answered at BUILD time instead: keel's seam-conformance suite holds
 * every registered preset to the rules the product enforces (`presetProblems`). An operation the
 * world cannot perform (a flag that is not known, an org the seed does not have) therefore throws here
 * rather than being skipped, because reaching one means the conformance gate was bypassed.
 *
 * The viewpoint is the restorer's alone (cookies on THIS response); other browsers watching the same
 * world keep theirs. See `DemoPreset.viewpoint`.
 */
export async function applyDemoPreset(id: string, options: { baseUrl: string }): Promise<{ signedIn: boolean }> {
    // The `extends` chain flattened (keel/core/presets.ts `expandPreset`): null is an unknown id, and also
    // a preset whose chain names an unknown base or loops — both of which the conformance gate rejects.
    const preset = expandPreset(id, presets)
    if (!preset) throw new NotFoundError(`unknown preset: ${id}`)

    await resetWorld()
    for (const operation of preset.operations) await perform(operation, options.baseUrl)

    if (preset.viewpoint === undefined) return { signedIn: false }
    await devSignIn(preset.viewpoint)
    return { signedIn: true }
}

async function perform(operation: PresetOperation, baseUrl: string): Promise<void> {
    switch (operation.op) {
        case 'invite': {
            const inviter = people.find((person) => person.id === operation.by)
            const { tenantId, orgId, orgName, tenantSlug } = await resolveOrg(operation.org)
            if (!inviter) throw new NotFoundError(`unknown person: ${operation.by}`)
            await sendOrgInvite({
                inviter,
                tenantSlug,
                tenantId,
                orgId,
                orgSlug: operation.org,
                orgName,
                email: operation.email,
                role: operation.role,
                members: await auth.listMembers(operation.org),
                baseUrl,
            })
            return
        }
        case 'inbound':
            await intakeInboundEmail(db, auth, {
                to: formatInboundRecipient(operation.org, operation.handler, DEMO_INBOUND_DOMAIN),
                from: operation.from,
                subject: operation.subject,
                bodyText: operation.body,
            })
            return
        case 'flag':
            if (!KNOWN_FLAGS.includes(operation.flag)) throw new NotFoundError(`unknown flag: ${operation.flag}`)
            setFlag(operation.flag, operation.enabled)
            return
    }
}

async function resolveOrg(
    orgSlug: string,
): Promise<{ tenantId: string; orgId: string; orgName: string; tenantSlug: string }> {
    const org = organizations.find((candidate) => candidate.slug === orgSlug)
    const tenantId = org ? await tenantIdForSlug(db, org.tenantSlug) : null
    const orgId = org && tenantId ? await orgIdForSlug(db, tenantId, orgSlug) : null
    if (!org || !tenantId || !orgId) throw new NotFoundError(`unknown org: ${orgSlug}`)
    return { tenantId, orgId, orgName: org.name, tenantSlug: org.tenantSlug }
}
