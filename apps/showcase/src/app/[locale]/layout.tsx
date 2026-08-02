import '@mantine/core/styles.css'
import '@/styles/index.css'

import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from '@mantine/core'
import { hasLocale, NextIntlClientProvider } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { auth, isDemoMode, isSimulated } from 'keel/adapters/index'
import { DemoBadge } from 'keel/components/demo-badge'
import { routing } from 'keel/i18n/routing'
import { DEFAULT_TENANT_SLUG, getTenantTheme } from 'keel/theme'

// Real mode mounts ClerkProvider (from the adapter layer — the only place vendor SDKs live);
// simulated mode ships zero Clerk code.
async function AuthProviders({ children }: { children: ReactNode }) {
    if (isSimulated) return children
    const { RealAuthProviders } = await import('keel/adapters/real/providers')
    return <RealAuthProviders>{children}</RealAuthProviders>
}

// The mirror image: simulated mode mounts the Simulator chrome, real mode ships zero simulator client
// code — the dynamic import means the glue (and the whole panel behind it) never enters a real
// build's client bundle. The /api/simulator/* handlers still compile into the server artifact;
// their first-line 404 gate is the containment there (see docs/decision-log.md).
async function SimulatorChrome({ locale, children }: { locale: string; children: ReactNode }) {
    if (!isSimulated) return children
    const { SimulatorGlue } = await import('./simulator-glue')
    return <SimulatorGlue locale={locale}>{children}</SimulatorGlue>
}

export const metadata = {
    title: 'Northwind Support',
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

    // The theming seam for real (ADR-0005): the ACTIVE tenant drives the theme, so switching
    // tenants restyles the whole app. Signed-out pages use the default tenant's theme.
    const user = await auth.getCurrentUser()
    const theme = getTenantTheme(user?.tenantSlug ?? DEFAULT_TENANT_SLUG)

    return (
        <html lang={locale} {...mantineHtmlProps}>
            <head>
                <ColorSchemeScript />
            </head>
            <body>
                <NextIntlClientProvider>
                    <MantineProvider theme={theme}>
                        <SimulatorChrome locale={locale}>
                            <AuthProviders>{children}</AuthProviders>
                        </SimulatorChrome>
                        {isDemoMode ? <DemoBadge /> : null}
                    </MantineProvider>
                </NextIntlClientProvider>
            </body>
        </html>
    )
}
