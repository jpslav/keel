import { createTheme, type MantineThemeOverride } from '@mantine/core'
import { findTenant, tenants } from '@app-config/seed'

/**
 * Per-tenant theming seam (ADR-0005). Until real tenant resolution arrives with the tenancy
 * phase, the active tenant comes from seed records; each seeded tenant has a distinct theme so
 * the seam stays exercised.
 */
/**
 * The tenant to theme by when nobody is signed in. Read from the app's OWN seed rather than named
 * here: a framework constant spelling one app's tenant slug is a weld, and the second app had to work
 * around it. First seeded tenant wins, matching getTenantTheme's own fallback below.
 */
export const DEFAULT_TENANT_SLUG = tenants[0]?.slug ?? ''

export function getTenantTheme(tenantSlug: string): MantineThemeOverride {
    const tenant = findTenant(tenantSlug) ?? tenants[0]
    return createTheme({
        primaryColor: tenant?.themePrimaryColor ?? 'indigo',
        // Shade 8 keeps white-on-primary (filled buttons, badges) above the WCAG AA 4.5:1
        // contrast ratio; Mantine's default shade 6 fails for most hues.
        primaryShade: 8,
        // Deliberately non-default shape token so a tenant switch is visibly a THEME switch
        // (buttons/cards change roundness, not just hue) and Mantine defaults can't mask a
        // broken seam.
        defaultRadius: tenant?.themeRadius ?? 'md',
    })
}
