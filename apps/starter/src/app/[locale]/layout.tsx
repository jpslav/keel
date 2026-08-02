import '@mantine/core/styles.css'
import '@/styles/index.css'

import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from '@mantine/core'
import { hasLocale, NextIntlClientProvider } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { auth, isDemoMode } from 'keel/adapters/index'
import { DemoBadge } from 'keel/components/demo-badge'
import { routing } from 'keel/i18n/routing'
import { getTenantTheme } from 'keel/theme'
import { tenants } from '@/seed'

export const metadata = {
    title: 'Starter',
}

export function generateStaticParams() {
    return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
    children,
    params,
}: {
    children: ReactNode
    params: Promise<{ locale: string }>
}) {
    const { locale } = await params
    if (!hasLocale(routing.locales, locale)) notFound()
    setRequestLocale(locale)

    // The theming seam (ADR-0005): the ACTIVE tenant drives the theme. Signed-out pages fall back to
    // this app's FIRST seeded tenant rather than keel's DEFAULT_TENANT_SLUG, which names the
    // showcase's world — see the seam notes in docs/adopting.md.
    const user = await auth.getCurrentUser()
    const theme = getTenantTheme(user?.tenantSlug ?? tenants[0]!.slug)

    return (
        <html lang={locale} {...mantineHtmlProps}>
            <head>
                <ColorSchemeScript />
            </head>
            <body>
                <NextIntlClientProvider>
                    <MantineProvider theme={theme}>
                        {children}
                        {isDemoMode ? <DemoBadge /> : null}
                    </MantineProvider>
                </NextIntlClientProvider>
            </body>
        </html>
    )
}
