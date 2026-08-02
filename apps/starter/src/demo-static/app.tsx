import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { defineAbilitiesFor } from 'keel/core/abilities'
import type { Locale } from 'keel/core/locale'
import { DemoShell } from 'keel/demo-static/shell'
import { useDemoWorld } from 'keel/demo-static/world'
import type { SeedPerson } from '@/seed'
import { staffOrgSlug } from '@/app-config/abilities'
import { DashboardScreen } from '@/components/dashboard-screen'
import { ItemsCard, type Item } from '@/components/items-card'
import { WelcomeScreen } from '@/components/welcome-screen'

/**
 * The static demo's COMPOSITION ROOT — the `file://` twin of the server-side glue, and the same job:
 * take the framework's simulated world (keel/demo-static/world), add THIS app's own rows, hand the
 * shell its screens, and get out of the way (ADR-0006, ADR-0012).
 *
 * This is what the twin costs an app that owns ONE table: a row type, a piece of state, an ability
 * check and a card. Everything else on screen — routing, sign-in, the people, mail, jobs, schedules,
 * webhooks, notifications, agreements, audit and the whole Simulator panel — is the package's.
 */

/** In-memory twin of an `items` row — tenant + org scoped, so the static dashboard shows only the
 *  active team's items and gates create by the same pure ability model the real server runs. */
interface DemoItem extends Item {
    tenantSlug: string
    orgSlug: string
}

export function StaticDemoApp({ locale, onLocaleChange }: { locale: Locale; onLocaleChange: (l: Locale) => void }) {
    const t = useTranslations('welcome')
    const [items, setItems] = useState<DemoItem[]>([])
    const world = useDemoWorld({ onReset: () => setItems([]) })

    function renderDashboard(person: SeedPerson) {
        const { tenant, activeOrgSlug } = world
        // Same pure ability the real server runs — a restricted person gets a read-only card here too.
        const ability = defineAbilitiesFor({
            userId: person.id,
            role: world.roleInOrg(person, activeOrgSlug),
            restricted: person.restricted,
            activeOrgId: activeOrgSlug,
            // Acting AS the operator org activates manage-all, exactly like abilityActorFromUser does
            // server-side — genuine parity, no degrade.
            manageAll: activeOrgSlug === staffOrgSlug,
        })

        return (
            <DashboardScreen user={{ name: world.name, role: world.roleInOrg(person, activeOrgSlug) }}>
                <ItemsCard
                    items={items.filter((i) => i.tenantSlug === tenant.slug && i.orgSlug === activeOrgSlug)}
                    canCreate={ability.can('create', { type: 'Item', orgId: activeOrgSlug })}
                    onAdd={async (title) => {
                        const id = crypto.randomUUID()
                        setItems((prev) => [{ id, title, tenantSlug: tenant.slug, orgSlug: activeOrgSlug }, ...prev])
                    }}
                />
            </DashboardScreen>
        )
    }

    return (
        <DemoShell
            world={world}
            locale={locale}
            onLocaleChange={onLocaleChange}
            appName={t('appName')}
            welcome={<WelcomeScreen dashboardHref="#/dashboard" />}
            nav={null}
            dashboard={renderDashboard}
            extraTabs={[]}
        />
    )
}
