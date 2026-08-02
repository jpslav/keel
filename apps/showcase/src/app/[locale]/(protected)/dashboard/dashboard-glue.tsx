'use client'

import { useCallback, useEffect, useState } from 'react'
import { AttachmentsCard, type AttachmentItem } from '@/components/attachments-card'
import { DashboardScreen, type DashboardUser } from '@/components/dashboard-screen'
import { EscalationsCard, type EscalationItem, type EscalationTarget } from '@/components/escalations-card'
import { ExportCard, type ExportJob } from '@/components/export-card'
import { TicketsCard, type TicketAssignee, type TicketItem } from '@/components/tickets-card'
import type { AttachmentKind } from '@/domain/attachments'
import { type JobStatus, jobStatusMachine } from 'keel/core/jobs'

interface EscalationLists {
    sent: EscalationItem[]
    received: EscalationItem[]
    targets: EscalationTarget[]
}

export function DashboardGlue({
    user,
    assignees,
    canCreateTicket,
    canUpdateTicket,
    canCreateEscalation,
    canRespondEscalation,
    canCreateAttachment,
    canCreateJob,
    slaHighlight,
}: {
    user: DashboardUser
    assignees: TicketAssignee[]
    canCreateTicket: boolean
    canUpdateTicket: boolean
    canCreateEscalation: boolean
    canRespondEscalation: boolean
    canCreateAttachment: boolean
    canCreateJob: boolean
    slaHighlight: boolean
}) {
    const [tickets, setTickets] = useState<TicketItem[]>([])
    // The cursor for the queue's NEXT page, or null when the reader has reached the end. Held here
    // rather than in TicketsCard so the card stays a plain list — the glue owns fetching, always.
    const [ticketCursor, setTicketCursor] = useState<string | null>(null)
    const [jobs, setJobs] = useState<ExportJob[]>([])
    const [escalations, setEscalations] = useState<EscalationLists>({ sent: [], received: [], targets: [] })
    const [attachments, setAttachments] = useState<AttachmentItem[]>([])

    /**
     * Reads one page of the queue. `cursor === null` means the first page and REPLACES the list;
     * a cursor APPENDS, so "load more" grows what the reader is already looking at.
     */
    const loadTickets = useCallback(async (cursor: string | null) => {
        const query = cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`
        const response = await fetch(`/api/tickets${query}`)
        if (!response.ok) return
        const data = (await response.json()) as { tickets: TicketItem[]; nextCursor: string | null }
        setTickets((previous) => (cursor === null ? data.tickets : [...previous, ...data.tickets]))
        setTicketCursor(data.nextCursor)
    }, [])

    /**
     * Back to page one. Every mutation re-anchors the queue rather than patching the loaded pages:
     * a create lands at the head, a delete leaves a hole, and a status edit can move a row — so the
     * only honest thing to show afterwards is what the server says the queue is now.
     */
    const refreshTickets = useCallback(() => loadTickets(null), [loadTickets])

    const refreshJobs = useCallback(async () => {
        const response = await fetch('/api/jobs')
        if (!response.ok) return
        const data = (await response.json()) as { jobs: ExportJob[] }
        setJobs(data.jobs)
    }, [])

    const refreshEscalations = useCallback(async () => {
        const response = await fetch('/api/escalations')
        if (!response.ok) return
        const data = (await response.json()) as EscalationLists
        setEscalations(data)
    }, [])

    const refreshAttachments = useCallback(async () => {
        const response = await fetch('/api/attachments')
        if (!response.ok) return
        const data = (await response.json()) as { attachments: AttachmentItem[] }
        setAttachments(data.attachments)
    }, [])

    /**
     * The three-step browser-direct upload, adapter-agnostic: (1) MINT — ask the server for a presigned
     * target + a pending attachment row; (2) POST the file straight to that target (the fake local
     * endpoint, or S3 in real mode — identical client code, the fields just differ); (3) CONFIRM so the
     * server verifies the object landed and finalizes the row. Throws on any failure so the card shows
     * its error state; refreshes the list on success.
     */
    const uploadAttachment = useCallback(
        async (file: File, kind: AttachmentKind) => {
            const minted = await fetch('/api/attachments', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    filename: file.name,
                    contentType: file.type || 'application/octet-stream',
                    sizeBytes: file.size,
                    kind,
                }),
            })
            if (!minted.ok) throw new Error('mint failed')
            const { attachmentId, upload } = (await minted.json()) as {
                attachmentId: string
                upload: { url: string; fields: Record<string, string> }
            }

            const form = new FormData()
            for (const [name, value] of Object.entries(upload.fields)) form.append(name, value)
            form.append('file', file)
            const uploaded = await fetch(upload.url, { method: 'POST', body: form })
            if (!uploaded.ok) throw new Error('upload failed')

            const confirmed = await fetch(`/api/attachments/${attachmentId}/confirm`, { method: 'POST' })
            if (!confirmed.ok) throw new Error('confirm failed')
            await refreshAttachments()
        },
        [refreshAttachments],
    )

    useEffect(() => {
        // These refreshers set state only once their responses land — the legitimate "sync with an
        // external system" case the rule guards (same as the simulator glue).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void refreshTickets()
        void refreshJobs()
        void refreshEscalations()
        void refreshAttachments()
    }, [refreshTickets, refreshJobs, refreshEscalations, refreshAttachments])

    useEffect(() => {
        // Poll only while a job is still moving — a completed/failed job is terminal (state machine),
        // so once nothing is in flight the timer is torn down and the dashboard goes quiet.
        const active = jobs.some((job) => !jobStatusMachine.isTerminal(job.status as JobStatus))
        if (!active) return
        const id = setInterval(() => void refreshJobs(), 3_000)
        return () => clearInterval(id)
    }, [jobs, refreshJobs])

    return (
        <DashboardScreen
            user={user}
            onAsk={async (question, onDelta) => {
                const response = await fetch('/api/assistant', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ question }),
                })
                if (!response.ok || !response.body) {
                    const data = (await response.json().catch(() => ({}))) as { error?: string }
                    onDelta(data.error ?? '')
                    return { sources: [] }
                }
                // NDJSON: one JSON object per line. The first carries the sources (pass 1 has already
                // finished by the time a byte is written); every line after it is a text delta. Buffer
                // across chunk boundaries — a network read can split a line anywhere.
                const reader = response.body.getReader()
                const decoder = new TextDecoder()
                let buffer = ''
                let sources: string[] = []
                const consume = (line: string) => {
                    if (!line.trim()) return
                    let event: { sources?: string[]; delta?: string; error?: string }
                    try {
                        event = JSON.parse(line) as { sources?: string[]; delta?: string; error?: string }
                    } catch {
                        // A dropped connection can truncate the final line mid-object — skip it
                        // rather than throwing out of the whole ask.
                        return
                    }
                    if (event.sources) sources = event.sources
                    if (event.delta) onDelta(event.delta)
                    if (event.error) onDelta(event.error)
                }
                for (;;) {
                    const { done, value } = await reader.read()
                    if (done) break
                    buffer += decoder.decode(value, { stream: true })
                    const lines = buffer.split('\n')
                    buffer = lines.pop() ?? ''
                    for (const line of lines) consume(line)
                }
                consume(buffer)
                return { sources }
            }}
        >
            {/* Same <main> landmark as the rest of the dashboard (axe: region) */}
            <TicketsCard
                tickets={tickets}
                assignees={assignees}
                canWrite={canCreateTicket && canUpdateTicket}
                slaHighlight={slaHighlight}
                hasMore={ticketCursor !== null}
                onLoadMore={() => loadTickets(ticketCursor)}
                onCreate={async (input) => {
                    const response = await fetch('/api/tickets', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(input),
                    })
                    if (response.ok) await refreshTickets()
                }}
                onUpdate={async (id, changes) => {
                    const response = await fetch(`/api/tickets/${id}`, {
                        method: 'PATCH',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(changes),
                    })
                    // 409 = the ticket moved on under us (invalid transition). Re-fetch either way, so
                    // the row renders where it really is instead of where this browser thought it was.
                    if (response.ok || response.status === 409) await refreshTickets()
                }}
                onDelete={async (id) => {
                    const response = await fetch(`/api/tickets/${id}`, { method: 'DELETE' })
                    if (response.ok || response.status === 404) await refreshTickets()
                }}
            />
            <ExportCard
                jobs={jobs}
                canCreate={canCreateJob}
                onExport={async () => {
                    const response = await fetch('/api/jobs', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ kind: 'export-tickets' }),
                    })
                    if (response.ok) await refreshJobs()
                }}
            />
            <EscalationsCard
                sent={escalations.sent}
                received={escalations.received}
                targets={escalations.targets}
                canCreate={canCreateEscalation}
                canRespond={canRespondEscalation}
                onCreate={async (input) => {
                    const response = await fetch('/api/escalations', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(input),
                    })
                    if (response.ok) await refreshEscalations()
                }}
                onRespond={async (id, decision) => {
                    const response = await fetch(`/api/escalations/${id}/respond`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ decision }),
                    })
                    // 409 = someone else decided/withdrew it first (invalid-transition). The world
                    // moved, so re-fetch: the row then renders its real settled status instead of a
                    // stale 'open' with live buttons that silently 409 on every further click.
                    if (response.ok || response.status === 409) await refreshEscalations()
                }}
                onCancel={async (id) => {
                    const response = await fetch(`/api/escalations/${id}/cancel`, { method: 'POST' })
                    if (response.ok || response.status === 409) await refreshEscalations()
                }}
            />
            <AttachmentsCard
                attachments={attachments}
                canCreate={canCreateAttachment}
                onUpload={uploadAttachment}
                // Analyze submits a Job like the export does, so it rides the same ability gate —
                // the card hides the control when the handler is absent.
                onAnalyze={
                    canCreateJob
                        ? async (attachmentId) => {
                              // The second job kind, kicked off from the row it is about: same POST
                              // /api/jobs the export uses, a different kind and a payload naming the
                              // bundle.
                              const response = await fetch('/api/jobs', {
                                  method: 'POST',
                                  headers: { 'content-type': 'application/json' },
                                  body: JSON.stringify({ kind: 'analyze-bundle', payload: { attachmentId } }),
                              })
                              if (response.ok) await refreshJobs()
                          }
                        : undefined
                }
            />
        </DashboardScreen>
    )
}
