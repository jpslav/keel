'use client'

import { Group, Text } from '@mantine/core'
import type { ReactNode } from 'react'

/** Shell header for signed-in pages: app name left, notification bell + tenant switcher + user menu right. */
export function AppHeader({
    tenantName,
    controls,
    nav,
    bell,
    appName,
}: {
    tenantName: string
    controls: ReactNode
    nav?: ReactNode
    bell?: ReactNode
    /**
     * The product's display name — REQUIRED, and supplied by the app from its own catalog (the
     * `welcome.appName` convention both apps here follow).
     *
     * REQUIRED rather than optional, deliberately. One shared framework catalog cannot name two
     * products, so any fallback key here would hold whichever app was written first and render it
     * for every other app — silently, because a default that resolves is indistinguishable from a
     * default that is right. Requiring the prop moves that from a sentence in a docstring to
     * something the compiler checks (ADR-0012, docs/adopting.md).
     */
    appName: ReactNode
}) {
    return (
        <Group component="header" justify="space-between" px="md" py="xs" bg="gray.0">
            <Group gap="xs">
                <Text fw={700}>{appName}</Text>
                <Text size="sm" c="gray.7" data-testid="active-tenant">
                    {tenantName}
                </Text>
                {nav}
            </Group>
            <Group gap="sm">
                {bell}
                {controls}
            </Group>
        </Group>
    )
}
