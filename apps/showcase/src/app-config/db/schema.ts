import type { Generated } from 'kysely'

/**
 * The APP's tenant-scoped tables (the seam side of packages/keel/src/db/schema.ts, ADR-0012). The framework owns its
 * tables + the `DB` interface, which `extends AppTables` (a type-only seam import) so every existing
 * `import type { DB }` keeps working. A real adopter replaces this file's tables — and the matching
 * migrations (src/app-config/db/migrations, numbered ≥1001) — with its own. Kept in lockstep with
 * those migrations.
 *
 * The showcase is a support desk, so its three tables are a desk's three nouns: a TICKET (the work), an
 * ESCALATION (the same work handed to another team, two-sided), and an ATTACHMENT (a file riding along
 * with either).
 */

interface TicketsTable {
    id: Generated<string>
    tenant_id: string
    /** Nullable so RLS proofs / legacy rows stay valid; the app filters tickets by the active org. */
    org_id: string | null
    /** The desk's human-facing number (`NW-1041`). Unique per tenant — the queue is talked about by ref. */
    ref: string
    subject: string
    body: string
    /** open → pending → resolved, guarded by ticketMachine (src/domain/tickets.ts). */
    status: Generated<string>
    /** Opaque user id of the agent working it, null while it sits unclaimed (no users table). */
    assignee_user_id: string | null
    created_at: Generated<string>
    updated_at: Generated<string>
}

interface EscalationsTable {
    id: Generated<string>
    tenant_id: string
    /** The desk that raised the escalation. NOT NULL — an app-level filter, not an RLS anchor (1002). */
    requester_org_id: string
    /** The team it was handed to. NOT NULL. Distinct from requester_org_id (CHECK). */
    responder_org_id: string
    /** Opaque user id (no users table) — same convention as jobs / service_keys. */
    created_by_user_id: string
    subject: string
    body: string
    status: Generated<string>
    /** Null while open; whoever drove the terminal transition (responder on accept/reject, requester on cancel). */
    decided_by_user_id: string | null
    created_at: Generated<string>
    updated_at: Generated<string>
}

interface AttachmentsTable {
    id: Generated<string>
    tenant_id: string
    /** The team that owns the attachment. NOT NULL — single-org scope, an app-level filter (1003). */
    org_id: string
    /** App-defined kind (src/domain/attachments.ts); `text` in the DB, validated at the mint route. */
    kind: string
    filename: string
    content_type: string
    /** Null until confirm records the object's true length (read from storage, not client-declared). */
    size_bytes: number | null
    /** Server-built object key (`attachments/<tenant>/<uuid>/<name>`) — never client-supplied. */
    storage_key: string
    /** pending → ready. Only `ready` rows are listed (a never-uploaded pending row has no bytes). */
    status: Generated<string>
    /** Opaque user id (no users table) — same convention as jobs / service_keys. */
    uploaded_by_user_id: string
    created_at: Generated<string>
}

/** The app's tables, merged into the framework `DB` interface (packages/keel/src/db/schema.ts `extends AppTables`). */
export interface AppTables {
    tickets: TicketsTable
    escalations: EscalationsTable
    attachments: AttachmentsTable
}
