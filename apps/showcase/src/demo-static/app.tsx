import {
    attachments as seedAttachments,
    escalations as seedEscalations,
    findOrg,
    findPerson,
    mail as seedMail,
    organizations,
    tickets as seedTickets,
    type SeedPerson,
} from '@app/seed'
import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import assistantFixture from '../../fixtures/llm/assistant-desk.json'
import composeFixture from '../../fixtures/llm/assistant-desk-compose.json'
import { ActorsApp, type ActorSlot } from 'keel/components/simulator/actors-app'
import { type ActorLog, builderTick, type ServiceMemory, serviceTick } from 'keel/components/simulator/actor-runtime'
import { ActorShell } from 'keel/components/simulator/actor-shell'
import type { SimulatorExtraTab } from 'keel/components/simulator/simulator-panel'
import { type AssistantFixture, replayAssistant } from 'keel/demo-static/assistant-replay'
import type { DemoInboundHandler } from 'keel/demo-static/contracts'
import { go } from 'keel/demo-static/hash-route'
import { DemoShell } from 'keel/demo-static/shell'
import { useDemoWorld } from 'keel/demo-static/world'
import { defineAbilitiesFor } from 'keel/core/abilities'
import { keysetPageInMemory, parseKeysetCursor } from 'keel/core/keyset'
import type { Locale } from 'keel/core/locale'
import { AttachmentsCard, type AttachmentItem } from '../components/attachments-card'
import { AppNav } from '../components/app-nav'
import { DashboardScreen } from '../components/dashboard-screen'
import { EscalationsCard, type EscalationItem } from '../components/escalations-card'
import { ExportCard } from '../components/export-card'
import { TicketsCard, type TicketItem } from '../components/tickets-card'
import { WelcomeScreen } from '../components/welcome-screen'
import { staffOrgSlug } from '../app-config/abilities'
import { actors, analyzerOrgSlug } from '../app-config/actors'
import { actorsHeldFlag, tabs as appSimulatorTabs } from '../app-config/simulator'
import { type EscalationStatus, escalationMachine } from '../domain/escalations'
import { TICKET_PAGE_SIZE, nextTicketRef, type TicketStatus, ticketMachine } from '../domain/tickets'

/**
 * The static demo's COMPOSITION ROOT — the `file://` twin of the server-side glue, and the same job:
 * take the framework's simulated world (keel/demo-static/world), add THIS app's own rows, hand the
 * shell its screens, and get out of the way (ADR-0006, ADR-0012). Everything generic — routing, the
 * people, mail, jobs, schedules, webhooks, notifications, agreements, audit, the whole Simulator panel —
 * lives in the package; what is left here is the desk: tickets, escalations and attachments.
 *
 * The twin STARTS SEEDED, from the same `@app/seed` corpus the server seeder uses, so the `file://`
 * bundle opens on the same queue mid-shift that `pnpm dev` does — and a world reset restores exactly
 * that, rather than emptying the desk.
 *
 * No logic worth unit-testing lives in this file; the parity that matters is that the cards below are
 * gated by the SAME pure ability model and driven through the SAME state machines the real routes use.
 */

/** In-memory twin of a tickets row — tenant+org scoped, so the static dashboard shows only the active
 *  team's queue (no cross-tenant leakage) and can gate create/update/delete by the same pure ability
 *  model the real server runs. Tickets are just rows, so this is genuine parity, not a degrade. */
interface DemoTicket {
    id: string
    tenantSlug: string
    orgSlug: string
    ref: string
    subject: string
    body: string
    status: TicketStatus
    assigneeUserId: string | null
    createdAt: string
}

/** In-memory twin of an escalations row. An escalation is TWO-SIDED — it names a raising desk and a
 *  receiving team, both within one tenant — so the static dashboard can show the same row to both
 *  parties and gate accept/reject/withdraw by the SAME pure ability model the real server runs. The
 *  status moves through the SAME escalationMachine (../domain/escalations), so an illegal hop is
 *  guarded here exactly as it is server-side — genuine parity, no physics degrade. */
interface DemoEscalation {
    id: string
    tenantSlug: string
    requesterOrgSlug: string
    responderOrgSlug: string
    createdByPersonId: string
    subject: string
    body: string
    status: EscalationStatus
    createdAt: string
}

/** In-memory twin of an attachments row. Single-org scoped like DemoTicket. DEGRADE: the static shell
 *  has no server OR filesystem, so only the file's METADATA (name/size/kind) is kept — the bytes are
 *  never stored and there's no download link (physics forbid, exactly like jobs' CSV). The browser File
 *  API still runs from file://, so reading name/size/type in-memory is genuine capability parity. */
interface DemoAttachment {
    id: string
    tenantSlug: string
    orgSlug: string
    filename: string
    kind: string
    sizeBytes: number
}

/** Ages in the seed corpus are RELATIVE (hours before boot), so they are resolved at world start —
 *  and re-resolved on reset, keeping the oldest ticket reliably past its SLA whenever you look. */
function agoIso(hours: number): string {
    return new Date(Date.now() - hours * 3_600_000).toISOString()
}

function initialTickets(): DemoTicket[] {
    return seedTickets.map((ticket, index) => ({
        id: `seed-ticket-${index}`,
        tenantSlug: ticket.tenantSlug,
        orgSlug: ticket.orgSlug,
        ref: ticket.ref,
        subject: ticket.subject,
        body: ticket.body,
        status: ticket.status,
        assigneeUserId: ticket.assigneePersonId,
        createdAt: agoIso(ticket.ageHours),
    }))
}

function initialEscalations(): DemoEscalation[] {
    return seedEscalations.map((escalation, index) => ({
        id: `seed-escalation-${index}`,
        tenantSlug: escalation.tenantSlug,
        requesterOrgSlug: escalation.requesterOrgSlug,
        responderOrgSlug: escalation.responderOrgSlug,
        createdByPersonId: escalation.createdByPersonId,
        subject: escalation.subject,
        body: escalation.body,
        status: escalation.status,
        createdAt: agoIso(escalation.ageHours),
    }))
}

function initialAttachments(): DemoAttachment[] {
    return seedAttachments.map((attachment, index) => ({
        id: `seed-attachment-${index}`,
        tenantSlug: attachment.tenantSlug,
        orgSlug: attachment.orgSlug,
        filename: attachment.filename,
        kind: attachment.kind,
        sizeBytes: new TextEncoder().encode(attachment.content).byteLength,
    }))
}

/**
 * The queue's paging twin. NOT a degrade and NOT a slice: it walks the SAME keyset cursor chain the
 * server walks, through the same pure primitive (`keel/core/keyset`), minting and re-parsing a real
 * opaque cursor on each hop — so the `file://` build proves the cursor grammar as well as the button.
 *
 * Where it differs from the server glue is honest and in the twin's favour: the server ACCUMULATES
 * pages in client state because refetching them costs a round trip, while the twin has the whole
 * world in memory and simply re-walks from the start on every render. That is why its state is a page
 * COUNT rather than a cursor — and why a ticket arriving at the head (an inbound email, say) shows up
 * immediately without disturbing how far down the reader has walked.
 */
function pagedTickets<T extends { id: string; createdAt: string }>(
    rows: readonly T[],
    pages: number,
): { rows: T[]; hasMore: boolean } {
    const positionOf = (ticket: T) => ({ at: ticket.createdAt, id: ticket.id })
    const walked: T[] = []
    let cursor: string | null = null
    for (let page = 0; page < pages; page++) {
        const parsed = parseKeysetCursor(cursor)
        const result = keysetPageInMemory(rows, positionOf, {
            after: parsed.kind === 'after' ? parsed.position : null,
            limit: TICKET_PAGE_SIZE,
        })
        walked.push(...result.rows)
        if (result.nextCursor === null) return { rows: walked, hasMore: false }
        cursor = result.nextCursor
    }
    return { rows: walked, hasMore: true }
}

/** How the twin streams a replayed answer: a handful of words at a time, so the card's incremental
 *  path is genuinely exercised without a demo audience waiting on an artificial typewriter. */
const STREAM_WORDS_PER_CHUNK = 6
const STREAM_CHUNK_MS = 12

export function StaticDemoApp({ locale, onLocaleChange }: { locale: Locale; onLocaleChange: (l: Locale) => void }) {
    const tSimulator = useTranslations('simulator')
    const tActors = useTranslations('actors')
    // The product's name comes from THIS app's catalog — the framework's has no default (app-header.tsx).
    const tWelcome = useTranslations('welcome')
    const [demoTickets, setDemoTickets] = useState<DemoTicket[]>(initialTickets)
    /** How many pages of the queue the reader has asked for — the twin of the glue's cursor state. */
    const [ticketPages, setTicketPages] = useState(1)
    const [demoEscalations, setDemoEscalations] = useState<DemoEscalation[]>(initialEscalations)
    const [demoAttachments, setDemoAttachments] = useState<DemoAttachment[]>(initialAttachments)
    // Actors-tab twin (ADR-0006 FULL parity): the analyzer's claimed-id memory held OUTSIDE the
    // ActorShell. The shell itself is lazy (nothing exists until the Actors tab is first opened) and then
    // kept mounted (`keepMounted`), so the memory no longer has to outlive tab switches — it lives here so
    // the twin owns it alongside the world it describes. A world reset must clear it explicitly since
    // nothing else would (it isn't part of the jobs list) — hence the onReset below.
    const serviceMemoryRef = useRef<ServiceMemory>({ claimed: new Set() })

    /**
     * Twin of the desk's inbound handlers (../domain/inbound-handlers.ts): email opens a ticket. Same
     * posture as the real ones — the sender must be a member of the addressed team AND pass the SAME
     * `can('create', Ticket)` check the tickets route enforces, so email authoring grants no more than
     * the UI does; an unmatched or unauthorized sender files 'unmatched' rather than writing a ticket.
     * The only difference between the two registered slugs is the status the ticket starts in, exactly
     * as on the server.
     */
    const ticketFromEmail =
        (status: TicketStatus): DemoInboundHandler =>
        ({ org, members, fromEmail, subject, bodyText, recordAudit }) => {
            const sender = members.find((p) => p.email.toLowerCase() === fromEmail)
            const membership = sender?.memberships.find((m) => m.orgSlug === org.slug)
            if (!sender || !membership) {
                return { status: 'unmatched', reason: `sender ${fromEmail} is not a member of ${org.slug}` }
            }
            const ability = defineAbilitiesFor({
                userId: sender.id,
                role: membership.role,
                restricted: sender.restricted,
                activeOrgId: org.slug,
                manageAll: false,
            })
            if (!ability.can('create', { type: 'Ticket', orgId: org.slug })) {
                return { status: 'unmatched', reason: `sender ${fromEmail} may not open tickets in ${org.slug}` }
            }
            const cleanSubject = subject.trim()
            const cleanBody = bodyText.trim()
            if (!cleanSubject && !cleanBody) {
                return { status: 'unmatched', reason: 'empty email (no subject or body)' }
            }
            const id = `ticket-inbound-${new Date().toISOString()}-${demoTickets.length}`
            setDemoTickets((prev) => [
                {
                    id,
                    tenantSlug: org.tenantSlug,
                    orgSlug: org.slug,
                    ref: nextTicketRef(
                        prev.filter((t) => t.tenantSlug === org.tenantSlug).map((t) => t.ref),
                        org.tenantSlug,
                    ),
                    subject: cleanSubject || cleanBody.slice(0, 80),
                    body: cleanBody || cleanSubject,
                    status,
                    assigneeUserId: null,
                    createdAt: new Date().toISOString(),
                },
                ...prev,
            ])
            recordAudit({ action: 'ticket.created', subjectType: 'Ticket', subjectId: id, actorUserId: sender.id })
            return { status: 'handled', actorUserId: sender.id }
        }

    const world = useDemoWorld({
        inboundHandlers: { support: ticketFromEmail('open'), feedback: ticketFromEmail('resolved') },
        // The same opening outbox the server seeder sends through the email port, so the `file://`
        // demo starts with the same badge on the Simulator pill.
        initialMail: seedMail.map((message) => ({
            to: findPerson(message.toPersonId)?.email ?? '',
            subject: message.subject,
            html: `<p>${message.text}</p>`,
        })),
        // The framework's scheduled digest summarizes the OPEN queue, which only this root can see —
        // the same projection the server-side seam makes (@app-config/digest).
        digestBodies: ({ tenantSlug, orgSlug }) =>
            demoTickets
                .filter((t) => t.tenantSlug === tenantSlug && t.orgSlug === orgSlug && t.status !== 'resolved')
                .map((t) => `${t.ref} — ${t.subject}`),
        onReset: () => {
            // Back to the SEEDED desk, not to an empty one: reset restores the world, and the world has
            // a queue in it.
            setDemoTickets(initialTickets())
            setTicketPages(1)
            setDemoEscalations(initialEscalations())
            setDemoAttachments(initialAttachments())
            serviceMemoryRef.current = { claimed: new Set() }
        },
    })

    const { serviceDriver, builderDriver } = world
    // The drivers are cheap to reconstruct every tick (no credentials to cache, unlike the real ones),
    // so each is built fresh from the CURRENT `log` — avoiding a stale-log-closure bug across the
    // Actors-tab remounts. The analyzer's scope is its own team, in that team's tenant, exactly what
    // its minted token would claim server-side.
    const serviceTickFn = useCallback(
        (log: ActorLog) =>
            serviceTick(
                serviceDriver(
                    { tenantSlug: findOrg(analyzerOrgSlug)?.tenantSlug ?? '', orgSlug: analyzerOrgSlug },
                    log,
                ),
                serviceMemoryRef.current,
                log,
                tSimulator,
            ),
        [serviceDriver, tSimulator],
    )
    const builderTickFn = useCallback(
        (log: ActorLog) => builderTick(builderDriver([analyzerOrgSlug], log), log, tSimulator),
        [builderDriver, tSimulator],
    )
    // The world's hold on its counterparties — the same `actors-held` flag the server host reads.
    const actorsHeld = world.featureFlags.find((f) => f.flag === actorsHeldFlag)?.enabled ?? false
    const actorSlots: ActorSlot[] = actors.map(({ id, titleKey, descriptionKey }) => ({
        id,
        title: tActors(titleKey),
        description: tActors(descriptionKey),
        node: (
            <ActorShell
                key={id}
                actor={id}
                inline
                startPaused={false}
                held={() => actorsHeld}
                tick={id === 'bundle-analyzer' ? serviceTickFn : builderTickFn}
            />
        ),
    }))

    // App Simulator tabs (Actors) — same seam registration the real glue reads (@app-config/simulator),
    // composed here with the twin's inline ActorShell nodes. Proves the extraTabs API works file://-side;
    // the panel slots them between Hooks and Errors just as in the server host.
    const extraTabs: SimulatorExtraTab[] = appSimulatorTabs.map((tab) => ({
        id: tab.id,
        label: tSimulator(tab.labelKey),
        keepMounted: tab.keepMounted,
        content: <ActorsApp slots={actorSlots} world={{ held: world.jobsHeld, counts: world.jobCounts }} />,
    }))

    function renderDashboard(person: SeedPerson) {
        const { tenant, activeOrgSlug, org } = world
        // Same pure ability the real server runs — restricted people get a read-only TicketsCard here
        // too (ADR-0006 parity).
        const ability = defineAbilitiesFor({
            userId: person.id,
            role: world.roleInOrg(person, activeOrgSlug),
            restricted: person.restricted,
            activeOrgId: activeOrgSlug,
            // Staff seam: acting AS the desk-ops org activates manage-all, exactly like
            // abilityActorFromUser derives it server-side — genuine parity, no degrade.
            manageAll: activeOrgSlug === staffOrgSlug,
        })
        const canWriteTicket =
            ability.can('create', { type: 'Ticket', orgId: activeOrgSlug }) &&
            ability.can('update', { type: 'Ticket', orgId: activeOrgSlug })
        // Escalations — the slug anchor stands in for both sides, exactly like canInActiveOrg:
        // create-gate = "am I the raising desk" (non-restricted member), respond-gate = "am I the
        // receiving team" (org manager). Same pure ability the real server runs.
        const escalationAnchor = { requesterOrgId: activeOrgSlug, responderOrgId: activeOrgSlug }
        const canCreateEscalation = ability.can('create', { type: 'Escalation', ...escalationAnchor })
        const canRespondEscalation = ability.can('update', { type: 'Escalation', ...escalationAnchor })
        // Uploads — single-org scope, same pure ability the real server runs.
        const canCreateAttachment = ability.can('create', { type: 'Attachment', orgId: activeOrgSlug })
        // Jobs — Export and Analyze both submit work (Job create is !restricted), the same gate the
        // real dashboard reflects.
        const canCreateJob = ability.can('create', { type: 'Job', orgId: activeOrgSlug })
        // The APP-registered Snapshots flag, read from the same world the panel toggles — so flipping it
        // in the file:// demo changes the product here exactly as it does server-side.
        const slaHighlight = world.featureFlags.find((f) => f.flag === 'sla-breach-banner')?.enabled ?? false

        // The active team's jobs drive the ExportCard (tenant + org scoped, like GET /api/jobs); the
        // Simulator Jobs tab gets the whole cross-tenant list. Both stay newest-first.
        const dashboardJobs = world.jobs.filter((j) => j.tenantSlug === tenant.slug && j.orgSlug === activeOrgSlug)
        // The active team's whole queue: tenant + active team, the two boundaries RLS and the app-level
        // filter enforce server-side. SCOPE FIRST, then page — the cursor never supplies either.
        const teamTickets: TicketItem[] = demoTickets
            .filter((ticket) => ticket.tenantSlug === tenant.slug && ticket.orgSlug === activeOrgSlug)
            .map((ticket) => ({
                id: ticket.id,
                ref: ticket.ref,
                subject: ticket.subject,
                body: ticket.body,
                status: ticket.status,
                assigneeUserId: ticket.assigneeUserId,
                createdAt: ticket.createdAt,
            }))
        // What the CARD shows: one page of that, plus however many more the reader has asked for. The
        // assistant's tools below deliberately read `teamTickets` instead — a tool answers "what is on
        // my plate", which is the team's queue, not the part of it currently on screen (the server's
        // tool closures read the table the same way).
        const ticketQueue = pagedTickets(teamTickets, ticketPages)
        const dashboardTickets: TicketItem[] = ticketQueue.rows
        // Twin of the server page's assignee lookup: the active team's members, by name.
        const assignees = world.allPeople
            .filter((p) => p.memberships.some((m) => m.orgSlug === activeOrgSlug))
            .map((p) => ({ id: p.id, name: p.name }))
        // Twin of listAttachments (tenant + active org). DEGRADE: no downloadUrl — the static shell has
        // no server to serve bytes (physics), so the card omits the download link, like jobs.
        const dashboardAttachments: AttachmentItem[] = demoAttachments
            .filter((a) => a.tenantSlug === tenant.slug && a.orgSlug === activeOrgSlug)
            .map((a) => ({ id: a.id, filename: a.filename, kind: a.kind, sizeBytes: a.sizeBytes }))
        // Two-sided filter twin of listEscalations: same-tenant rows where the active org is on one
        // side. findOrg resolves each side's display name (never crosses tenants).
        const inTenant = demoEscalations.filter((r) => r.tenantSlug === tenant.slug)
        const toItem = (r: DemoEscalation): EscalationItem => ({
            id: r.id,
            subject: r.subject,
            body: r.body,
            status: r.status,
            requesterOrgName: findOrg(r.requesterOrgSlug)?.name ?? r.requesterOrgSlug,
            responderOrgName: findOrg(r.responderOrgSlug)?.name ?? r.responderOrgSlug,
            createdAt: r.createdAt,
        })
        const sentEscalations = inTenant.filter((r) => r.requesterOrgSlug === activeOrgSlug).map(toItem)
        const receivedEscalations = inTenant.filter((r) => r.responderOrgSlug === activeOrgSlug).map(toItem)
        // Targets = the tenant's OTHER teams (you can't escalate to your own team).
        const escalationTargets = organizations
            .filter((o) => o.tenantSlug === tenant.slug && o.slug !== activeOrgSlug)
            .map((o) => ({ slug: o.slug, name: o.name }))

        /** Twin of the assistant's two tools: the same projection over the in-memory queue.
         *  `search_tickets` gets the model's own recorded input, so the twin filters as the server does. */
        function runTool(toolName: string, input: unknown): string {
            const fact = (t: TicketItem) => ({
                ref: t.ref,
                subject: t.subject,
                status: t.status,
                assigned: t.assigneeUserId !== null,
            })
            if (toolName === 'search_tickets') {
                const query = (input as { query?: unknown } | null)?.query
                if (typeof query !== 'string' || query.trim() === '') {
                    return JSON.stringify({ error: 'search_tickets requires a non-empty string "query"' })
                }
                const needle = query.trim().toLowerCase()
                const matched = teamTickets.filter(
                    (t) => t.subject.toLowerCase().includes(needle) || t.body.toLowerCase().includes(needle),
                )
                return JSON.stringify({ query, tickets: matched.map(fact) })
            }
            return JSON.stringify({ tickets: teamTickets.map(fact) })
        }

        return (
            <DashboardScreen
                user={{
                    name: world.name,
                    role: world.roleInOrg(person, activeOrgSlug),
                    restricted: person.restricted,
                }}
                onAsk={async (question, onDelta) => {
                    world.logEvent('assistant_asked', { tenant: tenant.slug })
                    // Pass 1 — the recorded tool loop, with the tools executed LIVE against the
                    // in-memory queue (canned utterances, real effects), collecting the same `sources`
                    // the server route collects.
                    const sources: string[] = []
                    await replayAssistant(
                        assistantFixture as unknown as AssistantFixture,
                        question,
                        async (toolName, input) => {
                            const result = runTool(toolName, input)
                            const parsed = JSON.parse(result) as { tickets?: { ref: string; subject: string }[] }
                            for (const ticket of parsed.tickets ?? []) {
                                const line = `${ticket.ref} — ${ticket.subject}`
                                if (!sources.includes(line)) sources.push(line)
                            }
                            return result
                        },
                    )
                    // Pass 2 — the composing model. DEGRADE (physics, and a small one): there is no
                    // server to stream from, so the twin replays the compose fixture's default entry —
                    // the SAME text the server's own stream resolves to, since that request always
                    // carries live data and therefore always falls through to this entry — and emits it
                    // in chunks so the card's incremental path runs identically.
                    const answer = composeFixture.entries.find((e) => e.request === null)?.response ?? ''
                    const words = answer.split(/(?<= )/)
                    for (let i = 0; i < words.length; i += STREAM_WORDS_PER_CHUNK) {
                        onDelta(words.slice(i, i + STREAM_WORDS_PER_CHUNK).join(''))
                        await new Promise((resolve) => setTimeout(resolve, STREAM_CHUNK_MS))
                    }
                    return { sources }
                }}
            >
                <TicketsCard
                    tickets={dashboardTickets}
                    assignees={assignees}
                    canWrite={canWriteTicket}
                    slaHighlight={slaHighlight}
                    hasMore={ticketQueue.hasMore}
                    onLoadMore={async () => setTicketPages((pages) => pages + 1)}
                    onCreate={async ({ subject, body }) => {
                        const id = crypto.randomUUID()
                        setDemoTickets((prev) => [
                            {
                                id,
                                tenantSlug: tenant.slug,
                                orgSlug: activeOrgSlug,
                                ref: nextTicketRef(
                                    prev.filter((t) => t.tenantSlug === tenant.slug).map((t) => t.ref),
                                    tenant.slug,
                                ),
                                subject,
                                body,
                                status: 'open',
                                assigneeUserId: null,
                                createdAt: new Date().toISOString(),
                            },
                            ...prev,
                        ])
                        world.logAudit('ticket.created', 'Ticket', id)
                    }}
                    onUpdate={async (id, changes) => {
                        const target = demoTickets.find((t) => t.id === id)
                        if (!target) return
                        // Same state-machine guard as updateTicket — an illegal hop is a refused no-op,
                        // and the audit trail must say only what actually happened (the server 409s).
                        if (changes.status && !ticketMachine.canTransition(target.status, changes.status)) return
                        setDemoTickets((prev) =>
                            prev.map((t) =>
                                t.id === id
                                    ? {
                                          ...t,
                                          status: changes.status ?? t.status,
                                          assigneeUserId:
                                              changes.assigneeUserId !== undefined
                                                  ? changes.assigneeUserId
                                                  : t.assigneeUserId,
                                      }
                                    : t,
                            ),
                        )
                        const reassigned =
                            changes.assigneeUserId !== undefined && changes.assigneeUserId !== target.assigneeUserId
                        world.logAudit(reassigned ? 'ticket.assigned' : 'ticket.updated', 'Ticket', id)
                        // Being handed a ticket notifies the ASSIGNEE, not the team's admins — the same
                        // recipient decision the server route makes, and self-assignment notifies nobody.
                        if (reassigned && changes.assigneeUserId) {
                            world.notifyMemberOf(
                                activeOrgSlug,
                                changes.assigneeUserId,
                                'ticket.assigned',
                                {
                                    ticketId: id,
                                    ref: target.ref,
                                    subject: target.subject,
                                    assignedByName: world.name,
                                },
                                person.id,
                            )
                        }
                    }}
                    onDelete={async (id) => {
                        setDemoTickets((prev) => prev.filter((t) => t.id !== id))
                        // The audit event outlives the row here too — the trail is a separate list.
                        world.logAudit('ticket.deleted', 'Ticket', id)
                    }}
                />
                <ExportCard
                    jobs={dashboardJobs}
                    canCreate={canCreateJob}
                    onExport={async () => world.startJob('export-tickets')}
                />
                <EscalationsCard
                    sent={sentEscalations}
                    received={receivedEscalations}
                    targets={escalationTargets}
                    canCreate={canCreateEscalation}
                    canRespond={canRespondEscalation}
                    onCreate={async ({ responderOrgSlug, subject, body }) => {
                        const id = crypto.randomUUID()
                        setDemoEscalations((prev) => [
                            {
                                id,
                                tenantSlug: tenant.slug,
                                requesterOrgSlug: activeOrgSlug,
                                responderOrgSlug,
                                createdByPersonId: person.id,
                                subject,
                                body,
                                status: 'open',
                                createdAt: new Date().toISOString(),
                            },
                            ...prev,
                        ])
                        world.logAudit('escalation.created', 'Escalation', id)
                        world.enqueueWebhook('escalation.created', {
                            escalationId: id,
                            subject,
                            requesterOrgId: activeOrgSlug,
                            responderOrgId: responderOrgSlug,
                        })
                        // The escalation lands on the RECEIVING team — notify its admins.
                        world.notifyAdminsOf(responderOrgSlug, 'escalation.received', {
                            escalationId: id,
                            subject,
                            requesterOrgName: org.name,
                        })
                    }}
                    onRespond={async (id, decision) => {
                        const next: EscalationStatus = decision === 'accept' ? 'accepted' : 'rejected'
                        // Same state-machine guard as transitionEscalation — an illegal hop (already
                        // decided) is a refused no-op, and the audit trail must say only what actually
                        // happened (the server 409s and writes no row).
                        const target = demoEscalations.find((r) => r.id === id)
                        if (!target || !escalationMachine.canTransition(target.status, next)) return
                        setDemoEscalations((prev) =>
                            prev.map((r) =>
                                r.id === id && escalationMachine.canTransition(r.status, next)
                                    ? { ...r, status: next }
                                    : r,
                            ),
                        )
                        world.logAudit(`escalation.${next}`, 'Escalation', id)
                        world.enqueueWebhook('escalation.decided', {
                            escalationId: id,
                            decision: next as 'accepted' | 'rejected',
                            requesterOrgId: target.requesterOrgSlug,
                            responderOrgId: target.responderOrgSlug,
                        })
                    }}
                    onCancel={async (id) => {
                        const target = demoEscalations.find((r) => r.id === id)
                        if (!target || !escalationMachine.canTransition(target.status, 'cancelled')) return
                        setDemoEscalations((prev) =>
                            prev.map((r) =>
                                r.id === id && escalationMachine.canTransition(r.status, 'cancelled')
                                    ? { ...r, status: 'cancelled' }
                                    : r,
                            ),
                        )
                        world.logAudit('escalation.cancelled', 'Escalation', id)
                        world.enqueueWebhook('escalation.decided', {
                            escalationId: id,
                            decision: 'cancelled',
                            requesterOrgId: target.requesterOrgSlug,
                            responderOrgId: target.responderOrgSlug,
                        })
                    }}
                />
                <AttachmentsCard
                    attachments={dashboardAttachments}
                    canCreate={canCreateAttachment}
                    onUpload={async (file, kind) => {
                        // DEGRADE (physics): no server or filesystem — keep only the file's metadata
                        // (name/size/type, read via the browser File API which works from file://).
                        // The bytes aren't stored and there's no download link.
                        const id = crypto.randomUUID()
                        setDemoAttachments((prev) => [
                            {
                                id,
                                tenantSlug: tenant.slug,
                                orgSlug: activeOrgSlug,
                                filename: file.name,
                                kind,
                                sizeBytes: file.size,
                            },
                            ...prev,
                        ])
                        // The twin's single-step upload is a mint + confirm on the real server, so it
                        // records both audit events (same id) for a faithful trail.
                        world.logAudit('attachment.minted', 'Attachment', id)
                        world.logAudit('attachment.confirmed', 'Attachment', id)
                    }}
                    // DEGRADE (physics): the job runs and completes on the twin's own job list, but
                    // there is no storage to hold the analysis document and no download link — the same
                    // degrade the export already has, for the same reason. Gated like the export: both
                    // submit a Job, which restricted members may not create.
                    onAnalyze={canCreateJob ? async () => world.startJob('analyze-bundle') : undefined}
                />
            </DashboardScreen>
        )
    }

    return (
        <DemoShell
            world={world}
            locale={locale}
            onLocaleChange={onLocaleChange}
            appName={tWelcome('appName')}
            welcome={<WelcomeScreen dashboardHref="#/dashboard" />}
            nav={<AppNav onNavigate={(target) => go(target === 'dashboard' ? 'dashboard' : 'org')} />}
            dashboard={renderDashboard}
            extraTabs={extraTabs}
        />
    )
}
