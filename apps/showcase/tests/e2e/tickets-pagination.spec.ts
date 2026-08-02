import { expect, type Page, test } from '@playwright/test'
import { TICKET_PAGE_SIZE } from '../../src/domain/tickets'
import { pickOrg } from './support/org-switcher'
import { signInAs } from './support/people'

/**
 * The paged queue (keel/db/keyset), end to end through the real stack: UI → GET /api/tickets → the
 * keyset pager → RLS on pglite.
 *
 * The assertions are deliberately about PROPERTIES rather than exact contents, because this spec runs
 * in the shared, fully-parallel world where other specs are opening tickets in the same team. The two
 * properties that matter are the ones a hand-rolled pager gets wrong: a walk to the end reaches the
 * OLDEST row, and it shows every row exactly ONCE.
 *
 * `NW-1003` is the oldest seeded ticket in the frontline archive; more tickets arriving only ever push
 * it further down, never onto page one, which is why it is a stable target for "the walk got there".
 */
const OLDEST_SEEDED_REF = 'NW-1003'

/** Every ticket reference currently rendered, in the order the card shows them. */
async function renderedRefs(page: Page): Promise<string[]> {
    const refs = await page
        .getByTestId('ticket-item')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-ref') ?? ''))
    return refs
}

test('the queue opens on one page and walks to the end without repeating or dropping a ticket', async ({ page }) => {
    await signInAs(page, 'person-admin')
    await pickOrg(page, 'frontline')
    await expect(page.getByTestId('tickets-card')).toBeVisible()

    // Page one is exactly the page size — the queue is longer than that, so this is a real page.
    await expect(page.getByTestId('ticket-item')).toHaveCount(TICKET_PAGE_SIZE)
    await expect(page.getByTestId('tickets-load-more')).toBeVisible()
    await expect(page.getByTestId('tickets-list')).not.toContainText(OLDEST_SEEDED_REF)

    // Walk to the end the way a reader does. Each click must ADD rows (a page that grows by nothing
    // is the "stuck cursor" bug) and the button must eventually go away (the "cursor never ends" bug).
    let previous = await renderedRefs(page)
    for (let click = 0; click < 20; click++) {
        if (!(await page.getByTestId('tickets-load-more').isVisible())) break
        await page.getByTestId('tickets-load-more').click()
        await expect(page.getByTestId('ticket-item')).not.toHaveCount(previous.length)
        const current = await renderedRefs(page)
        expect(current.length).toBeGreaterThan(previous.length)
        // Everything already on screen stays on screen, in the same order: "load more" APPENDS.
        expect(current.slice(0, previous.length)).toEqual(previous)
        previous = current
    }

    await expect(page.getByTestId('tickets-load-more')).toHaveCount(0)
    // The walk reached the bottom of the queue...
    expect(previous).toContain(OLDEST_SEEDED_REF)
    // ...and showed every ticket exactly once. This is the assertion an offset pager fails the moment
    // anyone opens a ticket while the reader is paging.
    expect(new Set(previous).size).toBe(previous.length)
})

test('the queue endpoint refuses a cursor it cannot read, and caps the page size itself', async ({ page }) => {
    await signInAs(page, 'person-admin')
    await pickOrg(page, 'frontline')
    await expect(page.getByTestId('tickets-card')).toBeVisible()

    // A malformed cursor is a 400, not a silent first page: the server will not guess what the client
    // meant. (That it also could not have widened anything is proved in the RLS suites.)
    // The third is a well-formed envelope carrying SQL in its id half, forged the way an attacker would
    // (encodeKeysetCursor validates, and rightly refuses to mint it). Built rather than pasted: a base64
    // literal hides what is being tested and reads to a secret scanner as a committed credential.
    const sqlInjectionCursor = btoa("2026-01-01T00:00:00Z|' OR 1=1 --")
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    for (const cursor of ['not-a-cursor', '../../etc/passwd', sqlInjectionCursor]) {
        const response = await page.request.get(`/api/tickets?cursor=${encodeURIComponent(cursor)}`)
        expect(response.status()).toBe(400)
        expect(await response.json()).toEqual({ error: 'invalid-cursor' })
    }

    // The query string may ASK for a page size; the server decides. KEYSET_MAX_LIMIT is 100.
    const greedy = await page.request.get('/api/tickets?limit=1000000')
    expect(greedy.status()).toBe(200)
    const { tickets } = (await greedy.json()) as { tickets: unknown[] }
    expect(tickets.length).toBeLessThanOrEqual(100)
})
