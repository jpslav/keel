import { setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { auth } from 'keel/adapters/index'
import { findTenant } from '@/seed'
import { HeaderGlue } from './header-glue'

/**
 * Everything in this group requires a signed-in user; signed-out visitors go to /signin.
 *
 * Deliberately shorter than the showcase's: no access-gate evaluation, because this app seeds no
 * agreements and registers no gates. The capability is not removed — it is simply unused, and an
 * unused capability needs no scaffolding (ADR-0012).
 */
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

    return (
        <>
            <HeaderGlue
                user={{ name: user.name, email: user.email }}
                orgs={orgs}
                activeSlug={user.orgSlug}
                tenantName={tenantName}
                locale={locale}
            />
            {children}
        </>
    )
}
