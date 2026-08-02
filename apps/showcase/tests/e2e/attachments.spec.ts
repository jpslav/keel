import { expect, test } from '@playwright/test'
import { signInAs } from './support/people'

/**
 * Browser uploads: the real three-step flow through the UI. Dana (a non-restricted member)
 * drops a file on the attachments card → it's minted, uploaded to the fake presigned-POST endpoint,
 * confirmed, listed, and its download link serves the exact bytes back. Riley (restricted) gets a
 * read-only card AND is denied upload-mint at the server even if she bypasses the missing drop region.
 * Non-destructive: each run uploads a uniquely-named file and never resets the world.
 */
test('a member uploads a file through the dropzone, sees it listed, and downloads the bytes', async ({ page }) => {
    await signInAs(page, 'person-admin')

    await expect(page.getByTestId('attachments-card')).toBeVisible()

    const stamp = Date.now()
    const filename = `upload-${stamp}.txt`
    const contents = `attachment-bytes-${stamp}`
    await page.getByTestId('attachment-drop').setInputFiles({
        name: filename,
        mimeType: 'text/plain',
        buffer: Buffer.from(contents, 'utf8'),
    })

    // The confirmed attachment appears in the list (the glue refreshes after confirm).
    const list = page.getByTestId('attachments-list')
    await expect(list).toContainText(filename)

    // Its download link serves the very bytes we uploaded (fake storage round-trip).
    const download = list.locator('[data-testid^="attachment-download-"]').first()
    await expect(download).toBeVisible()
    const href = await download.getAttribute('href')
    expect(href).toBeTruthy()
    const response = await page.request.get(href!)
    expect(response.status()).toBe(200)
    expect(await response.text()).toContain(contents)
})

test('a restricted member gets a read-only attachments card and is denied upload-mint at the server', async ({
    page,
}) => {
    await signInAs(page, 'person-restricted')

    // Read access remains (card renders); the drop region is gone and the hint shows.
    await expect(page.getByTestId('attachments-card')).toBeVisible()
    await expect(page.getByTestId('attachments-readonly-hint')).toBeVisible()
    await expect(page.getByTestId('attachment-drop')).toHaveCount(0)

    // Bypass the missing UI: a raw mint POST (carrying Riley's session) must still be forbidden.
    const forced = await page.request.post('/api/attachments', {
        data: { filename: 'forced.txt', contentType: 'text/plain' },
    })
    expect(forced.status()).toBe(403)
})
