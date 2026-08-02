import {
    attachments as seedAttachments,
    escalations as seedEscalations,
    findPerson,
    mail as seedMail,
    tickets as seedTickets,
} from '@app/seed'
import type { AppSeedContext, AppSeedRows } from 'keel/seed/contracts'

/**
 * The APP's product-row seeder (the optional half of the seed seam, ADR-0012). The framework seeder
 * (keel/db/seed.ts) creates the tenants, orgs, agreements and schedules its own contract describes, then
 * hands control here for the rows only the app knows about. An app with no product corpus simply does
 * not export `appSeedRows` and the framework skips this step — which is what apps/starter does.
 *
 * WHY THE DEMO NEEDS THIS AT ALL. Before it existed the showcase booted EMPTY: every card said "nothing
 * here yet" and the tour was "click each card and watch it fill". A product demo should start inside a
 * story — a queue with an overdue ticket in it, an escalation waiting on a decision, an analysis that
 * already came back — so the first thing a stakeholder sees is a desk mid-shift, not a fresh install.
 *
 * IDEMPOTENCE + RESET. One check-then-insert guard over the whole block: if the world already has a
 * ticket, nothing here runs. That makes boot idempotent (dev restarts do not duplicate the queue) and
 * makes Simulator's "Reset world" work correctly — reset wipes `.data/`, the next DB access re-migrates
 * and re-seeds, and the desk comes back exactly as it started. Seeding from the app's own boot hook
 * instead would NOT survive a reset, which is why this hangs off the framework seeder.
 *
 * AGES ARE RELATIVE. Every row's `created_at` is computed backwards from boot, so the oldest ticket is
 * always visibly past the desk's SLA whenever you start the app, and the queue never looks like a
 * fixture from a date in the past.
 */

function agoIso(hours: number): string {
    return new Date(Date.now() - hours * 3_600_000).toISOString()
}

export const appSeedRows: AppSeedRows = async ({ db, storage, email }: AppSeedContext) => {
    // The one guard for the whole corpus. Any ticket at all means this world has already been seeded
    // (or lived in), so we leave it alone.
    const alreadySeeded = await db.selectFrom('tickets').select('id').limit(1).executeTakeFirst()
    if (alreadySeeded) return

    const tenantIds = new Map<string, string>()
    for (const row of await db.selectFrom('tenants').select(['id', 'slug']).execute()) {
        tenantIds.set(row.slug, row.id)
    }
    const orgIds = new Map<string, string>()
    for (const row of await db.selectFrom('organizations').select(['id', 'slug']).execute()) {
        orgIds.set(row.slug, row.id)
    }

    // ---- the queue ----
    for (const ticket of seedTickets) {
        const tenantId = tenantIds.get(ticket.tenantSlug)
        const orgId = orgIds.get(ticket.orgSlug)
        if (!tenantId || !orgId) continue
        await db
            .insertInto('tickets')
            .values({
                tenant_id: tenantId,
                org_id: orgId,
                ref: ticket.ref,
                subject: ticket.subject,
                body: ticket.body,
                status: ticket.status,
                assignee_user_id: ticket.assigneePersonId,
                created_at: agoIso(ticket.ageHours),
                updated_at: agoIso(ticket.ageHours),
            })
            .execute()
    }

    // ---- the decision on the table ----
    for (const escalation of seedEscalations) {
        const tenantId = tenantIds.get(escalation.tenantSlug)
        const requesterOrgId = orgIds.get(escalation.requesterOrgSlug)
        const responderOrgId = orgIds.get(escalation.responderOrgSlug)
        if (!tenantId || !requesterOrgId || !responderOrgId) continue
        await db
            .insertInto('escalations')
            .values({
                tenant_id: tenantId,
                requester_org_id: requesterOrgId,
                responder_org_id: responderOrgId,
                created_by_user_id: escalation.createdByPersonId,
                subject: escalation.subject,
                body: escalation.body,
                status: escalation.status,
                created_at: agoIso(escalation.ageHours),
                updated_at: agoIso(escalation.ageHours),
            })
            .execute()
    }

    // ---- the bundle and the analysis that came back ----
    //
    // Bytes as well as rows: a seeded attachment whose object is missing would list with a download
    // link that 404s, which is a worse first impression than an empty card. The storage key follows the
    // same server-built shape the mint route uses (`attachments/<tenant>/<id>/<name>`).
    for (const [index, attachment] of seedAttachments.entries()) {
        const tenantId = tenantIds.get(attachment.tenantSlug)
        const orgId = orgIds.get(attachment.orgSlug)
        if (!tenantId || !orgId) continue
        const storageKey = `attachments/${tenantId}/seed-${index}/${attachment.filename}`
        await storage.put(storageKey, attachment.content, attachment.contentType)
        await db
            .insertInto('attachments')
            .values({
                tenant_id: tenantId,
                org_id: orgId,
                kind: attachment.kind,
                filename: attachment.filename,
                content_type: attachment.contentType,
                size_bytes: new TextEncoder().encode(attachment.content).byteLength,
                storage_key: storageKey,
                status: 'ready',
                uploaded_by_user_id: attachment.uploadedByPersonId,
                created_at: agoIso(attachment.ageHours),
            })
            .execute()
    }

    // ---- one unread message, so the Simulator pill already carries a badge ----
    //
    // Sent through the email PORT rather than written into the mail store, so it is a genuine caught
    // message: it opens in the Mail tab's reading pane like any other. Its copy is WORLD DATA (like a
    // ticket body), not UI copy — a seeded artifact of the story, not a string the product renders.
    for (const message of seedMail) {
        const person = findPerson(message.toPersonId)
        if (!person) continue
        await email.send({
            to: person.email,
            subject: message.subject,
            text: message.text,
            html: `<p>${message.text}</p>`,
        })
    }
}
