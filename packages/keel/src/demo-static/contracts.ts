import type { SeedOrg, SeedPerson, SeedTenant, PersonRole } from '@app-config/seed'
import type { Dispatch, SetStateAction } from 'react'
import type { ActorLog, BuilderDriver, ServiceDriver } from '../components/simulator/actor-runtime'
import type { SimulatorNotice } from '../components/simulator/simulator-panel'
import type { Person } from '../components/simulator/people-app'
import type { AnalyticsEvent, AuditEntry } from '../components/simulator/events-app'
import type { InboundComposeInput, InboundEmailRow } from '../components/simulator/inbound-app'
import type { ScheduleRowLike } from '../components/simulator/jobs-app'
import type { MailItem } from '../components/simulator/mail-app'
import type { SmsMessageRow } from '../components/simulator/messages-app'
import type { FeatureFlag } from '../components/simulator/snapshots-app'
import type { PendingAgreement } from '../core/agreements'
import type {
    NotificationChannel,
    NotificationKind,
    NotificationPayload,
    NotificationPrefRow,
} from '../core/notifications'
import type { WebhookEventKind, WebhookEventPayload } from '../core/webhook-events'
import type { DemoServiceScope } from './actor-drivers'
import type {
    DemoAcceptance,
    DemoAgreement,
    DemoDelivery,
    DemoEndpoint,
    DemoInvite,
    DemoJob,
    DemoNotification,
} from './rows'

/**
 * The CONTRACT between the framework's simulated world (./world.ts) and an app's static-demo
 * composition root — what the root must supply, and what it gets back. Kept as its own module for the
 * same reason ../seed/contracts.ts is: it is the surface a second app codes against, and it should be
 * readable end to end without scrolling through an implementation.
 */

// ── What the composition root supplies ────────────────────────────────────────────────────────────

/**
 * What a demo inbound handler is given — the in-memory twin of InboundContext
 * (../inbound-email/handlers.ts). `members` stands in for the handler's `auth.listMembers(orgSlug)`
 * call, and `recordAudit` for its `recordAuditEvent(db, …)`: intake owns org resolution here (the twin
 * addresses the world by slug), so a handler that writes its own domain audit event hands it back
 * rather than resolving a tenant itself.
 */
export interface DemoInboundContext {
    org: SeedOrg
    members: SeedPerson[]
    /** Normalized sender addr-spec (lowercased, display name stripped). */
    fromEmail: string
    subject: string
    /** Normalized plain-text body (quoted reply chain stripped — ../core/inbound-email.ts). */
    bodyText: string
    recordAudit: (entry: { action: string; subjectType: string; subjectId: string; actorUserId: string }) => void
}

/** Same two outcomes the real handler contract has: it produced its effect, or it declined with a
 *  reason. (A throw is the real contract's third outcome; the twin has no poison-message channel.) Like
 *  the real contract, 'handled' may name the row it created (`subjectId`), which is what a demo preset's
 *  `inbound` step binds to its `as` name. */
export type DemoInboundResult =
    { status: 'handled'; actorUserId: string; subjectId?: string } | { status: 'unmatched'; reason: string }

export type DemoInboundHandler = (ctx: DemoInboundContext) => DemoInboundResult

/**
 * What a STATIC half of a demo-preset operation kind is given (keel/core/presets.ts) — the twin of the
 * server half's context, plus the handful of world operations an app twin needs to act as an EXPLICIT
 * actor in an EXPLICIT team. Never "whoever is signed in": a preset replays before anyone is, and the
 * world's ambient helpers (`logAudit`, the signed-in person) would attribute the step to the wrong desk.
 */
export interface StaticPresetOperationContext {
    /** Named results bound so far in this replay. `resolve` throws for a name no earlier step bound, and
     *  the replay then settles false — the twin of the server half's throw. */
    refs: { resolve(name: string): string }
    /** A person by id: the seed plus everyone who has accepted an invite in this world. */
    findPerson: (personId: string) => SeedPerson | undefined
    /** Append an audit row attributed to `entry.actorUserId`, in the named tenant and team — the twin of
     *  `recordAuditEvent` with the ids the server half resolved. */
    recordAudit: (
        entry: { action: string; subjectType: string; subjectId: string | null; actorUserId: string },
        scope: { tenantSlug: string; orgSlug: string },
    ) => void
    /** The world's single-recipient notification twin (`DemoWorld.notifyMemberOf`). */
    notifyMemberOf: DemoWorld['notifyMemberOf']
    /** keel's own static halves, so an app entry that REPLACES a framework kind can wrap keel's twin
     *  rather than re-implement world state the context does not expose. */
    framework: Readonly<Record<string, StaticPresetOperationHandler>>
}

/**
 * One operation kind's STATIC half: perform the step in the in-memory world, answering `{ ref }` with the
 * id of what it created (when it created something, so `as` can name it) or `false` when this world
 * cannot perform it — which abandons the replay and settles it false, like the server half's throw.
 * Synchronous: the replay runs one step per commit (keel/demo-static/world.ts `applyPreset`).
 *
 * Written as a method type on purpose: method parameters are compared bivariantly, so a half typed for
 * its own kind's arguments fits the `Record<string, StaticPresetOperationHandler>` registry.
 */
export type StaticPresetOperationHandler<Args = unknown> = {
    method(args: Args, ctx: StaticPresetOperationContext): { ref?: string } | false
}['method']

export interface DemoWorldOptions {
    /**
     * In-memory twins of the app's inbound-email handlers (@app-config/inbound-email). They cannot be
     * the real ones — those take a db handle and are async — so the composition root supplies twins
     * keyed by the same handler slugs, and the intake twin looks them up the same way.
     */
    inboundHandlers?: Record<string, DemoInboundHandler>
    /**
     * Twin of digestEmailHandler's app-row query (../jobs/digest-email.ts). The framework's scheduled
     * digest summarizes APP rows, which the world cannot see; the composition root supplies their
     * bodies newest-first, and the counting/snipping stays framework-side, like the real handler.
     */
    digestBodies?: (scope: { tenantSlug: string; orgSlug: string }) => string[]
    /**
     * Messages the world has ALREADY sent when it starts — the twin of an app seeding its opening
     * state through the email port (keel/db/seed.ts). Without it, a `file://` demo opens with an empty
     * outbox while `pnpm dev` opens with a badge on the Simulator pill, which is a parity gap rather
     * than a physics one. Restored on reset, like every other seeded thing.
     */
    initialMail?: { to: string; subject: string; html: string }[]
    /** Clears the composition root's OWN rows when the world resets — the twin of wiping `.data/`. */
    onReset?: () => void
    /**
     * Static halves of the app's demo-preset operation kinds, keyed by kind — the twins of its server
     * halves (`@app-config/preset-operations`), supplied here for the same reason `inboundHandlers` are:
     * they act on the composition root's own rows, and a server half could never be bundled. Composed over
     * keel's own halves, so an entry with a framework kind's name replaces keel's. A registered kind with
     * no static half makes any preset using it settle false in this world.
     */
    presetOperations?: Record<string, StaticPresetOperationHandler>
}

// ── What the composition root gets back ───────────────────────────────────────────────────────────

/**
 * Everything ./shell.tsx renders and every operation an app's composition root can drive. Written out
 * rather than inferred from the hook: this IS the framework's public seam for a second app's static
 * demo, so it is worth reading as a list of what the simulated world can do.
 */
export interface DemoWorld {
    // Who is looking, and at what.
    route: string
    person: SeedPerson | null
    activeOrgSlug: string
    setActiveOrgSlug: Dispatch<SetStateAction<string>>
    /** The ambient site — follows whoever is signed in, never user-switchable (orgs never span tenants). */
    tenant: SeedTenant
    org: SeedOrg
    /** The signed-in display name, honouring an unsaved profile edit. */
    name: string
    /** Seed people plus everyone who has accepted an invite in this session. */
    allPeople: SeedPerson[]
    orgsForActivePerson: SeedOrg[]
    roleInOrg: (person: SeedPerson, orgSlug: string) => PersonRole
    signIn: (personId: string) => void
    signOut: () => void
    saveProfile: (values: { name: string }) => void

    // Access gates (the twin of the protected layout's gate evaluation).
    blockingAgreement: PendingAgreement | undefined
    advisoryAgreements: PendingAgreement[]
    acceptAgreement: (agreementId: string) => void

    // Recording surfaces.
    logEvent: (event: string, properties?: Record<string, unknown>) => void
    logAudit: (action: string, subjectType: string, subjectId: string | null) => void
    pushNotice: (text: string) => void

    // Emissions an app's own mutations trigger, exactly as the real routes do after they commit.
    enqueueWebhook: (kind: WebhookEventKind, payload: WebhookEventPayload) => void
    notifyAdminsOf: (
        orgSlug: string,
        kind: NotificationKind,
        payload: NotificationPayload,
        excludePersonId?: string,
    ) => void
    /** The single-recipient twin: a kind addressed to a person, not to a team's managers. */
    notifyMemberOf: (
        orgSlug: string,
        recipientPersonId: string,
        kind: NotificationKind,
        payload: NotificationPayload,
        excludePersonId?: string,
    ) => void

    // Jobs.
    jobs: DemoJob[]
    /** Cross-tenant queued/running/completed counts — the Actors tab's world strip. */
    jobCounts: { queued: number; running: number; completed: number }
    /** Twin of POST /api/jobs + the fake executor: honours the 'jobs-held' knob and, on an instant
     *  completion, emits the same terminal webhook + notification the server emits. */
    startJob: (kind: string) => void
    /** Stable factories for the two actor-driver shapes; scope comes from the app's actor registry. */
    serviceDriver: (scope: DemoServiceScope, log: ActorLog) => ServiceDriver
    builderDriver: (serviceManagedOrgSlugs: readonly string[], log: ActorLog) => BuilderDriver

    // Invites + membership.
    invites: DemoInvite[]
    inviteError: string | null
    sendInvite: (input: { email: string; role: string }) => Promise<void>
    acceptInvite: (inviteId: string, acceptedName: string) => void

    // Notifications.
    notifications: DemoNotification[]
    notifPrefs: Record<string, NotificationPrefRow[]>
    markNotificationsRead: () => void
    toggleNotifPref: (kind: NotificationKind, channel: NotificationChannel, enabled: boolean) => void

    // Webhook endpoints (the org screen's card).
    endpoints: DemoEndpoint[]
    newWebhookSecret: string | null
    dismissNewWebhookSecret: () => void
    createEndpoint: (input: { url: string; eventKinds: string[] }) => void
    toggleEndpoint: (id: string, enabled: boolean) => void
    deleteEndpoint: (id: string) => void

    // Agreements (the profile screen's acceptances list + the Snapshots bump control).
    agreements: DemoAgreement[]
    acceptances: DemoAcceptance[]
    bumpAgreement: (id: string) => void

    // Everything the Simulator panel renders.
    notices: SimulatorNotice[]
    people: Person[]
    viewpoint: string | null
    personEmail: string | null
    selectPerson: (key: string) => void
    mail: {
        scoped: MailItem[]
        scope: 'person' | 'all'
        setScope: Dispatch<SetStateAction<'person' | 'all'>>
        allCount: number
        seenAt: string | null
        markSeen: () => void
        openLink: (href: string) => void
        copyLink: (href: string) => void
        clear: () => void
    }
    inbound: InboundEmailRow[]
    inboundDomain: string
    /** Every team an inbound address can name — org slugs are globally unique, so the compose form
     *  offers the whole world, cross-tenant, exactly like a real MX would accept. */
    inboundOrgs: { slug: string; name: string; tenantSlug: string }[]
    /** The handler slugs the compose form suggests — the registry's own keys, so a newly registered
     *  handler shows up without the panel being told about it twice. */
    inboundHandlerSlugs: string[]
    composeInbound: (input: InboundComposeInput) => void
    smsMessages: SmsMessageRow[]
    events: AnalyticsEvent[]
    auditEntries: AuditEntry[]
    schedules: ScheduleRowLike[]
    jobsHeld: boolean
    runPendingJobs: () => void
    clock: {
        offsetMs: number
        worldNowIso: string
        advance: (deltaMs: number) => void
        reset: () => void
        runDue: () => void
    }
    deliveries: DemoDelivery[]
    failingEndpointIds: string[]
    toggleEndpointFailure: (endpointId: string, failing: boolean) => void
    runDueDeliveriesNow: () => void
    featureFlags: FeatureFlag[]
    setFeatureFlag: (flag: string, enabled: boolean) => void
    demoBannerOn: boolean
    resetWorld: () => void
    /** Load a registered demo preset (keel/core/presets.ts): reset, replay its operations, sit down as its
     *  viewpoint. Resolves true once the world is ready; false when no preset has that id, or when the
     *  replay was abandoned (a reset or another load mid-replay) or hit a step it could not perform. */
    applyPreset: (id: string) => Promise<boolean>
}
