import { setRequestLocale } from 'next-intl/server'
import { WelcomeScreen } from '@/components/welcome-screen'

// Route files are thin wrappers around router-agnostic screens (ADR-0006).
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params
    setRequestLocale(locale)
    return <WelcomeScreen dashboardHref={`/${locale}/dashboard`} />
}
