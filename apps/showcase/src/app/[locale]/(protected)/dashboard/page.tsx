import { setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { analytics, auth } from 'keel/adapters/index'
import { canInActiveOrg } from 'keel/authz/authorize'
import { DashboardGlue } from './dashboard-glue'

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params
    setRequestLocale(locale)
    const user = await auth.getCurrentUser()
    if (!user) redirect(`/${locale}${auth.signInPath()}`)

    // Reflect the server-side authorization in the UI. Every registered Ticket ability has a control on
    // the card, so the gate is per-action rather than one blanket "can edit".
    const canCreateTicket = canInActiveOrg(user, 'create', 'Ticket')
    const canUpdateTicket = canInActiveOrg(user, 'update', 'Ticket')
    // Escalations: the slug anchor stands in for both sides, so create-gate reads as "am I the raising
    // desk" (non-restricted member) and respond-gate as "am I the receiving team" (org manager). The
    // server re-checks with the row's real org ids on every mutation.
    const canCreateEscalation = canInActiveOrg(user, 'create', 'Escalation')
    const canRespondEscalation = canInActiveOrg(user, 'update', 'Escalation')
    // Uploads: restricted members get a read-only attachments card (drop region hidden).
    const canCreateAttachment = canInActiveOrg(user, 'create', 'Attachment')
    // Jobs: Export and per-row Analyze both submit work (Job create is !restricted) — reflect the
    // route's gate so the UI never offers a button the POST would 403.
    const canCreateJob = canInActiveOrg(user, 'create', 'Job')

    // Who a ticket can be handed to: the active team's ACTIVE members. Resolved server-side through the
    // auth port, so the picker never offers a name from another team (or an unaccepted invitee).
    const assignees = (await auth.listMembers(user.orgSlug))
        .filter((member) => member.status === 'active')
        .map((member) => ({ id: member.id, name: member.name ?? member.email }))

    // The APP-registered Simulator flag. Read exactly like the framework's own demo-banner flag, and
    // read HERE rather than in the card so the product's behavior is decided server-side.
    const slaHighlight = await analytics.isFlagEnabled('sla-breach-banner', false)

    return (
        <DashboardGlue
            user={{ name: user.name, role: user.role, restricted: user.restricted }}
            assignees={assignees}
            canCreateTicket={canCreateTicket}
            canUpdateTicket={canUpdateTicket}
            canCreateEscalation={canCreateEscalation}
            canRespondEscalation={canRespondEscalation}
            canCreateAttachment={canCreateAttachment}
            canCreateJob={canCreateJob}
            slaHighlight={slaHighlight}
        />
    )
}
