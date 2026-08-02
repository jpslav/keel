import { defineRouting } from 'next-intl/routing'
import { DEFAULT_LOCALE, LOCALES } from '../core/locale'

export const routing = defineRouting({
    locales: LOCALES,
    defaultLocale: DEFAULT_LOCALE,
})
