import { digestBodies } from '@app-config/digest'
import { people } from '@app-config/seed'
import { getTranslations } from 'next-intl/server'
import { orgForId } from '../db/org-lookup'
import { sendTemplate } from '../email/send'
import { DigestEmail } from '../email/templates/digest-email'
import { routing } from '../i18n/routing'
import type { DbPort } from '../ports/db'
import type { JobHandler } from '../ports/jobs'

/** How many recent rows the digest lists, and the snippet length used as each row's "title". */
const RECENT_LIMIT = 5
const SNIPPET_LENGTH = 60

/** What the seam is handed to find one team's digestible rows. */
export interface DigestScope {
    db: DbPort
    tenantId: string
    orgId: string
}

/**
 * The seam contract for "what this app's digest summarizes" (`@app-config/digest`). WHICH rows a
 * digest is about is app vocabulary — the framework only knows there is a scheduled email and how to
 * count and snip. Returns the bodies NEWEST FIRST; the app is responsible for scoping the read
 * (`db.withTenant`) exactly as its own routes do. An app with nothing to digest returns `[]` and
 * still gets a valid empty-state digest.
 *
 * This mirrors, one for one, the static twin's `DemoWorldOptions.digestBodies` (keel/demo-static/
 * contracts.ts) — which had the seam from the day the world moved into the package, while the server
 * handler went on reading one app’s product table directly.
 */
export type DigestBodySource = (scope: DigestScope) => Promise<string[]>

function snippet(body: string): string {
    const oneLine = body.replace(/\s+/g, ' ').trim()
    return oneLine.length > SNIPPET_LENGTH ? `${oneLine.slice(0, SNIPPET_LENGTH - 1)}…` : oneLine
}

/**
 * Resolves who a team's digest is addressed to and in which locale, from the static seed people:
 * the team's admin if there is one, else its first member. A team with no seeded person (e.g. a
 * dynamically-created org) falls back to a synthetic per-org address in the app's default locale —
 * still visible under Simulator Mail's "all" scope, so the demo never shows an empty digest.
 */
function digestRecipient(orgSlug: string): { to: string; locale: 'en' | 'es' } {
    const members = people.filter((p) => p.memberships.some((m) => m.orgSlug === orgSlug))
    const admin = members.find((p) => p.memberships.some((m) => m.orgSlug === orgSlug && m.role === 'admin'))
    const chosen = admin ?? members[0]
    return chosen
        ? { to: chosen.email, locale: chosen.locale }
        : { to: `${orgSlug}@digest.example`, locale: routing.defaultLocale }
}

/**
 * digest-email handler: composes a simple org digest — a row count + recent row titles for
 * the schedule's team — and sends it via the email port with the DigestEmail react-email template.
 * The ROWS come from the seam (`@app-config/digest`), so the framework's scheduled-work example
 * carries no app table name; a team with nothing to report still gets a valid (empty-state) digest.
 *
 * A scheduled email has no request/user locale at fire time (unlike the invite, sent by an acting
 * user), so the recipient's own seed locale drives the copy — falling back to the app default. Sends
 * nothing to storage: the effect IS the email, so it returns no resultKey.
 */
export const digestEmailHandler: JobHandler = async (_payload, ctx) => {
    const { db, email, tenantId, orgId } = ctx
    if (orgId === null) return {} // schedules are org-scoped (org_id NOT NULL), so this is unreachable; guard anyway

    const org = await orgForId(db, orgId)
    const orgName = org?.name ?? orgId
    const { to, locale } = digestRecipient(org?.slug ?? '')

    // The app supplies its own rows, newest first; counting and snipping stay here, so every app's
    // digest reads identically and the twin's numbers match the server's by construction.
    const bodies = await digestBodies({ db, tenantId, orgId })
    const count = bodies.length
    const recent = bodies.slice(0, RECENT_LIMIT).map(snippet)

    const t = await getTranslations({ locale, namespace: 'email' })
    await sendTemplate(email, {
        to,
        subject: t('digestSubject', { org: orgName }),
        template: DigestEmail({
            labels: {
                preview: t('digestPreview', { org: orgName }),
                heading: t('digestHeading', { org: orgName }),
                intro: t('digestIntro', { org: orgName }),
                countLine: t('digestCount', { count }),
                recentHeading: t('digestRecentHeading'),
                emptyLine: t('digestEmpty'),
                footer: t('digestFooter'),
            },
            recentTitles: recent,
        }),
    })
    return {}
}
