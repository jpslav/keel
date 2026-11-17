import type { Page } from '@playwright/test'

type Stamped = { __previousDocument?: boolean }

/**
 * Fire `trigger` — a click that ends in a full document load (`window.location.assign` / `.reload()`:
 * the Simulator's person switch, the OrgSwitcher, the header nav) — and return only once the page is a
 * NEW document.
 *
 * Why not wait on what the page shows: the OLD document keeps rendering until the new one commits, and
 * on a loaded machine that window is seconds wide. Every "did it land?" check that the old page also
 * satisfies — `waitForURL` on a URL the page is already on, a card that is visible both before and after,
 * a tenant name two people share — passes at once, and the test then drives a page that is being torn
 * down: clicks lost to the unload, or assertions made as the PREVIOUS person. The check has to be one only
 * the new document can satisfy. Stamping the old `window` is that check: the stamp is gone exactly when a
 * fresh document exists, however fast or slow the load was, and whatever URL it landed on.
 *
 * That a URL wait cannot do this, and the stamp idiom, are recorded in docs/build-notes.md ("Specs that
 * wipe `.data` mid-suite need their own Playwright project…"), and destructive/simulator-jobs.spec.ts and
 * simulator-snapshots.spec.ts each hand-roll the same wait. The budget is theirs, 45s: one full load of a
 * dev-mode route, which compiles on demand (docs/build-notes.md, "An e2e wait that the page being left
 * also passes", has the 24s `/en/dashboard` measurement). It is a bound, not a guess — without it a lost
 * trigger stalls to the test timeout and the report blames whatever step happened to be running.
 *
 * Only for a trigger that WILL load a document. One that may be a no-op (picking the org that is already
 * active) would wait out the full budget — assert on the state you expect instead.
 */
export async function untilNewDocument(page: Page, trigger: () => Promise<unknown>): Promise<void> {
    await page.evaluate(() => {
        ;(window as unknown as Stamped).__previousDocument = true
    })
    await trigger()
    await page.waitForFunction(() => !(window as unknown as Stamped).__previousDocument, undefined, {
        timeout: 45_000,
    })
}
