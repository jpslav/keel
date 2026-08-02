import { setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { auth } from 'keel/adapters/index'
import { canInActiveOrg } from 'keel/authz/authorize'
import { DashboardGlue } from './dashboard-glue'

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params
    setRequestLocale(locale)
    const user = await auth.getCurrentUser()
    if (!user) redirect(`/${locale}${auth.signInPath()}`)

    // Reflect the server-side authorization in the UI: restricted members get a read-only card. The
    // POST route re-checks with authorize(), so this is presentation, never enforcement.
    return (
        <DashboardGlue
            user={{ name: user.name, role: user.role }}
            canCreateItem={canInActiveOrg(user, 'create', 'Item')}
        />
    )
}
