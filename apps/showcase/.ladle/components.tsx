import '@mantine/core/styles.css'
import '../src/styles/index.css'

import type { GlobalProvider } from '@ladle/react'
import { MantineProvider } from '@mantine/core'
import { NextIntlClientProvider } from 'next-intl'
import { mergeMessages } from 'keel/i18n/messages'
import enFramework from 'keel/i18n/messages/en.json'
import { DEFAULT_TENANT_SLUG, getTenantTheme } from 'keel/theme'
import enApp from '../messages/en.json'

// Stories come from both halves of the repo, so the workshop gets the MERGED catalog (framework +
// app) — the same composition the server and the static demo do (ADR-0012).
const messages = mergeMessages(enFramework, enApp)

export const Provider: GlobalProvider = ({ children }) => (
    <NextIntlClientProvider locale="en" messages={messages}>
        <MantineProvider theme={getTenantTheme(DEFAULT_TENANT_SLUG)}>{children}</MantineProvider>
    </NextIntlClientProvider>
)
