import { Group } from '@mantine/core'
import { OrgScreen } from '../org-screen'
import { OrgSwitcher } from './org-switcher'
import { PeoplePicker } from './people-picker'
import { PreviewRow } from './preview-row'
import { SignInScreen } from './sign-in-screen'
import { UserMenu } from './user-menu'

const people = [
    { id: 'fixture-lead', name: 'Ada Keeper', role: 'admin', tenantName: 'Harbor Works' },
    { id: 'fixture-crew', name: 'Cy Rigger', role: 'member', tenantName: 'Harbor Works' },
]

export const SignIn = () => <SignInScreen body={<PeoplePicker people={people} onPick={() => {}} />} />

/** The shared identity row behind the switcher and the user menu — org (squared) and user (round). */
export const IdentityRows = () => (
    <Group p="md" gap="xl">
        <PreviewRow name="Harbor Depot" title="Harbor Depot" subtitle="admin" />
        <PreviewRow name="Ada Keeper" title="Ada Keeper" subtitle="ada.keeper@example.test" rounded />
    </Group>
)

/** Header org switcher — trigger opens a popover of memberships with per-org roles + active check. */
export const OrganizationSwitcher = () => (
    <Group justify="flex-end" p="md">
        <OrgSwitcher
            activeSlug="depot"
            orgs={[
                { slug: 'depot', name: 'Harbor Depot', role: 'admin' },
                { slug: 'annex', name: 'Harbor Annex', role: 'admin' },
            ]}
            onSwitch={() => {}}
        />
    </Group>
)

/** Header user menu — avatar trigger opening a preview-row header + account actions. */
export const AccountMenu = () => (
    <Group justify="flex-end" p="md">
        <UserMenu
            user={{ name: 'Ada Keeper', email: 'ada.keeper@example.test' }}
            onProfile={() => {}}
            onSignOut={() => {}}
        />
    </Group>
)

export const Organization = () => (
    <OrgScreen
        orgName="Harbor Depot"
        members={[
            { id: '1', name: 'Ada Keeper', email: 'ada.keeper@example.test', role: 'admin', status: 'active' },
            { id: '2', name: 'Sam Rivera', email: 'sam.rivera@example.test', role: 'staff', status: 'active' },
            { id: '3', name: null, email: 'newcomer@example.test', role: 'member', status: 'invited' },
        ]}
        roles={['staff', 'member', 'guest', 'restricted']}
        canManage
        onInvite={async () => {}}
    />
)
