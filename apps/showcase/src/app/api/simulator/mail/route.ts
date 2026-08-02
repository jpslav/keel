import { isSimulated } from 'keel/adapters/index'
import { findInvite, listAllPeople } from 'keel/adapters/fake/auth'
import { readSimulatorState, type PersonKey } from 'keel/adapters/fake/simulator'
import { type CaughtEmail, listCaughtEmails } from 'keel/adapters/fake/email'
import type { MailItem } from 'keel/components/simulator/mail-app'
import { withPortErrors } from '../../respond'

function toMailItems(emails: CaughtEmail[]): MailItem[] {
    return emails.map(({ id, to, subject, at, html }) => ({ id, to, subject, at, html }))
}

/** Symmetric with person: — resolves whichever kind of PersonKey this Mail tab is scoped to. */
function resolvePersonEmail(personParam: string): string | null {
    if (personParam.startsWith('person:')) {
        return listAllPeople().find((p) => p.id === personParam.slice('person:'.length))?.email ?? null
    }
    if (personParam.startsWith('invited:')) {
        return findInvite(personParam.slice('invited:'.length))?.email ?? null
    }
    return null
}

/**
 * Simulator-mode gate, not a role gate (design invariant): 404s outside simulated mode, first line, no
 * role check — the Mail tab works for whoever's viewpoint is active, however low-privilege.
 * `?all=1` returns every caught email; `?person=person:<id>|invited:<id>` scopes to that
 * person's inbox (an invited-but-unregistered person's inbox is just "mail sent to their email").
 */
export async function GET(request: Request): Promise<Response> {
    if (!isSimulated) return new Response(null, { status: 404 })
    return withPortErrors(async () => {
        const url = new URL(request.url)
        const personParam = url.searchParams.get('person')
        const all = url.searchParams.get('all') === '1' || !personParam

        // allCount rides along in every response so the Mail tab can hint at other inboxes'
        // mail when the current person's own inbox is empty.
        const caught = listCaughtEmails()
        if (all) {
            return Response.json({ emails: toMailItems(caught), mailSeenAt: null, allCount: caught.length })
        }

        const email = resolvePersonEmail(personParam)
        if (!email) return Response.json({ emails: [], mailSeenAt: null, allCount: caught.length })

        const scoped = caught.filter((item) => item.to === email)
        const mailSeenAt = readSimulatorState().people[personParam as PersonKey]?.mailSeenAt ?? null
        return Response.json({ emails: toMailItems(scoped), mailSeenAt, allCount: caught.length })
    })
}
