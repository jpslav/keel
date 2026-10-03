'use client'

import { Button, Group, Stack, Switch, Text, TextInput, UnstyledButton } from '@mantine/core'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { presets as appPresets } from '@app-config/presets'
import { flags as appSimulatorFlags } from '@app-config/simulator'
import { isReservedWorldStartName, WORLD_START_NAME_PATTERN } from '../../core/presets'
import { formatWhen } from './format-when'

export interface Snapshot {
    name: string
    at: string
}

export interface FeatureFlag {
    flag: string
    enabled: boolean
}

/** One agreement row for the Snapshots Agreements section — the world-view god shape. */
export interface SnapshotAgreement {
    id: string
    tenantSlug: string
    kind: string
    title: string
    version: number
    gating: string
    currentAcceptances: number
    totalAcceptances: number
}

const snapshotActionStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: '#f8f9fa',
    border: '1px solid #373a40',
    borderRadius: 6,
    padding: '4px 10px',
} as const

/**
 * Router-agnostic Snapshots tab (ADR-0006 twin lives in keel/demo-static, reset+flags only — see its
 * own doc comment): the world's control knobs in one place. Reset wipes the simulated world back
 * to its seeded state — how many people that is belongs to the app, so the copy here must not say;
 * feature flags gate app behavior (they moved here from the Events tab
 * so Events stays purely observational); save/restore/delete manage named checkpoints. The reset
 * button is a two-step confirm (no browser `confirm()` — this whole app avoids blocking dialogs).
 * When `snapshots` is undefined the caller has no server-side snapshot store to talk to (the static
 * shell), so the snapshot half doesn't render.
 *
 * DEMO PRESETS (keel/core/presets.ts) render on EVERY host that passes `onLoadPreset`: a preset is a
 * script each host replays its own way, not a directory copy, so unlike a saved snapshot it needs no
 * server. The list comes from the seam (`@app-config/presets`), read here as the flags are
 * (`@app-config/simulator`), and the section disappears for an app that registers none.
 */
export function SnapshotsApp({
    snapshots,
    onReset,
    onSave,
    onRestore,
    onDelete,
    busy,
    busySnapshot,
    flags,
    onToggleFlag,
    agreements,
    onBumpAgreement,
    busyAgreement,
    onLoadPreset,
    busyPreset,
}: {
    snapshots?: Snapshot[]
    onReset: () => void
    onSave?: (name: string) => void
    onRestore?: (name: string) => void
    onDelete?: (name: string) => void
    busy?: boolean
    /** Name of the snapshot a restore/delete is currently running for — that row shows as busy. */
    busySnapshot?: string | null
    flags?: FeatureFlag[]
    onToggleFlag?: (flag: string, enabled: boolean) => void
    /** Access-gate agreements. Undefined ⇒ the section doesn't render (a host without it). */
    agreements?: SnapshotAgreement[]
    onBumpAgreement?: (id: string) => void
    /** Id of the agreement a bump is currently running for — that row shows as busy. */
    busyAgreement?: string | null
    /** Load a registered demo preset. Undefined ⇒ the presets section doesn't render. */
    onLoadPreset?: (id: string) => void
    /** Id of the preset a load is currently running for — that row shows as busy. */
    busyPreset?: string | null
}) {
    const t = useTranslations('simulator')
    // Root translator: an app-registered flag's label lives in the APP's catalog (see flagLabel).
    const tRoot = useTranslations()
    const locale = useLocale()
    const [confirmingReset, setConfirmingReset] = useState(false)
    const [name, setName] = useState('')
    // A saved snapshot may not shadow 'reset' or a preset (the server refuses it too): a tour names its
    // starting world by that one string, and it must mean the same world on every host.
    const nameReserved = isReservedWorldStartName(name, appPresets)
    const nameValid = WORLD_START_NAME_PATTERN.test(name) && !nameReserved
    // Reset, restore and a preset load each rewrite the whole world, so one in flight disables the others:
    // a second one starting mid-replay would wipe the world underneath the first.
    const worldBusy = Boolean(busy) || busySnapshot != null || busyPreset != null

    // Known flags get a friendly label; anything new falls back to its raw key instead of silently
    // borrowing another flag's label. Framework flags (demo-banner, jobs-held) are labelled here, from
    // the framework's own `simulator` namespace. An APP-registered flag carries a FULLY-QUALIFIED
    // message path on the seam (@app-config/simulator `flags`) — `namespace.key`, resolved with the
    // root translator — because its copy belongs in the app's catalog, not this one.
    function flagLabel(flag: string): string {
        if (flag === 'demo-banner') return t('flagLabelDemoBanner')
        if (flag === 'jobs-held') return t('flagLabelJobsHeld')
        const registered = appSimulatorFlags.find((entry) => entry.id === flag)
        if (registered) return tRoot(registered.labelKey)
        return flag
    }

    function gatingLabel(gating: string): string {
        return gating === 'advisory' ? t('agreementsGatingAdvisory') : t('agreementsGatingBlock')
    }

    function confirmReset() {
        setConfirmingReset(false)
        onReset()
    }

    function submitSave() {
        if (!nameValid) return
        onSave?.(name)
        setName('')
    }

    return (
        <Stack gap="md" data-testid="simulator-snapshots">
            <Stack gap="xs">
                <Text size="sm" fw={700} c="gray.0">
                    {t('snapshotsResetHeading')}
                </Text>
                <Text size="xs" c="gray.5">
                    {t('snapshotsResetHint')}
                </Text>
                {confirmingReset ? (
                    <Group gap="xs">
                        <Button
                            color="red.8"
                            size="xs"
                            loading={busy}
                            data-testid="snapshots-reset-confirm"
                            onClick={confirmReset}
                        >
                            {t('snapshotsResetConfirm')}
                        </Button>
                        <Button
                            variant="default"
                            size="xs"
                            data-testid="snapshots-reset-cancel"
                            onClick={() => setConfirmingReset(false)}
                        >
                            {t('snapshotsResetCancel')}
                        </Button>
                    </Group>
                ) : (
                    <Button
                        // red.8 (the filled confirm's AA-safe shade) is too dim as outline TEXT on
                        // the dark panel (3.81:1); red.4 clears 4.5:1 against #1a1b1e.
                        color="red.4"
                        variant="outline"
                        size="xs"
                        disabled={worldBusy}
                        data-testid="snapshots-reset"
                        onClick={() => setConfirmingReset(true)}
                    >
                        {t('snapshotsResetButton')}
                    </Button>
                )}
            </Stack>

            {onLoadPreset !== undefined && appPresets.length > 0 ? (
                <Stack gap="xs" data-testid="simulator-presets">
                    <Text size="sm" fw={700} c="gray.0">
                        {t('presetsHeading')}
                    </Text>
                    <Text size="xs" c="gray.5">
                        {t('presetsHint')}
                    </Text>
                    {appPresets.map((preset) => {
                        const rowBusy = busyPreset === preset.id
                        return (
                            <Group
                                key={preset.id}
                                justify="space-between"
                                wrap="nowrap"
                                data-testid={`preset-row-${preset.id}`}
                                style={{
                                    borderRadius: 8,
                                    padding: '6px 10px',
                                    border: '1px solid rgba(255,255,255,0.15)',
                                    opacity: rowBusy ? 0.6 : 1,
                                }}
                            >
                                <Stack gap={0}>
                                    <Text size="sm" fw={600} c="gray.0">
                                        {tRoot(preset.titleKey)}
                                    </Text>
                                    <Text size="xs" c="gray.5">
                                        {rowBusy ? t('snapshotsWorking') : tRoot(preset.summaryKey)}
                                    </Text>
                                </Stack>
                                <UnstyledButton
                                    data-testid={`preset-load-${preset.id}`}
                                    disabled={worldBusy}
                                    onClick={() => onLoadPreset(preset.id)}
                                    style={snapshotActionStyle}
                                >
                                    {t('presetsLoad')}
                                </UnstyledButton>
                            </Group>
                        )
                    })}
                </Stack>
            ) : null}

            {flags !== undefined ? (
                <Stack gap="xs">
                    <Text size="sm" fw={700} c="gray.0">
                        {t('flagsHeading')}
                    </Text>
                    <Text size="xs" c="gray.5">
                        {t('flagHint')}
                    </Text>
                    {flags.map((flag) => (
                        <Switch
                            key={flag.flag}
                            label={flagLabel(flag.flag)}
                            checked={flag.enabled}
                            size="xs"
                            styles={{ label: { color: '#f8f9fa' } }}
                            data-testid={`flag-toggle-${flag.flag}`}
                            onChange={(event) => onToggleFlag?.(flag.flag, event.currentTarget.checked)}
                        />
                    ))}
                </Stack>
            ) : null}

            {agreements !== undefined ? (
                <Stack gap="xs" data-testid="simulator-agreements">
                    <Text size="sm" fw={700} c="gray.0">
                        {t('agreementsHeading')}
                    </Text>
                    <Text size="xs" c="gray.5">
                        {t('agreementsHint')}
                    </Text>
                    {agreements.length === 0 ? (
                        <Text size="xs" c="gray.5" data-testid="simulator-agreements-empty">
                            {t('agreementsEmpty')}
                        </Text>
                    ) : (
                        agreements.map((agreement) => {
                            const rowBusy = busyAgreement === agreement.id
                            return (
                                <Group
                                    key={agreement.id}
                                    justify="space-between"
                                    wrap="nowrap"
                                    data-testid={`simulator-agreement-${agreement.id}`}
                                    style={{
                                        borderRadius: 8,
                                        padding: '6px 10px',
                                        border: '1px solid rgba(255,255,255,0.15)',
                                        opacity: rowBusy ? 0.6 : 1,
                                    }}
                                >
                                    <Stack gap={0}>
                                        <Text size="sm" fw={600} c="gray.0">
                                            {t('agreementsRowTitle', {
                                                tenant: agreement.tenantSlug,
                                                title: agreement.title,
                                            })}
                                        </Text>
                                        <Text size="xs" c="gray.5" data-testid={`agreement-meta-${agreement.id}`}>
                                            {t('agreementsRowMeta', {
                                                version: agreement.version,
                                                gating: gatingLabel(agreement.gating),
                                                current: agreement.currentAcceptances,
                                                total: agreement.totalAcceptances,
                                            })}
                                        </Text>
                                    </Stack>
                                    <UnstyledButton
                                        data-testid={`agreement-bump-${agreement.id}`}
                                        disabled={rowBusy}
                                        onClick={() => onBumpAgreement?.(agreement.id)}
                                        style={snapshotActionStyle}
                                    >
                                        {t('agreementsBump')}
                                    </UnstyledButton>
                                </Group>
                            )
                        })
                    )}
                </Stack>
            ) : null}

            {snapshots !== undefined ? (
                <Stack gap="xs">
                    <Text size="sm" fw={700} c="gray.0">
                        {t('snapshotsSaveHeading')}
                    </Text>
                    <Text size="xs" c="gray.5">
                        {t('snapshotsSaveHint')}
                    </Text>
                    <Group gap="xs" align="end">
                        <TextInput
                            size="xs"
                            flex={1}
                            placeholder={t('snapshotsNamePlaceholder')}
                            data-testid="snapshot-name"
                            value={name}
                            onChange={(event) => setName(event.currentTarget.value)}
                        />
                        <Button
                            size="xs"
                            loading={busy}
                            disabled={!nameValid}
                            data-testid="snapshots-save"
                            onClick={submitSave}
                        >
                            {t('snapshotsSaveButton')}
                        </Button>
                    </Group>
                    {name.length > 0 && !nameValid ? (
                        <Text size="xs" c="red.4" data-testid="snapshot-name-error">
                            {nameReserved ? t('snapshotsNameReserved') : t('snapshotsNameInvalid')}
                        </Text>
                    ) : null}

                    <Text size="sm" fw={700} c="gray.0" mt="sm">
                        {t('snapshotsListHeading')}
                    </Text>
                    {snapshots.length === 0 ? (
                        <Text size="xs" c="gray.5" data-testid="snapshots-empty">
                            {t('snapshotsEmpty')}
                        </Text>
                    ) : (
                        <Stack gap={4} data-testid="snapshots-list">
                            {snapshots.map((snapshot) => {
                                const rowBusy = busySnapshot === snapshot.name
                                return (
                                    <Group
                                        key={snapshot.name}
                                        justify="space-between"
                                        wrap="nowrap"
                                        data-testid={`snapshots-row-${snapshot.name}`}
                                        style={{
                                            borderRadius: 8,
                                            padding: '6px 10px',
                                            border: '1px solid rgba(255,255,255,0.15)',
                                            opacity: rowBusy ? 0.6 : 1,
                                        }}
                                    >
                                        <Stack gap={0}>
                                            <Text size="sm" fw={600} c="gray.0">
                                                {snapshot.name}
                                            </Text>
                                            <Text size="xs" c="gray.5">
                                                {rowBusy ? t('snapshotsWorking') : formatWhen(snapshot.at, locale)}
                                            </Text>
                                        </Stack>
                                        <Group gap={6} wrap="nowrap">
                                            <UnstyledButton
                                                data-testid={`snapshots-restore-${snapshot.name}`}
                                                disabled={worldBusy}
                                                onClick={() => onRestore?.(snapshot.name)}
                                                style={snapshotActionStyle}
                                            >
                                                {t('snapshotsRestoreButton')}
                                            </UnstyledButton>
                                            <UnstyledButton
                                                data-testid={`snapshots-delete-${snapshot.name}`}
                                                disabled={rowBusy}
                                                onClick={() => onDelete?.(snapshot.name)}
                                                style={{ ...snapshotActionStyle, color: '#ffa8a8' }}
                                            >
                                                {t('snapshotsDeleteButton')}
                                            </UnstyledButton>
                                        </Group>
                                    </Group>
                                )
                            })}
                        </Stack>
                    )}
                </Stack>
            ) : null}
        </Stack>
    )
}
