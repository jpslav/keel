import { findOrg, findTenant, type SeedPerson } from '@app-config/seed'
import { presets } from '@app-config/presets'
import { Badge, Group } from '@mantine/core'
import { useTranslations } from 'next-intl'
import { type ReactNode, useState } from 'react'
import { AcceptancesSection } from '../components/agreements/acceptances-section'
import { AgreementAdvisoryBanner } from '../components/agreements/agreement-advisory-banner'
import { AgreementGate } from '../components/agreements/agreement-gate'
import { AppHeader } from '../components/app-header'
import { AcceptInviteScreen, type AcceptInviteState } from '../components/auth/accept-invite-screen'
import { OrgSwitcher } from '../components/auth/org-switcher'
import { PeoplePicker } from '../components/auth/people-picker'
import { SignInScreen } from '../components/auth/sign-in-screen'
import { UserMenu } from '../components/auth/user-menu'
import { SimulatorPanel, type SimulatorExtraTab } from '../components/simulator/simulator-panel'
import type { ScrubResult } from '../components/simulator/errors-app'
import type { HookDeliveryRow, HookEndpointRow } from '../components/simulator/hooks-app'
import { DemoBanner } from '../components/demo-banner'
import { NotificationBell } from '../components/notifications/notification-bell'
import { NotificationPrefsSection } from '../components/notifications/notification-prefs-section'
import { OrgScreen, type OrgMember } from '../components/org-screen'
import { ProfileScreen } from '../components/profile-screen'
import { WebhookEndpointsCard } from '../components/webhook-endpoints-card'
import { type Locale, LOCALES } from '../core/locale'
import { unreadCount } from '../core/notifications'
import { resolveWorldStart } from '../core/presets'
import { canManageOrg, isAssignableRole, ROLES } from '../core/roles'
import { WEBHOOK_EVENT_KINDS } from '../core/webhook-events'
import { scrubEvent } from '../observability/scrub'
import { go } from './hash-route'
import { useTours } from './tour/use-tours'
import type { DemoWorld } from './contracts'

/**
 * The static demo's SHELL: the frame every app-on-keel gets for free from `file://` — the header, the
 * framework's own screens (sign-in, accept-invite, profile, team, the blocking access gate), the
 * Simulator panel wired to the whole simulated world, the tour engine that can drive all of it
 * (./tour/), and the routing between them.
 *
 * An app's composition root supplies only the parts that are its own: its landing screen, its nav, its
 * dashboard, and its Simulator tabs. Everything else here is the same code the server host renders —
 * these screens are router-agnostic precisely so this file can exist (ADR-0006).
 */

async function runServerErrorScenario(): Promise<ScrubResult> {
    // Mirrors /api/dev/error's synthetic payload — the static shell has no server, so the
    // "server" scenario just scrubs the same shape entirely in the browser.
    const base = {
        message: 'Test error (server) from Simulator',
        request: {
            headers: {
                cookie: 'session=SECRET_COOKIE_VALUE',
                authorization: 'Bearer SECRET_TOKEN',
                'x-api-key': 'SECRET_API_KEY',
                'user-agent': 'DevErrorsDemo/1.0',
            },
            cookies: { session: 'SECRET_COOKIE_VALUE' },
            query_string: 'token=SECRET_QUERY',
        },
        user: { id: 'user_123', email: 'user@example.com', ip_address: '203.0.113.7' },
    }
    return { raw: structuredClone(base), scrubbed: scrubEvent(structuredClone(base)) }
}

export interface DemoShellProps {
    world: DemoWorld
    locale: Locale
    onLocaleChange: (locale: Locale) => void
    /** The app's signed-out landing screen — the welcome route, and the fallback for anything unknown. */
    welcome: ReactNode
    /** The app's primary nav, slotted into the framework header. */
    nav: ReactNode
    /** The app's dashboard. Called ONLY once a person is signed in and no gate blocks them, so it
     *  gets a non-null person rather than having to re-check what the shell already decided. */
    dashboard: (person: SeedPerson) => ReactNode
    /** App-registered Simulator tabs (@app-config/simulator), composed by the app. */
    extraTabs: SimulatorExtraTab[]
    /** The product's display name for the header. REQUIRED, and passed straight to AppHeader — see the
     *  note there on why the framework catalog no longer carries a default for it. */
    appName: ReactNode
}

export function DemoShell({
    world,
    locale,
    onLocaleChange,
    welcome,
    nav,
    dashboard,
    extraTabs,
    appName,
}: DemoShellProps) {
    const t = useTranslations('shell')
    const { person, tenant, org, activeOrgSlug, name, route } = world
    // Scripted walkthroughs. The engine reads the app's registered tours off the seam itself, so an
    // app gets the Tours tab (and the ghost cursor) by registering a tour and nothing else. This host
    // can start a tour from `'reset'` or from any registered demo preset — both are in-memory and
    // instant, so unlike the server host the tour never has to survive a reload to start. A SAVED
    // snapshot lives in a server's `.data/`, which this host does not have: answering false records the
    // tour's start as a miss, so a tour that only works on a server fails the `file://` walkthrough gate.
    // The preset a load is replaying for. Static replays run one step per commit, so a load takes several
    // renders; while it does, the Snapshots tab disables the other world rewrites, as the server host does.
    const [busyPreset, setBusyPreset] = useState<string | null>(null)
    function loadPreset(id: string): Promise<boolean> {
        setBusyPreset(id)
        return world.applyPreset(id).finally(() => setBusyPreset(null))
    }

    const tours = useTours({
        onSnapshot: async (snapshot) => {
            const start = resolveWorldStart(snapshot, presets)
            if (start.kind === 'reset') world.resetWorld()
            if (start.kind === 'preset') return loadPreset(start.preset.id)
            return start.kind === 'reset'
        },
    })

    const signInScreen = (
        <SignInScreen
            body={
                <PeoplePicker
                    people={world.allPeople.map((p) => ({
                        id: p.id,
                        name: p.name,
                        role: p.memberships[0].role,
                        tenantName: findTenant(p.tenantSlug)?.name ?? p.tenantSlug,
                    }))}
                    onPick={world.signIn}
                />
            }
        />
    )

    const screen = (() => {
        if (route === '') return welcome

        if (route.startsWith('accept-invite/')) {
            const inviteId = route.slice('accept-invite/'.length)
            const invite = world.invites.find((i) => i.id === inviteId)
            const inviteOrg = invite ? findOrg(invite.orgSlug) : undefined
            const state: AcceptInviteState =
                invite && inviteOrg
                    ? {
                          kind: 'valid',
                          inviteId: invite.id,
                          orgName: inviteOrg.name,
                          role: invite.role,
                          email: invite.email,
                      }
                    : { kind: 'invalid' }
            return (
                <AcceptInviteScreen
                    state={state}
                    error={null}
                    onAccept={async ({ name: acceptedName }) => {
                        if (state.kind !== 'valid') return
                        world.acceptInvite(state.inviteId, acceptedName)
                    }}
                    onSignIn={() => go('')}
                />
            )
        }

        if (!person) return signInScreen
        // A blocking access gate replaces the app with its resolution flow — the same interstitial the
        // real protected layout renders instead of children.
        if (world.blockingAgreement) {
            const gated = world.blockingAgreement
            return (
                <AgreementGate
                    agreement={gated}
                    onAccept={async () => {
                        world.acceptAgreement(gated.id)
                    }}
                />
            )
        }
        switch (route) {
            case 'signin':
                return welcome
            case 'dashboard':
                return dashboard(person)
            case 'profile':
                return (
                    <ProfileScreen
                        initial={{ name, locale }}
                        email={person.email}
                        locales={[...LOCALES]}
                        onSave={async (values) => {
                            world.saveProfile({ name: values.name })
                            onLocaleChange(values.locale as Locale)
                        }}
                        extraSection={
                            <>
                                <NotificationPrefsSection
                                    prefs={world.notifPrefs[`${person.id}:${activeOrgSlug}`] ?? []}
                                    onToggle={async (kind, channel, enabled) =>
                                        world.toggleNotifPref(kind, channel, enabled)
                                    }
                                />
                                <AcceptancesSection
                                    acceptances={world.acceptances
                                        .filter((x) => x.userId === person.id)
                                        .map((x) => {
                                            const a = world.agreements.find((ag) => ag.id === x.agreementId)
                                            return {
                                                agreementId: x.agreementId,
                                                title: a?.title ?? x.agreementId,
                                                kind: a?.kind ?? '',
                                                version: x.version,
                                                acceptedAt: x.acceptedAt,
                                            }
                                        })
                                        .sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt))}
                                />
                            </>
                        }
                    />
                )
            case 'org': {
                const canManage = canManageOrg(world.roleInOrg(person, activeOrgSlug))
                const members: OrgMember[] = world.allPeople
                    .filter((p) => p.memberships.some((m) => m.orgSlug === activeOrgSlug))
                    .map((p) => ({
                        id: p.id,
                        name: p.name,
                        email: p.email,
                        role: world.roleInOrg(p, activeOrgSlug),
                        status: 'active',
                    }))
                const invitedMembers: OrgMember[] = world.invites
                    .filter((invite) => invite.orgSlug === activeOrgSlug)
                    .map((invite) => ({
                        id: invite.id,
                        name: null,
                        email: invite.email,
                        role: invite.role,
                        status: 'invited' as const,
                    }))
                return (
                    <OrgScreen
                        orgName={org.name}
                        members={[...members, ...invitedMembers]}
                        roles={ROLES.filter(isAssignableRole)}
                        canManage={canManage}
                        error={world.inviteError}
                        onInvite={world.sendInvite}
                    >
                        {canManage ? (
                            <WebhookEndpointsCard
                                endpoints={world.endpoints
                                    .filter((e) => e.tenantSlug === tenant.slug && e.orgSlug === activeOrgSlug)
                                    .map((e) => ({
                                        id: e.id,
                                        url: e.url,
                                        eventKinds: e.eventKinds,
                                        enabled: e.enabled,
                                        createdAt: '',
                                    }))}
                                eventKindOptions={[...WEBHOOK_EVENT_KINDS]}
                                newSecret={world.newWebhookSecret}
                                onDismissSecret={world.dismissNewWebhookSecret}
                                onCreate={async (input) => world.createEndpoint(input)}
                                onToggle={async (id, enabled) => world.toggleEndpoint(id, enabled)}
                                onDelete={async (id) => world.deleteEndpoint(id)}
                            />
                        ) : null}
                    </OrgScreen>
                )
            }
            default:
                return welcome
        }
    })()

    return (
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'stretch' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                {person ? (
                    <AppHeader
                        tenantName={tenant.name}
                        appName={appName}
                        bell={
                            <NotificationBell
                                items={world.notifications
                                    .filter((n) => n.recipientPersonId === person.id)
                                    .map((n) => ({
                                        id: n.id,
                                        kind: n.kind,
                                        payload: n.payload,
                                        readAt: n.readAt,
                                        createdAt: n.createdAt,
                                    }))}
                                unread={unreadCount(
                                    world.notifications
                                        .filter((n) => n.recipientPersonId === person.id)
                                        .map((n) => ({ readAt: n.readAt })),
                                )}
                                onOpen={world.markNotificationsRead}
                            />
                        }
                        nav={nav}
                        controls={
                            <>
                                <OrgSwitcher
                                    orgs={world.orgsForActivePerson.map((o) => ({ slug: o.slug, name: o.name }))}
                                    activeSlug={activeOrgSlug}
                                    onSwitch={world.setActiveOrgSlug}
                                />
                                <UserMenu
                                    user={{ name, email: person.email }}
                                    onProfile={() => go('profile')}
                                    onSignOut={world.signOut}
                                />
                            </>
                        }
                    />
                ) : null}
                {world.demoBannerOn ? <DemoBanner /> : null}
                {person && !world.blockingAgreement && world.advisoryAgreements.length > 0 ? (
                    <AgreementAdvisoryBanner agreements={world.advisoryAgreements} />
                ) : null}
                {screen}
                <Group justify="center" py="sm">
                    <Badge color="orange" variant="filled" radius="sm" data-testid="demo-badge">
                        {t('staticDemoBadge')}
                    </Badge>
                </Group>
            </div>
            <SimulatorPanel
                people={world.people}
                viewpoint={world.viewpoint}
                signedIn={!!person}
                onSelect={world.selectPerson}
                onLocaleChange={(next) => onLocaleChange(next as Locale)}
                notices={world.notices}
                mail={{
                    emails: world.mail.scoped,
                    scope: world.mail.scope,
                    onScopeChange: world.mail.setScope,
                    personEmail: world.personEmail,
                    mailSeenAt: world.mail.seenAt,
                    allCount: world.mail.allCount,
                    onOpenLink: world.mail.openLink,
                    onSeen: world.mail.markSeen,
                    onClear: world.mail.clear,
                    onCopyLink: world.mail.copyLink,
                }}
                inbound={{
                    inbound: world.inbound,
                    orgs: world.inboundOrgs,
                    people: world.allPeople.map((p) => ({ email: p.email, name: p.name })),
                    handlers: world.inboundHandlerSlugs,
                    domain: world.inboundDomain,
                    onCompose: world.composeInbound,
                }}
                messages={world.smsMessages}
                events={world.events}
                audit={world.auditEntries}
                jobs={{
                    jobs: world.jobs,
                    held: world.jobsHeld,
                    onRunPending: world.runPendingJobs,
                    schedules: world.schedules,
                    clock: {
                        offsetMs: world.clock.offsetMs,
                        worldNow: world.clock.worldNowIso,
                        onAdvance: world.clock.advance,
                        onReset: world.clock.reset,
                        onRunDue: world.clock.runDue,
                    },
                }}
                hooks={{
                    endpoints: world.endpoints.map((e): HookEndpointRow => ({
                        id: e.id,
                        url: e.url,
                        eventKinds: e.eventKinds,
                        enabled: e.enabled,
                        tenantSlug: e.tenantSlug,
                        orgSlug: e.orgSlug,
                    })),
                    deliveries: world.deliveries.map((d): HookDeliveryRow => {
                        const endpoint = world.endpoints.find((e) => e.id === d.endpointId)
                        return {
                            id: d.id,
                            endpointUrl: endpoint?.url ?? '',
                            eventKind: d.eventKind,
                            status: d.status,
                            attemptCount: d.attemptCount,
                            nextAttemptAt: new Date(d.nextAttemptAtMs).toISOString(),
                            lastError: d.lastError,
                            createdAt: new Date(d.createdAtMs).toISOString(),
                            deliveredAt: d.deliveredAtMs ? new Date(d.deliveredAtMs).toISOString() : null,
                            tenantSlug: d.tenantSlug,
                            orgSlug: d.orgSlug,
                            signature: d.signature,
                            body: d.body,
                        }
                    }),
                    failingEndpointIds: world.failingEndpointIds,
                    onToggleFail: world.toggleEndpointFailure,
                    onRunDue: world.runDueDeliveriesNow,
                }}
                extraTabs={extraTabs}
                runServerErrorScenario={runServerErrorScenario}
                snapshots={{
                    snapshots: undefined,
                    onReset: world.resetWorld,
                    flags: world.featureFlags,
                    onToggleFlag: world.setFeatureFlag,
                    agreements: world.agreements.map((a) => ({
                        id: a.id,
                        tenantSlug: a.tenantSlug,
                        kind: a.kind,
                        title: a.title,
                        version: a.version,
                        gating: a.gating,
                        currentAcceptances: world.acceptances.filter(
                            (x) => x.agreementId === a.id && x.version >= a.version,
                        ).length,
                        totalAcceptances: world.acceptances.filter((x) => x.agreementId === a.id).length,
                    })),
                    onBumpAgreement: world.bumpAgreement,
                    busyAgreement: null,
                    onLoadPreset: (id) => void loadPreset(id),
                    busyPreset,
                }}
                tours={tours.tab}
            />
            {tours.overlay}
        </div>
    )
}
