import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './support/people'

/**
 * The user-visible face of the jobs slice: "Export tickets" is a real job with a status timeline
 * (queued → running → completed) that produces a downloadable CSV artifact. In the unheld (default)
 * world the fake adapter runs the job to completion in-process during the POST, so by the time the
 * card refetches the job is already completed — no reliance on the 3s dashboard poll.
 */

// Hydration-safe ticket entry (mirrors tenancy.spec.ts): filling the controlled input right after a
// navigation can beat React hydration, leaving the add button disabled — retry fill-until-enabled.
async function addTicket(page: Page, text: string) {
    await expect(async () => {
        await page.getByTestId('ticket-input').fill(text)
        await expect(page.getByTestId('ticket-add')).toBeEnabled({ timeout: 1_000 })
    }).toPass()
    await page.getByTestId('ticket-add').click()
    await expect(page.getByTestId('tickets-list')).toContainText(text)
}

test('export tickets: a job runs to completion and serves a CSV carrying the ticket', async ({ page }) => {
    const ticketSubject = `export-ticket-${Date.now()}`
    await signInAs(page, 'person-admin')

    // A ticket to export — the CSV must carry it back.
    await expect(page.getByTestId('tickets-card')).toBeVisible()
    await addTicket(page, ticketSubject)

    // Kick off the export. Newest job is prepended, so wait for the row count to grow by exactly one
    // rather than racing a stale pre-refetch render — then .first() is unambiguously our new job.
    await expect(page.getByTestId('export-card')).toBeVisible()
    const rows = page.getByTestId('export-job')
    const before = await rows.count()
    await page.getByTestId('export-run').click()
    await expect(rows).toHaveCount(before + 1)

    const job = rows.first()
    // Unheld world: the fake adapter completed it during the POST — the full three-hop timeline.
    await expect(job.getByTestId('job-timeline-entry-completed')).toBeVisible()
    await expect(job.getByTestId('job-timeline-entry-queued')).toBeVisible()
    await expect(job.getByTestId('job-timeline-entry-running')).toBeVisible()

    // A completed job offers its artifact; fetch it and prove it's the CSV with our ticket inside.
    const download = job.getByTestId('job-download')
    await expect(download).toBeVisible()
    const href = await download.getAttribute('href')
    expect(href).toBeTruthy()
    const response = await page.request.get(href!)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/csv')
    expect(await response.text()).toContain(ticketSubject)
})
