import '@mantine/core/styles.css'
import '../styles/index.css'

import { MantineProvider } from '@mantine/core'
import { NextIntlClientProvider } from 'next-intl'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Locale } from 'keel/core/locale'
import { mergeMessages, type MessageTree } from 'keel/i18n/messages'
import enFramework from 'keel/i18n/messages/en.json'
import esFramework from 'keel/i18n/messages/es.json'
import { getTenantTheme } from 'keel/theme'
import enApp from '../../messages/en.json'
import esApp from '../../messages/es.json'
import { tenants } from '../seed'
import { StaticDemoApp } from './app'

// The catalogs are physically split (ADR-0012), so the static shell composes both halves exactly like
// the server's request config does — statically imported, since a file:// bundle inlines everything.
const MESSAGES: Record<Locale, MessageTree> = {
    en: mergeMessages(enFramework, enApp),
    es: mergeMessages(esFramework, esApp),
}

function Root() {
    const [locale, setLocale] = useState<Locale>('en')
    return (
        <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
            <MantineProvider theme={getTenantTheme(tenants[0]!.slug)}>
                <StaticDemoApp locale={locale} onLocaleChange={setLocale} />
            </MantineProvider>
        </NextIntlClientProvider>
    )
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Root />
    </StrictMode>,
)
