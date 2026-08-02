import type { ActorId } from '@app-config/actors'
import { useTranslations } from 'next-intl'
import { useCallback, useRef } from 'react'
import {
    type ActorLog,
    type ServiceDriver,
    type ServiceMemory,
    serviceTick,
    type ServiceJobLike,
} from './actor-runtime'
import { ActorShell } from './actor-shell'
import { EventsApp } from './events-app'
import { MailApp } from './mail-app'
import { SnapshotsApp } from './snapshots-app'

const darkPanelFrame = {
    background: '#1a1b1e',
    color: '#f8f9fa',
    padding: 16,
    maxWidth: 380,
} as const

export const Mail = () => (
    <div style={darkPanelFrame}>
        <MailApp
            emails={[
                {
                    id: '1',
                    to: 'newcomer@example.test',
                    subject: "You're invited to Harbor Works",
                    html: '<p>Preview body</p><p><a href="/">Open Harbor Works</a></p>',
                    at: '2026-07-18T00:00:00.000Z',
                },
            ]}
            scope="all"
            onScopeChange={() => {}}
            personEmail="newcomer@example.test"
            mailSeenAt={null}
            allCount={1}
            onOpenLink={() => {}}
            onSeen={() => {}}
            onClear={() => {}}
            onCopyLink={() => {}}
        />
    </div>
)

export const Events = () => (
    <div style={darkPanelFrame}>
        <EventsApp
            events={[
                {
                    id: '1',
                    at: '2026-07-18T14:32:00.000Z',
                    event: 'page_view',
                    properties: { path: 'dashboard', tenant: 'harbor' },
                },
                {
                    id: '2',
                    at: '2026-07-18T14:30:00.000Z',
                    event: 'assistant_asked',
                    properties: { tenant: 'harbor' },
                },
                {
                    id: '3',
                    at: '2026-07-18T14:28:00.000Z',
                    event: 'app_ready',
                },
            ]}
            audit={[
                // The FIXTURE's vocabulary (packages/keel/test-fixture), never an app's: one app verb
                // on the app's own subject, one framework verb on a framework subject, which is the
                // pair the audit section renders differently.
                {
                    id: 'a1',
                    at: '2026-07-18T14:33:00.000Z',
                    action: 'docket.created',
                    subjectType: 'Docket',
                    subjectId: 'docket-1',
                    actorUserId: 'fixture-lead',
                    tenantSlug: 'harbor',
                    orgSlug: 'depot',
                },
                {
                    id: 'a2',
                    at: '2026-07-18T14:31:00.000Z',
                    action: 'membership.invited',
                    subjectType: 'Membership',
                    subjectId: 'fixture-newcomer',
                    actorUserId: 'fixture-lead',
                    tenantSlug: 'harbor',
                    orgSlug: 'annex',
                },
            ]}
        />
    </div>
)

export const Snapshots = () => (
    <div style={darkPanelFrame}>
        <SnapshotsApp
            snapshots={[{ name: 'with-bob', at: '2026-07-18T00:00:00.000Z' }]}
            onReset={() => {}}
            onSave={() => {}}
            onRestore={() => {}}
            onDelete={() => {}}
            flags={[{ flag: 'demo-banner', enabled: false }]}
            onToggleFlag={() => {}}
        />
    </div>
)

/**
 * A scripted ServiceDriver (mirrors actor-runtime.test's scripted drivers, minus the assertions) so
 * the workshop shows a genuinely ticking actor: one seed job goes queued → running → completed, then
 * the driver reports idle forever after — no real network, no server, just to see the process UI.
 */
function useScriptedServiceTick(): (log: ActorLog) => Promise<void> {
    const t = useTranslations('simulator')
    const jobsRef = useRef<ServiceJobLike[]>([
        { id: 'job-1', kind: 'export-dockets', status: 'queued', createdAt: '2026-07-18T00:00:00.000Z' },
    ])
    const memoryRef = useRef<ServiceMemory>({ claimed: new Set() })
    const driverRef = useRef<ServiceDriver>({
        async listJobs() {
            return jobsRef.current
        },
        async claim(jobId) {
            jobsRef.current = jobsRef.current.map((job) => (job.id === jobId ? { ...job, status: 'running' } : job))
            return 'applied'
        },
        async complete(jobId) {
            jobsRef.current = jobsRef.current.map((job) => (job.id === jobId ? { ...job, status: 'completed' } : job))
            return 'applied'
        },
    })
    return useCallback((log) => serviceTick(driverRef.current, memoryRef.current, log, t), [t])
}

/**
 * `ActorShell`'s `actor` prop is typed to the SEAM's `ActorId` union — whatever the HOST app
 * registers — so no literal a framework story could write is valid under every seam (an app that
 * registers no actors makes the union `never`, which is the starter's and the fixture's case). The
 * value is rendered as a label and a `data-actor` attribute and is never looked up, so a neutral
 * placeholder plus one cast is the honest way for the workshop to show the process UI without
 * claiming to be some particular app's counterparty.
 *
 * `as unknown as` and not a bare `as`: a single assertion only compiles while the seam's union
 * happens to be `never` (everything is assignable to `never`'s… nothing, so TS lets the widening
 * through). Under a seam that DOES register actors, `'sample-actor' as ActorId` stops compiling and
 * the story breaks for a reason that has nothing to do with the story. The double assertion says
 * what is actually meant — this value is outside the type on purpose — and holds under every seam.
 */
const PLACEHOLDER_ACTOR = 'sample-actor' as unknown as ActorId

export const Actors = () => {
    const tick = useScriptedServiceTick()
    return (
        <div style={darkPanelFrame}>
            <ActorShell actor={PLACEHOLDER_ACTOR} tick={tick} startPaused={false} inline intervalMs={1500} />
        </div>
    )
}
