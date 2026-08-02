import { findOrg } from '@app/seed'
import { setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { auth } from 'keel/adapters/index'
import { canManageOrg, ORG_ASSIGNABLE_ROLES } from 'keel/core/roles'
import { OrgGlue } from './org-glue'

export default async function OrgPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params
    setRequestLocale(locale)
    const user = await auth.getCurrentUser()
    if (!user) redirect(`/${locale}${auth.signInPath()}`)

    const members = await auth.listMembers(user.orgSlug)
    const orgName = findOrg(user.orgSlug)?.name ?? user.orgSlug

    return (
        <OrgGlue
            orgName={orgName}
            members={members}
            roles={[...ORG_ASSIGNABLE_ROLES]}
            canManage={canManageOrg(user.role)}
        />
    )
}
