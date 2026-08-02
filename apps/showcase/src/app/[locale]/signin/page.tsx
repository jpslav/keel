import type { Route } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { auth, isSimulated } from 'keel/adapters/index'
import { listAllPeople } from 'keel/adapters/fake/auth'
import { findTenant } from '@app/seed'
import { SignInScreen } from 'keel/components/auth/sign-in-screen'
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
    const target =
        returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : `/${locale}/dashboard`

    const user = await auth.getCurrentUser()
    if (user) redirect(target as Route)

    let body
    if (isSimulated) {
        body = (
            <PickerGlue
                people={listAllPeople().map((p) => ({
                    id: p.id,
                    name: p.name,
                    role: p.memberships[0].role,
                    tenantName: findTenant(p.tenantSlug)?.name ?? p.tenantSlug,
                }))}
                returnTo={target}
            />
        )
    } else {
        const [{ RealSignInForm }, t] = await Promise.all([
            import('keel/adapters/real/sign-in-form'),
            getTranslations('auth'),
        ])
        body = (
            <RealSignInForm
                returnTo={target}
                labels={{
                    email: t('emailLabel'),
                    password: t('passwordLabel'),
                    submit: t('signInButton'),
                    genericError: t('signInError'),
                    mfaNotImplemented: t('mfaNotImplemented'),
                }}
            />
        )
    }

    return <SignInScreen body={body} />
}
