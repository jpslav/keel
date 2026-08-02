import type { Route } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { auth, isSimulated } from 'keel/adapters/index'
import { listAllPeople } from 'keel/adapters/fake/auth'
import { SignInScreen } from 'keel/components/auth/sign-in-screen'
import { findTenant } from '@/seed'
import { PickerGlue } from './picker-glue'

export default async function SignInPage({
    params,
    searchParams,
}: {
    params: Promise<{ locale: string }>
    searchParams: Promise<{ returnTo?: string }>
}) {
    const { locale } = await params
    setRequestLocale(locale)
    const { returnTo } = await searchParams
    // Only same-origin, path-shaped targets; anything else falls back to the dashboard.
    const safe = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
    const target = (safe ? returnTo : `/${locale}/dashboard`) as Route

    if (await auth.getCurrentUser()) redirect(target)

    if (!isSimulated) {
        const [{ RealSignInForm }, t] = await Promise.all([
            import('keel/adapters/real/sign-in-form'),
            getTranslations('auth'),
        ])
        const labels = {
            email: t('emailLabel'),
            password: t('passwordLabel'),
            submit: t('signInButton'),
            genericError: t('signInError'),
            mfaNotImplemented: t('mfaNotImplemented'),
        }
        return <SignInScreen body={<RealSignInForm returnTo={target} labels={labels} />} />
    }

    const people = listAllPeople().map((p) => ({
        id: p.id,
        name: p.name,
        role: p.memberships[0].role,
        tenantName: findTenant(p.tenantSlug)?.name ?? p.tenantSlug,
    }))
    return <SignInScreen body={<PickerGlue people={people} returnTo={target} />} />
}
