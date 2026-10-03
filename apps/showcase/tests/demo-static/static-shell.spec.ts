import path from 'node:path'
import { expect, test } from '@playwright/test'
import { welcome } from '../catalog'

const indexUrl = `file://${path.resolve(__dirname, '../../dist-demo/index.html')}`

test('static shell walkthrough from file://', async ({ page }) => {
    await page.goto(indexUrl)
    // Asserted against the catalog, not the product name — renaming the app must not break the gate.
    await expect(page.getByRole('heading', { level: 1 })).toContainText(welcome('en').title)
    await expect(page.getByTestId('demo-badge')).toBeVisible()

    // welcome → dashboard link forces the sign-in screen
    await page.getByTestId('dashboard-link').click()
    await page.getByTestId('person-person-admin').click()
    await expect(page.getByTestId('signed-in-as')).toContainText('Dana Okoye')

    // deterministic assistant straight from the committed fixture — the composing pass always
    // replays its purpose's default entry, so the words are the same on every run
    await page.getByTestId('assistant-card').getByRole('textbox').fill('hello')
    await page.getByTestId('ask-button').click()
    await expect(page.getByTestId('assistant-answer')).toContainText('queue')

    // invite → Simulator Mail tab (all-mail scope), reached by CLICKING the panel (not a hash
    // goto): this is the exact walk that was impossible in the single-page build before Simulator.
    await page.getByTestId('nav-org').click()
    await page.getByTestId('invite-email').fill('static-demo@example.test')
    await page.getByTestId('invite-submit').click()
    await expect(page.getByTestId('invite-sent')).toBeVisible()
    await page.getByTestId('simulator-pill').click()
    await page.getByTestId('simulator-tab-mail').click()
    await page.getByTestId('mail-scope-all').click()
    await expect(page.getByTestId('mail-list')).toContainText('static-demo@example.test')
    // Open the INVITE email specifically (the one addressed to the invitee) — inviting also emails
    // the team's other admins an org.invited notification, so the newest item is not guaranteed to be
    // the invite. The invite is the one carrying the accept link.
    await page
        .getByTestId('mail-list')
        .locator('[data-testid^="mail-item-"]')
        .filter({ hasText: 'static-demo@example.test' })
        .first()
        .click()
    await expect(page.getByTestId('mail-link').first()).toBeVisible()

    // locale switch flips the ui to spanish — the switcher now lives in the Simulator header (the
    // panel is already open from the mail flow above); SegmentedControl hides the radio, so click
    // the 'es' label inside it
    await page.getByTestId('nav-dashboard').click()
    await page.getByTestId('simulator-locale').getByText('es', { exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mesa')
})

test('simulator panel switches people and restores the last hash route (static demo twin)', async ({ page }) => {
    await page.goto(indexUrl)
    await page.getByTestId('dashboard-link').click()
    await page.getByTestId('person-person-admin').click()
    await expect(page.getByTestId('signed-in-as')).toContainText('Dana Okoye')

    await expect(page.getByTestId('simulator-pill')).toBeVisible()
    await page.getByTestId('simulator-pill').click()
    await expect(page.getByTestId('simulator-panel')).toBeVisible()

    // move Dana somewhere memorable before switching away
    await page.getByTestId('nav-org').click()
    await expect(page.getByTestId('member-table')).toBeVisible()

    await page.getByTestId('people-person-staff').click()
    await expect(page.getByTestId('signed-in-as')).toContainText('Sam Rivera')

    // switching back restores Dana's last route — the in-memory continuity map's whole point
    await page.getByTestId('people-person-admin').click()
    await expect(page.getByTestId('member-table')).toBeVisible()
})

test('static assistant runs its tools live against the in-memory queue and cites them', async ({ page }) => {
    await page.goto(indexUrl)
    await page.getByTestId('dashboard-link').click()
    await page.getByTestId('person-person-admin').click()
    await expect(page.getByTestId('signed-in-as')).toContainText('Dana Okoye')

    // Add a ticket to the in-memory demo world so the tool has a real row to read.
    await page.getByTestId('ticket-input').fill('ship the demo')
    await page.getByTestId('ticket-add').click()
    await expect(page.getByTestId('tickets-list')).toContainText('ship the demo')

    // The twin replays the recorded tool loop and runs list_my_tickets live against those tickets —
    // genuine parity with the server (canned utterance, live tool effect), including the streamed
    // prose and the sources list built from what the tool actually returned.
    await page.getByTestId('assistant-card').getByRole('textbox').fill('What tickets are open?')
    await page.getByTestId('ask-button').click()
    await expect(page.getByTestId('assistant-answer')).toContainText('queue')
    await expect(page.getByTestId('assistant-sources')).toContainText('ship the demo')
})

test('static shell accept-invite: an invited person (Bob) becomes a switchable, active person', async ({ page }) => {
    const inviteEmail = `bob-static-${Date.now()}@example.test`

    await page.goto(indexUrl)
    await page.getByTestId('dashboard-link').click()
    await page.getByTestId('person-person-admin').click()
    await expect(page.getByTestId('signed-in-as')).toContainText('Dana Okoye')

    await page.getByTestId('nav-org').click()
    await page.getByTestId('invite-email').fill(inviteEmail)
    await page.getByTestId('invite-submit').click()
    await expect(page.getByTestId('invite-sent')).toBeVisible()

    // He shows up in the People immediately (in-memory invites twin), no account needed yet.
    await page.getByTestId('simulator-pill').click()
    await expect(page.getByTestId('simulator-panel')).toBeVisible()
    await page.getByTestId('simulator-tab-people').click()
    const invitedRow = page.locator('[data-testid^="people-"]').filter({ hasText: inviteEmail })
    await expect(invitedRow).toBeVisible()

    // Selecting him is a viewpoint switch, not a sign-in: the main pane goes to the picker/welcome
    // state the shell already renders when person is null, the panel keeps following him.
    await invitedRow.click()
    await expect(page.getByTestId('dashboard-link')).toBeVisible()
    await expect(page.getByTestId('simulator-panel')).toBeVisible()

    // His inbox extracts the accept link — clicking it routes to the accept-invite hash screen.
    await page.getByTestId('simulator-tab-mail').click()
    await expect(page.getByTestId('mail-list')).toContainText("You're invited")
    await page.getByTestId('mail-list').locator('[data-testid^="mail-item-"]').first().click()
    await expect(page.getByTestId('mail-body')).toBeVisible()
    const acceptLink = page.getByTestId('mail-link').first()
    await expect(acceptLink).toBeVisible()
    await acceptLink.click()

    // The still-open mail item behind it also mentions "Frontline Desk" (the panel is a persistent
    // sibling of the main pane in this single-page shell, unlike a real full reload) — scope to the
    // heading so the assertion isn't ambiguous between the two.
    await expect(page.getByRole('heading', { name: 'Join Frontline Desk' })).toBeVisible()
    await page.getByTestId('accept-name').fill('Bob Newperson')
    await page.getByTestId('accept-submit').click()

    // Accepting creates the dynamic person in state, signs him in, and lands on the dashboard.
    await expect(page.getByTestId('signed-in-as')).toContainText('Bob Newperson')
})

test('static shell showcases analytics events, feature flag, and error scrubbing', async ({ page }) => {
    await page.goto(indexUrl)
    await page.getByTestId('dashboard-link').click()
    await page.getByTestId('person-person-admin').click()
    await expect(page.getByTestId('signed-in-as')).toBeVisible()

    // ask the assistant so an assistant_asked event joins the page_view events
    await page.getByTestId('assistant-card').getByRole('textbox').fill('hello')
    await page.getByTestId('ask-button').click()
    await expect(page.getByTestId('assistant-answer')).toBeVisible()

    // analytics event log (in-memory in the static shell), via the Simulator panel
    await page.getByTestId('simulator-pill').click()
    await page.getByTestId('simulator-tab-events').click()
    await expect(page.getByTestId('events-list')).toContainText('assistant_asked')
    await expect(page.getByTestId('events-list')).toContainText('page_view')

    // feature flag gates an app-wide banner — the flag switches live with the other world knobs
    // in the Snapshots tab (see docs/decision-log.md)
    await page.getByTestId('simulator-tab-snapshots').click()
    await expect(page.getByTestId('demo-banner-flag')).toHaveCount(0)
    await page.getByTestId('flag-toggle-demo-banner').click()
    await expect(page.getByTestId('demo-banner-flag')).toBeVisible()

    // error scrubbing proof (client-side, runs entirely in the browser)
    await page.getByTestId('simulator-tab-errors').click()
    await page.getByTestId('throw-client-error').click()
    await expect(page.getByTestId('error-raw')).toContainText('SECRET')
    await expect(page.getByTestId('error-scrubbed')).toBeVisible()
    await expect(page.getByTestId('error-scrubbed')).not.toContainText('SECRET')
})

test('simulator panel resets the static shell back to its initial state', async ({ page }) => {
    await page.goto(indexUrl)
    await page.getByTestId('dashboard-link').click()
    await page.getByTestId('person-person-admin').click()
    await expect(page.getByTestId('signed-in-as')).toContainText('Dana Okoye')

    await page.getByTestId('nav-org').click()
    await page.getByTestId('invite-email').fill('reset-demo@example.test')
    await page.getByTestId('invite-submit').click()
    await expect(page.getByTestId('invite-sent')).toBeVisible()

    // The static shell's Snapshots tab is reset-only (no snapshots prop, no server to snapshot against)
    // — the two-step confirm lives in SnapshotsApp itself, shared with the real app.
    await page.getByTestId('simulator-pill').click()
    await page.getByTestId('simulator-tab-snapshots').click()
    await page.getByTestId('snapshots-reset').click()
    await page.getByTestId('snapshots-reset-confirm').click()

    // Reset returns to the welcome route no matter who was signed in — there's no server here, so
    // this is purely the in-memory state tree going back to its initial values.
    await expect(page.getByTestId('dashboard-link')).toBeVisible()
    await page.getByTestId('dashboard-link').click()
    await expect(page.getByTestId('person-person-admin')).toBeVisible()

    // Sign back in: the invite sent before the reset is gone, and the outbox is back to the seed.
    await page.getByTestId('person-person-admin').click()
    await expect(page.getByTestId('signed-in-as')).toContainText('Dana Okoye')
    await page.getByTestId('nav-org').click()
    await expect(page.getByTestId('member-table')).not.toContainText('reset-demo@example.test')

    // Back to the SEED baseline, which is one already-sent message (the twin seeds the same opening
    // outbox the server does) — not an empty one.
    await page.getByTestId('simulator-tab-mail').click()
    await page.getByTestId('mail-scope-all').click()
    await expect(page.getByTestId('mail-list').locator('[data-testid^="mail-item-"]')).toHaveCount(1)
})

test('static shell: composing an inbound email to frontline+support opens a ticket + audit (twin parity)', async ({
    page,
}) => {
    await page.goto(indexUrl)
    await page.getByTestId('dashboard-link').click()
    await page.getByTestId('person-person-admin').click()
    await expect(page.getByTestId('signed-in-as')).toContainText('Dana Okoye')

    // The world emails the app: compose to frontline+support as Dana (a frontline member). The twin runs the
    // SAME pure parser + a ticket-append mirroring intakeInboundEmail (ADR-0006 parity, no server).
    const subject = `twin-inbound-${Date.now()}`
    await page.getByTestId('simulator-pill').click()
    await page.getByTestId('simulator-tab-mail').click()
    await page.getByTestId('inbound-compose-from').selectOption('dana.okoye@example.test')
    await page.getByTestId('inbound-compose-org').selectOption('frontline')
    await page.getByTestId('inbound-compose-handler').fill('support')
    await page.getByTestId('inbound-compose-subject').fill(subject)
    await page.getByTestId('inbound-compose-body').fill('twin body')
    await page.getByTestId('inbound-compose-send').click()

    // The inbound list shows a 'handled' row for it.
    const row = page.getByTestId('inbound-list').locator('[data-testid^="inbound-item-"]').filter({ hasText: subject })
    await expect(row).toContainText('handled')

    // The ticket appears on the dashboard tickets card (Dana's default active org is frontline) — in-memory,
    // the main pane is a persistent sibling of the panel, so a nav is enough (no reload).
    await page.getByTestId('nav-dashboard').click()
    await expect(page.getByTestId('tickets-list')).toContainText(subject)

    // The audit trail records the intake and the ticket creation (the panel stays open as a sibling).
    await page.getByTestId('simulator-tab-events').click()
    await expect(page.getByTestId('audit-list')).toContainText('inbound-email.received')
    await expect(page.getByTestId('audit-list')).toContainText('ticket.created')
})

test('static shell: a restricted member (Riley) gets a read-only TicketsCard (ability parity)', async ({ page }) => {
    await page.goto(indexUrl)
    await page.getByTestId('dashboard-link').click()
    await page.getByTestId('person-person-restricted').click()
    await expect(page.getByTestId('signed-in-as')).toContainText('Riley Chen')

    // Same pure ability the real server runs: read is fine (card renders), create is gone.
    await expect(page.getByTestId('tickets-card')).toBeVisible()
    await expect(page.getByTestId('tickets-readonly-hint')).toBeVisible()
    await expect(page.getByTestId('ticket-input')).toBeDisabled()
    await expect(page.getByTestId('ticket-add')).toBeDisabled()
})

test('static shell exports tickets as an instant job (no download) and mirrors the jobs-held knob', async ({
    page,
}) => {
    await page.goto(indexUrl)
    await page.getByTestId('dashboard-link').click()
    await page.getByTestId('person-person-admin').click()
    await expect(page.getByTestId('signed-in-as')).toContainText('Dana Okoye')

    // Unheld world: export completes instantly with the full queued → running → completed story —
    // but NO download link (the static shell has no server to serve CSV bytes, a deliberate degrade).
    await page.getByTestId('export-run').click()
    const job = page.getByTestId('export-job').first()
    await expect(job.getByTestId('job-timeline-entry-queued')).toBeVisible()
    await expect(job.getByTestId('job-timeline-entry-running')).toBeVisible()
    await expect(job.getByTestId('job-timeline-entry-completed')).toBeVisible()
    await expect(job.getByTestId('job-download')).toHaveCount(0)

    // The same job appears in the Simulator Jobs tab (the cross-tenant world view).
    await page.getByTestId('simulator-pill').click()
    await expect(page.getByTestId('simulator-panel')).toBeVisible()
    await page.getByTestId('simulator-tab-jobs').click()
    await expect(page.getByTestId('simulator-jobs-list')).toBeVisible()
    await expect(page.locator('[data-testid^="simulator-job-"]:not([data-testid*="toggle"])').first()).toBeVisible()

    // Parity check: flip the jobs-held knob (in-memory in the static shell — a persistent sibling, no
    // reload), export again → the new job stays queued, and "Run pending" steps it to completed.
    await page.getByTestId('simulator-tab-snapshots').click()
    await page.getByTestId('flag-toggle-jobs-held').click()

    // The dashboard export card is still mounted in the main pane behind the panel — export again.
    await page.getByTestId('export-run').click()
    const heldJob = page.getByTestId('export-job').first()
    await expect(heldJob.getByTestId('job-timeline-entry-queued')).toBeVisible()
    await expect(heldJob.getByTestId('job-timeline-entry-completed')).toHaveCount(0)

    // Jobs tab now flags the held world; "Run pending" advances the queued job to completed.
    await page.getByTestId('simulator-tab-jobs').click()
    await expect(page.getByTestId('simulator-jobs-held')).toBeVisible()
    await page.getByTestId('simulator-jobs-run').click()
    await expect(heldJob.getByTestId('job-timeline-entry-completed')).toBeVisible()
})

test('static shell: a file uploads into the in-memory attachments list (no download degrade)', async ({ page }) => {
    await page.goto(indexUrl)
    await page.getByTestId('dashboard-link').click()
    await page.getByTestId('person-person-admin').click()
    await expect(page.getByTestId('signed-in-as')).toContainText('Dana Okoye')

    // The browser File API works from file://, so the twin reads name/size/type in-memory and lists
    // the attachment — genuine capability parity. DEGRADE: no server/filesystem, so the bytes aren't
    // stored and there's NO download link (physics, exactly like the jobs CSV degrade).
    await expect(page.getByTestId('attachments-card')).toBeVisible()
    const filename = `static-upload-${Date.now()}.txt`
    await page.getByTestId('attachment-drop').setInputFiles({
        name: filename,
        mimeType: 'text/plain',
        buffer: Buffer.from('static bytes', 'utf8'),
    })

    const list = page.getByTestId('attachments-list')
    await expect(list).toContainText(filename)
    await expect(list.locator('[data-testid^="attachment-download-"]')).toHaveCount(0)
})

test('static shell: the inline analyzer actor steps a held export to completed (no download degrade)', async ({
    page,
}) => {
    await page.goto(indexUrl)
    await page.getByTestId('dashboard-link').click()
    await page.getByTestId('person-person-admin').click()
    await expect(page.getByTestId('signed-in-as')).toContainText('Dana Okoye')

    // Hold the world (Snapshots flag) so the export parks queued for the actor to pick up — the static
    // twin runs the SAME serviceTick as the real app, just over in-memory state (ADR-0006 parity).
    await page.getByTestId('simulator-pill').click()
    await page.getByTestId('simulator-tab-snapshots').click()
    await page.getByTestId('flag-toggle-jobs-held').click()
    // The actors run from page load (the static twin too); hold them so the analyzer can't claim the
    // export before this test steps it. A manual Step ignores the hold.
    await page.getByTestId('flag-toggle-actors-held').click()

    // Dana's default active org is frontline (the bundle-analyzer's pool). Export from the dashboard card,
    // still mounted in the main pane behind the persistent panel sibling.
    await page.getByTestId('export-run').click()
    const job = page.getByTestId('export-job').first()
    await expect(job.getByTestId('job-timeline-entry-queued')).toBeVisible()
    await expect(job.getByTestId('job-timeline-entry-completed')).toHaveCount(0)

    // The Actors tab hosts the bundle-analyzer as an INLINE ActorShell (no iframe in the static twin).
    await page.getByTestId('simulator-tab-actors').click()
    const analyzerCard = page.getByTestId('actor-card-bundle-analyzer')
    await expect(analyzerCard.getByTestId('actor-shell')).toBeVisible()

    // Pause the loop (Step only works while paused), then hand-step it: claim (queued → running),
    // complete (running → completed). The world hold above is what keeps it deterministic.
    await analyzerCard.getByTestId('actor-toggle').click()
    await expect(analyzerCard.getByTestId('actor-status')).toHaveAttribute('data-state', 'paused')
    const step = analyzerCard.getByTestId('actor-step')
    await step.click()
    await expect(step).toBeEnabled()
    await step.click()
    await expect(step).toBeEnabled()

    // The job is now completed, and the process log recorded the work.
    await expect(job.getByTestId('job-timeline-entry-completed')).toBeVisible()
    await expect(analyzerCard.locator('[data-testid="actor-log-entry"]').first()).toBeVisible()

    // The cross-tenant Jobs tab agrees the job completed ...
    await page.getByTestId('simulator-tab-jobs').click()
    await expect(page.locator('[data-testid^="simulator-job-"]:not([data-testid*="toggle"])').first()).toContainText(
        'completed',
    )

    // ... but the degrade holds: no server to serve CSV bytes, so the completed job offers NO download.
    await expect(job.getByTestId('job-download')).toHaveCount(0)
})

/**
 * The paged queue's `file://` twin (keel/core/keyset). The twin is not a "load more" that just slices:
 * it mints and re-parses a REAL opaque cursor on every hop through the same pure primitive the server
 * uses, so this walk exercises the cursor grammar with no server anywhere in the picture.
 *
 * Deterministic, unlike the server spec: the static world is freshly seeded on every page load, so the
 * exact page counts can be asserted.
 */
test('the ticket queue pages through its cursor chain from file://', async ({ page }) => {
    await page.goto(indexUrl)
    await page.getByTestId('dashboard-link').click()
    await page.getByTestId('person-person-admin').click()
    await expect(page.getByTestId('tickets-card')).toBeVisible()

    // Page one: the five live tickets, newest first, with the archive still behind the button.
    await expect(page.getByTestId('ticket-item')).toHaveCount(5)
    await expect(page.getByTestId('tickets-list')).toContainText('NW-1041')
    await expect(page.getByTestId('tickets-list')).not.toContainText('NW-1003')
    await expect(page.getByTestId('tickets-load-more')).toBeVisible()

    await page.getByTestId('tickets-load-more').click()
    await expect(page.getByTestId('ticket-item')).toHaveCount(10)
    await expect(page.getByTestId('tickets-load-more')).toBeVisible()

    // The last page is a PARTIAL one (eleven tickets, five to a page), which is where an off-by-one
    // shows up: the button must go away exactly when the queue runs out, not a page early or late.
    await page.getByTestId('tickets-load-more').click()
    await expect(page.getByTestId('ticket-item')).toHaveCount(11)
    await expect(page.getByTestId('tickets-load-more')).toHaveCount(0)
    await expect(page.getByTestId('tickets-list')).toContainText('NW-1003')

    // Every ticket exactly once — the property the cursor exists to guarantee.
    const refs = await page
        .getByTestId('ticket-item')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-ref') ?? ''))
    expect(new Set(refs).size).toBe(refs.length)
})
