import { setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { analytics, auth, db } from 'keel/adapters/index'
import {
    agreementFacts,
    computePendingAgreements,
    gatesForAgreements,
    type PendingAgreement,
    pendingAgreementForGateId,
} from 'keel/core/agreements'
import { advisoryGates, evaluateGates, firstBlockingGate } from 'keel/core/gates'
import { listAgreementsForTenant, readAcceptancesForUser } from 'keel/db/agreements'
import { tenantIdForSlug } from 'keel/db/tenant-lookup'
import { findTenant } from '@app/seed'
import { AgreementAdvisoryBanner } from 'keel/components/agreements/agreement-advisory-banner'
import { DemoBanner } from 'keel/components/demo-banner'
import { AgreementGateGlue } from './agreement-gate-glue'
import { HeaderGlue } from './header-glue'
import { PageViewTracker } from './page-view-tracker'

/** Everything in this group requires a signed-in user; signed-out visitors go to /signin. */
export default async function ProtectedLayout({
    children,
    params,
}: {
    children: ReactNode
    params: Promise<{ locale: string }>
}) {
    const { locale } = await params
    setRequestLocale(locale)

    const user = await auth.getCurrentUser()
    if (!user) redirect(`/${locale}${auth.signInPath()}`)

    const orgs = await auth.listMyOrgs()
    const tenantName = findTenant(user.tenantSlug)?.name ?? user.tenantSlug
    const demoBanner = await analytics.isFlagEnabled('demo-banner', false)

    // ── Access gates ────────────────────────────────────────────────────────────────────
    // The ONE hook point for the gate seam: assemble the actor's facts from this RSC's data reads,
    // evaluate the registered gates, and either render a blocking interstitial INSTEAD of children or
    // pass through with an advisory banner. The worked example is agreements; a future rider (email
    // verification, MFA, onboarding, entitlements) plugs into evaluateGates here with its own facts and
    // needs no change to this layout. The interstitial renders IN PLACE (no separate resolution route to
    // allowlist); the accept POST + reload re-runs this evaluation. signin/accept-invite live OUTSIDE
    // this layout, so they are never gated — no redirect loop is possible.
    let blockingAgreement: PendingAgreement | undefined
    let advisoryAgreements: PendingAgreement[] = []
    const tenantId = await tenantIdForSlug(db, user.tenantSlug)
    if (tenantId) {
        const [current, acceptances] = await Promise.all([
            listAgreementsForTenant(db, tenantId),
            readAcceptancesForUser(db, tenantId, user.id),
        ])
        const pending = computePendingAgreements(current, acceptances)
        const pendingGates = evaluateGates(gatesForAgreements(current), agreementFacts(pending))
        const blocker = firstBlockingGate(pendingGates)
        if (blocker) blockingAgreement = pendingAgreementForGateId(blocker.id, pending)
        advisoryAgreements = advisoryGates(pendingGates).flatMap((gate) => {
            const agreement = pendingAgreementForGateId(gate.id, pending)
            return agreement ? [agreement] : []
        })
    }

    return (
        <>
            <HeaderGlue
                user={{ name: user.name, email: user.email }}
                orgs={orgs}
                activeSlug={user.orgSlug}
                tenantName={tenantName}
                locale={locale}
            />
            <PageViewTracker />
            {demoBanner && <DemoBanner />}
            {blockingAgreement ? (
                // A blocking gate replaces the app entirely with its resolution flow. The header stays so
                // sign-out / org-switch remain reachable while blocked.
                <AgreementGateGlue agreement={blockingAgreement} />
            ) : (
                <>
                    {advisoryAgreements.length > 0 && <AgreementAdvisoryBanner agreements={advisoryAgreements} />}
                    {children}
                </>
            )}
        </>
    )
}
