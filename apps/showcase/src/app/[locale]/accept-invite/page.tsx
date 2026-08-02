import { findOrg } from '@app/seed'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { isSimulated } from 'keel/adapters/index'
import { findInvite } from 'keel/adapters/fake/auth'
import { AcceptInviteShell, type AcceptInviteState } from 'keel/components/auth/accept-invite-screen'
import { AcceptInviteGlue } from './accept-glue'

// Public route (outside the (protected) group), mirroring signin/page.tsx's structure: simulated mode
// resolves the invite server-side and renders client glue; real mode dynamic-imports the
// Clerk-ticket cutover component. Unlike signin, this page ships in BOTH modes (design invariant:
// accept-invite is product, not a dev surface) — no isSimulated 404 gate here, only in the API.
export default async function AcceptInvitePage({
    params,
    searchParams,
}: {
    params: Promise<{ locale: string }>
    searchParams: Promise<{ invite?: string; __clerk_ticket?: string }>
}) {
    const { locale } = await params
    setRequestLocale(locale)
    const search = await searchParams

    if (!isSimulated) {
        const [{ RealAcceptInviteForm }, t] = await Promise.all([
            import('keel/adapters/real/accept-invite-form'),
            getTranslations('acceptInvite'),
        ])
        return (
            <AcceptInviteShell
                title={t('ticketTitle')}
                body={
                    <RealAcceptInviteForm
                        ticket={search.__clerk_ticket ?? null}
                        redirectTo={`/${locale}/dashboard`}
                        labels={{
                            missingTicket: t('ticketMissing'),
                            accepting: t('ticketAccepting'),
                            oneMoment: t('ticketOneMoment'),
                            genericError: t('ticketError'),
                        }}
                    />
                }
            />
        )
    }

    const invite = search.invite ? findInvite(search.invite) : undefined
    const org = invite ? findOrg(invite.orgSlug) : undefined
    const state: AcceptInviteState =
        invite && org
            ? { kind: 'valid', inviteId: invite.id, orgName: org.name, role: invite.role, email: invite.email }
            : { kind: 'invalid' }

    return <AcceptInviteGlue locale={locale} state={state} />
}
