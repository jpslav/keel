'use client'

import { Box, Button, Group, SegmentedControl, Stack, Text, UnstyledButton } from '@mantine/core'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatWhen } from './format-when'

export interface MailItem {
    id: string
    to: string
    subject: string
    at: string
    html: string
}

const linkRowStyle = {
    textAlign: 'left' as const,
    flex: 1,
    minWidth: 0,
    borderRadius: 6,
    padding: '6px 10px',
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,255,255,0.06)',
}

/**
 * The reading-pane iframe is sandboxed with ONLY allow-scripts (opaque origin, no top-navigation),
 * so the email can't navigate anything itself. This bridge script, appended to the srcDoc,
 * intercepts anchor clicks inside the message and postMessages the href to the parent — which
 * routes it through the caller's onOpenLink, the SAME policy gate the extracted link rows use.
 * That makes the email's own buttons/links actually work without widening what they're allowed
 * to do. Caught mail is app-composed (the fake adapter stores our own sends), so running its
 * scripts in an opaque origin is an acceptable dev-tool tradeoff.
 */
const BRIDGE_SCRIPT =
    '<script>document.addEventListener("click",function(e){' +
    'var t=e.target;var a=t&&t.closest?t.closest("a[href]"):null;if(!a)return;' +
    'e.preventDefault();parent.postMessage({type:"app-mail-link",href:a.getAttribute("href")},"*")' +
    '})</script>'

/** Pulls `a[href]` out of the message html with DOMParser so the caller can offer link rows with
 *  copy buttons (handy for opening an invite in a second browser profile). Browser API only;
 *  guarded so this never runs during SSR of this 'use client' component. */
function extractLinks(html: string): string[] {
    if (typeof DOMParser === 'undefined') return []
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return Array.from(doc.querySelectorAll('a[href]'))
        .map((anchor) => anchor.getAttribute('href'))
        .filter((href): href is string => !!href)
}

/**
 * Two-step clear-mailbox control (mirrors the Snapshots reset — this app avoids blocking dialogs).
 * Owns its armed/confirming state so the CALLER can reset it with `key`: an armed confirm must not
 * outlive the view it was armed against (scope switch, list changing underneath), and a remount is
 * the effect-free way to guarantee that.
 */
function ClearMailControl({ onClear }: { onClear: () => void }) {
    const t = useTranslations('simulator')
    const [confirming, setConfirming] = useState(false)
    if (!confirming) {
        return (
            <Button size="compact-xs" variant="default" data-testid="mail-clear" onClick={() => setConfirming(true)}>
                {t('mailClearButton')}
            </Button>
        )
    }
    return (
        <Group gap="xs">
            <Button color="red.8" size="compact-xs" data-testid="mail-clear-confirm" onClick={onClear}>
                {t('mailClearConfirm')}
            </Button>
            <Button
                variant="default"
                size="compact-xs"
                data-testid="mail-clear-cancel"
                onClick={() => setConfirming(false)}
            >
                {t('mailClearCancel')}
            </Button>
        </Group>
    )
}

/**
 * Router-agnostic Mail tab (ADR-0006 twin lives in keel/demo-static): a per-person inbox over the
 * fake email adapter's catch store, plus an "all mail" scope, styled like a small mail client.
 * Data and callbacks only — the glue (src/app/[locale]/simulator-glue.tsx) owns fetching, scope
 * persistence, and deciding what a link is allowed to do.
 */
export function MailApp({
    emails,
    scope,
    onScopeChange,
    personEmail,
    mailSeenAt,
    allCount,
    onOpenLink,
    onSeen,
    onClear,
    onCopyLink,
}: {
    emails: MailItem[]
    scope: 'person' | 'all'
    onScopeChange: (scope: 'person' | 'all') => void
    personEmail: string | null
    mailSeenAt?: string | null
    allCount?: number
    onOpenLink: (href: string) => void
    onSeen: () => void
    onClear?: () => void
    onCopyLink?: (href: string) => void
}) {
    const t = useTranslations('simulator')
    const locale = useLocale()
    const [openId, setOpenId] = useState<string | null>(null)
    const open = emails.find((email) => email.id === openId) ?? null
    const links = useMemo(() => (open ? extractLinks(open.html) : []), [open])
    const frameRef = useRef<HTMLIFrameElement | null>(null)

    useEffect(() => {
        // Opening the Mail tab renders this component in 'person' scope by default, and switching
        // scope to 'person' fires this again — both count as "read your mail" (design invariant).
        // A poll tick that merely refreshes `emails` doesn't re-run this (scope hasn't changed).
        if (scope === 'person') onSeen()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope])

    useEffect(() => {
        function onMessage(event: MessageEvent) {
            // Only the reading pane's own window may speak; anything else on the page is ignored.
            if (!frameRef.current || event.source !== frameRef.current.contentWindow) return
            const data = event.data as { type?: unknown; href?: unknown }
            if (data?.type === 'app-mail-link' && typeof data.href === 'string') onOpenLink(data.href)
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
    }, [onOpenLink])

    const showEmptyPersonHint = scope === 'person' && emails.length === 0 && (allCount ?? 0) > 0

    return (
        <Stack gap="sm" data-testid="simulator-mail">
            <Group justify="space-between" wrap="wrap" gap="xs">
                <SegmentedControl
                    data-testid="mail-scope"
                    size="xs"
                    value={scope}
                    disabled={!personEmail}
                    data={[
                        { value: 'person', label: <span data-testid="mail-scope-person">{t('mailScopePerson')}</span> },
                        { value: 'all', label: <span data-testid="mail-scope-all">{t('mailScopeAll')}</span> },
                    ]}
                    onChange={(value) => onScopeChange(value === 'all' ? 'all' : 'person')}
                />
                {onClear && emails.length > 0 ? (
                    // Keyed by scope + list size: any change remounts the control, disarming a
                    // pending confirm that was armed against a view that no longer exists.
                    <ClearMailControl key={`${scope}:${emails.length}`} onClear={onClear} />
                ) : null}
            </Group>
            {emails.length === 0 ? (
                showEmptyPersonHint ? (
                    <Stack gap="xs" data-testid="mail-empty-person">
                        <Text size="xs" c="gray.5">
                            {t('mailEmptyPerson', { email: personEmail ?? '' })}
                        </Text>
                        <Button
                            size="xs"
                            variant="default"
                            data-testid="mail-show-all"
                            onClick={() => onScopeChange('all')}
                        >
                            {t('mailShowAll', { count: allCount ?? 0 })}
                        </Button>
                    </Stack>
                ) : (
                    <Text size="xs" c="gray.5" data-testid="mail-empty">
                        {t('mailEmpty')}
                    </Text>
                )
            ) : (
                <Stack gap={0} data-testid="mail-list">
                    {emails.map((email) => {
                        const unread = scope === 'person' && (!mailSeenAt || email.at > mailSeenAt)
                        const selected = email.id === openId
                        return (
                            <Box key={email.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
                                <UnstyledButton
                                    data-testid={`mail-item-${email.id}`}
                                    aria-expanded={selected}
                                    onClick={() => setOpenId(selected ? null : email.id)}
                                    style={{
                                        display: 'block',
                                        width: '100%',
                                        borderRadius: 8,
                                        padding: '8px 10px',
                                        background: selected ? 'rgba(255,255,255,0.14)' : 'transparent',
                                    }}
                                >
                                    <Group gap={8} wrap="nowrap" align="start">
                                        <Box
                                            mt={6}
                                            style={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: 999,
                                                flexShrink: 0,
                                                background: unread ? '#4dabf7' : 'transparent',
                                            }}
                                        />
                                        <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                                            <Group justify="space-between" wrap="nowrap" gap="xs">
                                                <Text size="sm" fw={unread ? 700 : 500} c="gray.0" truncate>
                                                    {email.subject}
                                                </Text>
                                                <Text size="xs" c="gray.6" style={{ whiteSpace: 'nowrap' }}>
                                                    {formatWhen(email.at, locale)}
                                                </Text>
                                            </Group>
                                            <Text size="xs" c="gray.5" truncate>
                                                {t('mailToLine', { to: email.to })}
                                            </Text>
                                        </Stack>
                                    </Group>
                                </UnstyledButton>
                                {selected ? (
                                    // Reading pane renders inline under its own row — no duplicated
                                    // subject/to/time header (the row already shows it); just the
                                    // sandboxed body + policy-gated extracted links.
                                    <Box pb="xs">
                                        <iframe
                                            ref={frameRef}
                                            title={email.subject}
                                            srcDoc={email.html + BRIDGE_SCRIPT}
                                            sandbox="allow-scripts"
                                            style={{
                                                width: '100%',
                                                height: 260,
                                                border: 0,
                                                borderRadius: 6,
                                                background: '#fff',
                                                display: 'block',
                                            }}
                                            data-testid="mail-body"
                                        />
                                        {links.length > 0 ? (
                                            <Stack gap={4} pt="xs">
                                                <Text size="xs" fw={700} c="gray.4">
                                                    {t('mailLinksHeading')}
                                                </Text>
                                                {links.map((href, index) => (
                                                    <Group key={`${href}-${index}`} gap={6} wrap="nowrap">
                                                        <UnstyledButton
                                                            data-testid="mail-link"
                                                            onClick={() => onOpenLink(href)}
                                                            style={linkRowStyle}
                                                        >
                                                            <Text
                                                                size="xs"
                                                                c="gray.0"
                                                                style={{ wordBreak: 'break-all' }}
                                                            >
                                                                {href}
                                                            </Text>
                                                        </UnstyledButton>
                                                        {onCopyLink ? (
                                                            <Button
                                                                size="compact-xs"
                                                                variant="default"
                                                                data-testid="mail-link-copy"
                                                                onClick={() => onCopyLink(href)}
                                                            >
                                                                {t('mailCopyButton')}
                                                            </Button>
                                                        ) : null}
                                                    </Group>
                                                ))}
                                            </Stack>
                                        ) : null}
                                    </Box>
                                ) : null}
                            </Box>
                        )
                    })}
                </Stack>
            )}
        </Stack>
    )
}
