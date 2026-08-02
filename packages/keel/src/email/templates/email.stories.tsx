import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { render } from '@react-email/render'
import { DigestEmail } from './digest-email'
import { InviteEmail } from './invite-email'
import { NotificationEmail } from './notification-email'

/**
 * The react-email templates preview straight in the workshop — no separate preview server (ADR-0005).
 * Every template the framework ships has a story here, so "the workshop is the whole component
 * surface" stays a checkable claim rather than a habit.
 *
 * Copy arrives pre-localized from the caller in production (templates render outside a request
 * context and never call next-intl themselves), so a story passes the same shape by hand. The
 * vocabulary is keel's own fixture world, never a host app's.
 */

/**
 * Each template renders `<Html>` — a react-email component that emits a full `<head>`+`<body>`
 * document, because that IS an email's document. Ladle mounts every story inside a `<div>` in the
 * PAGE's own `<html>`, and a second `<html>` nested inside one is illegal: React logs "cannot be a
 * child of" and a hydration error, on all three email stories, while `ladle build` still exits 0 —
 * that exit code was never checking this.
 *
 * An iframe's `srcDoc` is a separate document, so the nesting is legal there. `render()` is the same
 * function `email/send.ts` hands to the mail port, so the preview is the exact markup a recipient
 * gets — not a second, drifting way to turn the template into HTML.
 */
function EmailPreview({ template }: { template: ReactElement }) {
    const [html, setHtml] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        render(template).then((markup) => {
            if (!cancelled) setHtml(markup)
        })
        return () => {
            cancelled = true
        }
    }, [template])

    if (html === null) return null
    return <iframe title="Email preview" srcDoc={html} style={{ width: '100%', height: '80vh', border: 'none' }} />
}

/** The invitation email — the one transactional send the framework owns end to end. */
export const InviteEmailTemplate = () => (
    <EmailPreview
        template={
            <InviteEmail
                labels={{
                    preview: 'You have been invited to Harbor Depot',
                    heading: "You're invited to Harbor Depot",
                    body: 'Ada Keeper invited you to join Harbor Depot as member.',
                    button: 'Accept invitation',
                    linkFallback: 'Or open this link:',
                }}
                acceptUrl="/en/accept-invite?invite=demo-invite-id"
            />
        }
    />
)

/** The scheduled org digest — the email a fired digest-email schedule lands in the Mail tab. */
export const DigestEmailTemplate = () => (
    <EmailPreview
        template={
            <DigestEmail
                labels={{
                    preview: 'A summary of recent activity in Harbor Depot',
                    heading: 'Harbor Depot digest',
                    intro: "Here's what's been happening in Harbor Depot.",
                    countLine: 'Your team has 3 open dockets.',
                    recentHeading: 'Recent dockets',
                    emptyLine: 'No dockets yet.',
                    footer: 'You receive this digest on your team’s schedule.',
                }}
                recentTitles={[
                    'Label printer prints blank labels',
                    'Refund not showing on statement',
                    'Scanner drops wifi',
                ]}
            />
        }
    />
)

/** The generic notification email — ONE template serves every notification kind; the kind picks the copy. */
export const NotificationEmailTemplate = () => (
    <EmailPreview
        template={
            <NotificationEmail
                labels={{
                    preview: 'A docket in Harbor Depot was handed to your team',
                    heading: 'A docket was handed to your team',
                    body: 'Ada Keeper handed "Scanner drops wifi" to Harbor Annex.',
                    footer: 'You receive this because your notification preferences include email.',
                }}
            />
        }
    />
)
