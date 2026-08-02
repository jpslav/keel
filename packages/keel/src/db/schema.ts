import type { AppTables } from '@app-config/db/schema'
import type { Generated } from 'kysely'

// The FRAMEWORK's tables. Kept in lockstep with packages/keel/src/db/migrations (kysely-codegen regeneration against
// embedded-postgres arrives with the contract-test job). The app's tenant-scoped tables register
// through the seam (src/app-config/db/schema.ts AppTables), merged into `DB` below (ADR-0012).
interface TenantsTable {
    id: Generated<string>
    slug: string
    name: string
}

interface OrganizationsTable {
    id: Generated<string>
    tenant_id: string
    slug: string
    name: string
}

interface JobsTable {
    id: Generated<string>
    tenant_id: string
    /** Nullable like an app product table’s org_id — RLS still contains every row; the app filters by the
     *  active org. */
    org_id: string | null
    kind: string
    /** Opaque handler input; jsonb round-trips as a parsed object on both pglite and real Postgres. */
    payload: unknown
    status: Generated<string>
    result_key: string | null
    error: string | null
    created_at: Generated<string>
    updated_at: Generated<string>
}

interface JobStatusChangesTable {
    id: Generated<string>
    tenant_id: string
    job_id: string
    status: string
    message: string | null
    at: Generated<string>
}

interface AuditEventsTable {
    id: Generated<string>
    tenant_id: string
    /** The org the audited action happened in. NOT NULL — every audited mutation is org-scoped (0008). */
    org_id: string
    /** Opaque actor id (no users table) — same convention as jobs / service_keys. */
    actor_user_id: string
    /** App-defined verb, e.g. `membership.invited`, `job.submitted` (text; never a UI literal). */
    action: string
    /** The ability SubjectType the action targeted, e.g. `Job`, `Membership`. */
    subject_type: string
    /** The affected row's id. Null only for a hypothetical action with no single subject row. */
    subject_id: string | null
    at: Generated<string>
}

interface JobSchedulesTable {
    id: Generated<string>
    tenant_id: string
    /** The team the schedule belongs to. NOT NULL — single-org scope, an app-level filter (0009). */
    org_id: string
    /** The JobKind spawned on each fire (packages/keel/src/core/jobs.ts). `text` in the DB; validated at the boundary. */
    kind: string
    /** The timing rule (packages/keel/src/core/schedules.ts ScheduleSpec) — jsonb, parsed by parseScheduleSpec. */
    spec: unknown
    /** Precomputed next fire time. No DB default — always supplied (seed/scheduler); insert a Date or
     *  ISO string, reads back as a Date on both engines (normalised via toIso / new Date()). */
    next_run_at: Date | string
    enabled: Generated<boolean>
    /** Opaque creator id (no users table) — same convention as jobs / service_keys. */
    created_by: string
    created_at: Generated<string>
}

interface WebhookEndpointsTable {
    id: Generated<string>
    tenant_id: string
    /** The team that owns the endpoint. NOT NULL — single-org scope, an app-level filter (0010). */
    org_id: string
    url: string
    /** Shared HMAC secret (plaintext — template simplicity, see decision log). Shown once on create. */
    secret: string
    /** jsonb array of WebhookEventKind strings the endpoint subscribes to (packages/keel/src/core/webhook-events.ts). */
    event_kinds: string[]
    enabled: Generated<boolean>
    /** Opaque creator id (no users table) — same convention as jobs / service_keys. */
    created_by: string
    created_at: Generated<string>
}

interface WebhookDeliveriesTable {
    id: Generated<string>
    tenant_id: string
    endpoint_id: string
    /** The WebhookEventKind that produced this delivery (packages/keel/src/core/webhook-events.ts). */
    event_kind: string
    /** The event payload — jsonb, round-trips as a parsed object on both engines. */
    payload: unknown
    /** pending → failed → delivered | dead (the retry state machine — see migration 0010). */
    status: Generated<string>
    attempt_count: Generated<number>
    /** When the drain should (re)attempt. No DB default — supplied at enqueue; a Date or ISO string,
     *  reads back a Date on both engines (normalised via toIso / new Date()). */
    next_attempt_at: Date | string
    last_error: string | null
    created_at: Generated<string>
    delivered_at: Date | string | null
}

interface NotificationsTable {
    id: Generated<string>
    tenant_id: string
    /** The org the notification belongs to. NOT NULL — org-scoped like audit_events (0011). */
    org_id: string
    /** Opaque recipient actor id (no users table) — same convention as jobs / service_keys. */
    recipient_user_id: string
    /** App-defined NotificationKind (packages/keel/src/core/notifications.ts); `text` here, validated at the seam. */
    kind: string
    /** The kind's payload (packages/keel/src/core/notifications.ts) — jsonb, round-trips as a parsed object. */
    payload: unknown
    /** Null while unread; the read instant once marked (the bell counts read_at IS NULL). */
    read_at: Date | string | null
    created_at: Generated<string>
}

interface NotificationPrefsTable {
    id: Generated<string>
    tenant_id: string
    /** The org the pref is scoped to. NOT NULL — org-scoped like the notification it governs (0011). */
    org_id: string
    /** Opaque owner id (no users table) — the user who alone may read/change this pref. */
    user_id: string
    /** NotificationKind × NotificationChannel this row toggles (packages/keel/src/core/notifications.ts). */
    kind: string
    channel: string
    /** The toggle. A row exists ONLY to override the default-on posture (enabled = false is an opt-out). */
    enabled: boolean
    created_at: Generated<string>
    updated_at: Generated<string>
}

interface InboundEmailsTable {
    id: Generated<string>
    tenant_id: string
    /** NULLable — an inbound message is filed under a tenant but org resolution may fail (0012). */
    org_id: string | null
    from_email: string
    to_email: string
    subject: Generated<string>
    /** Normalized plain text (packages/keel/src/core/inbound-email.ts strips quoted reply chains minimally). */
    body_text: Generated<string>
    body_html: string | null
    /** The registered handler slug that processed the message; NULL when no handler matched the slug. */
    handler: string | null
    /** received | handled | unmatched | failed (the intake outcome — see migration 0012). */
    status: Generated<string>
    error: string | null
    created_at: Generated<string>
}

interface AgreementsTable {
    id: Generated<string>
    tenant_id: string
    /** 'tos' | 'privacy' | 'custom' (packages/keel/src/core/agreements.ts). TENANT-scoped — NO org_id: an agreement
     *  applies to everyone in the tenant, not per-team (a deliberate deviation from the org-scoped
     *  default; see migration 0013 + the decision log). */
    kind: string
    /** Increments IN PLACE on a version bump — the row id is stable; an acceptance below this is pending. */
    version: Generated<number>
    title: string
    /** The agreement text — markdown, rendered simply. World CONTENT (like a note body), NOT a UI string. */
    body_md: string
    /** 'block-all' | 'advisory' (packages/keel/src/core/agreements.ts AgreementGating) — the gate behavior as data. */
    gating: string
    /** When this version took effect (set on create and on each bump). */
    effective_at: Generated<string>
    created_at: Generated<string>
}

interface AgreementAcceptancesTable {
    id: Generated<string>
    tenant_id: string
    agreement_id: string
    /** DENORMALIZED — the version accepted, so it survives later edits/bumps of the agreement row. */
    agreement_version: number
    /** Opaque actor id (no users table) — same convention as jobs / service_keys / notifications. */
    user_id: string
    accepted_at: Generated<string>
    /** Minimal capture context (user-agent etc) — jsonb, round-trips as a parsed object. */
    metadata: Generated<unknown>
}

interface ServiceKeysTable {
    id: Generated<string>
    tenant_id: string
    org_id: string
    /** Public key material (SPKI PEM). The private half never leaves the caller; NO RLS on this table. */
    public_key_pem: string
    created_at: Generated<string>
    revoked_at: string | null
}

// The composed schema: framework tables + the app's registered tables (AppTables, from the seam).
// Every existing `import type { DB }` keeps working.
export interface DB extends AppTables {
    tenants: TenantsTable
    organizations: OrganizationsTable
    jobs: JobsTable
    job_status_changes: JobStatusChangesTable
    service_keys: ServiceKeysTable
    audit_events: AuditEventsTable
    job_schedules: JobSchedulesTable
    webhook_endpoints: WebhookEndpointsTable
    webhook_deliveries: WebhookDeliveriesTable
    notifications: NotificationsTable
    notification_prefs: NotificationPrefsTable
    inbound_emails: InboundEmailsTable
    agreements: AgreementsTable
    agreement_acceptances: AgreementAcceptancesTable
}
