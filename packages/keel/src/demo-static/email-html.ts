/**
 * Hand-built twins of the react-email templates in ../email/templates. Rendering the REAL templates
 * in-browser was tried and reverted: @react-email/render (react-dom/server) added ~560 kB to the
 * single-file demo, blowing its size budget (see docs/decision-log.md). The STRINGS still come from
 * the same `email` messages namespace, so the copy can't drift even though the markup can — which is
 * why every builder here takes its labels pre-resolved rather than reaching for a translator.
 */

/** react-email escapes interpolations for the real template; the hand-built twin must too — the
 *  inviter's display name is user-editable and lands in the email body. */
function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Twin of ../email/templates/invite-email.tsx. */
export function buildInviteEmailHtml(
    labels: { heading: string; body: string; button: string; linkFallback: string },
    acceptUrl: string,
): string {
    const safeUrl = escapeHtml(acceptUrl)
    return (
        `<body style="background-color:#f4f4f5;font-family:sans-serif">` +
        `<div style="background-color:#ffffff;border-radius:8px;margin:40px auto;padding:24px;max-width:480px">` +
        `<h2>${escapeHtml(labels.heading)}</h2><p>${escapeHtml(labels.body)}</p>` +
        `<p style="text-align:center;margin:24px 0"><a href="${safeUrl}" ` +
        `style="background-color:#4c6ef5;color:#ffffff;border-radius:6px;padding:12px 24px;` +
        `text-decoration:none;display:inline-block">${escapeHtml(labels.button)}</a></p>` +
        `<p style="font-size:12px;color:#666666">${escapeHtml(labels.linkFallback)} ${safeUrl}</p>` +
        `</div></body>`
    )
}

/** Twin of ../email/templates/digest-email.tsx. */
export function buildDigestEmailHtml(
    labels: {
        heading: string
        intro: string
        countLine: string
        recentHeading: string
        emptyLine: string
        footer: string
    },
    recentTitles: string[],
): string {
    const list =
        recentTitles.length > 0
            ? `<p style="font-weight:600;margin-bottom:4px">${escapeHtml(labels.recentHeading)}</p>` +
              recentTitles.map((title) => `<p style="margin:2px 0;color:#333333">• ${escapeHtml(title)}</p>`).join('')
            : `<p style="color:#666666">${escapeHtml(labels.emptyLine)}</p>`
    return (
        `<body style="background-color:#f4f4f5;font-family:sans-serif">` +
        `<div style="background-color:#ffffff;border-radius:8px;margin:40px auto;padding:24px;max-width:480px">` +
        `<h2>${escapeHtml(labels.heading)}</h2><p>${escapeHtml(labels.intro)}</p>` +
        `<p style="font-weight:600">${escapeHtml(labels.countLine)}</p>${list}` +
        `<p style="font-size:12px;color:#666666;margin-top:16px">${escapeHtml(labels.footer)}</p>` +
        `</div></body>`
    )
}
