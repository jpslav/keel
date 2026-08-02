import type { Generated } from 'kysely'

export interface TenantsTable {
    id: Generated<string>
    slug: string
}

export interface NotesTable {
    id: Generated<string>
    tenant_id: string
    body: string
}

export interface DB {
    tenants: TenantsTable
    notes: NotesTable
}
