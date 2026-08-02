import { sql, type Kysely } from 'kysely'
import type { ProofExpectation } from './rls-proofs'
import type { DB } from './schema'

/**
 * The COVERAGE half of the tenant-isolation proof (ADR-0004): not "do these tables isolate", but
 * "is everything the app can reach actually protected at all".
 *
 * WHY THIS EXISTS. `SECURITY.md` promises that every tenant-scoped table is protected by row-level
 * security. Nothing used to enforce the word "every" — the proof suite was a hand-written list of
 * tables somebody remembered to extend, and a table left off it was invisible. That was demonstrated,
 * not theorised: a tenant-scoped table added exactly the way `/new-entity` instructs, minus its
 * six-line RLS block, passed typecheck, lint, knip and the whole unit suite while permitting a
 * cross-tenant SELECT *and* a cross-tenant INSERT through the sanctioned `db.withTenant()` API.
 *
 * WHY IT ASKS ABOUT REACHABILITY RATHER THAN ABOUT `tenant_id`. The first version of this file asked
 * "does the table have a column named `tenant_id`", and an adversarial round then walked through four
 * doors that question does not cover: a table keyed on `org_id` instead (an org belongs to exactly one
 * tenant, so it is tenant-scoped in fact and the convention says nothing about it in SQL), a table in
 * a schema other than `public`, and a VIEW or MATERIALIZED VIEW over a protected table. Each one
 * leaked, in the adopted artifact, with the gate green. A naming convention is not a mechanism —
 * which was the whole lesson of the round that created this file, applied to the file itself.
 *
 * So the question is now the one that actually matters: **can `app_user` reach this relation?** That
 * is the role every request runs as, it needs no convention to be true, and a relation the app cannot
 * reach cannot leak through the app. Everything reachable must either be protected or be named as a
 * deliberate exemption below.
 *
 * REACHABILITY MEANS INHERITED REACHABILITY, and getting that wrong was the same mistake a third
 * time. The first version of this predicate matched a grant made to `PUBLIC` or written DIRECTLY to
 * `app_user` — which is itself a convention, one level down. Postgres privileges pass through role
 * MEMBERSHIP, so `GRANT SELECT ON t TO reporter; GRANT reporter TO app_user;` leaves `aclexplode`
 * reporting the grantee as `reporter`, the relation invisible here, and a cross-tenant read available
 * through `db.withTenant()` — demonstrated, with this check green. `pg_has_role` asks the transitive
 * question instead. The `grantee = 0` arm stays beside it: that is `PUBLIC`, which `pg_has_role`
 * does not cover.
 *
 * `FORCE` is checked because it cannot be caught behaviourally: every behavioural proof runs through
 * `runWithTenant`, which does `SET LOCAL ROLE app_user`, and `app_user` is not the table owner — so
 * `FORCE` makes no difference on that path. It protects the OWNER connection, which is what
 * `infra/stack.ts` actually deploys, and measured on real Postgres with a non-superuser owner a table
 * without it hands that connection every tenant's rows while a table with it hands over none.
 *
 * It runs inside `runRlsProofs`, so it runs on BOTH engines — pglite in the unit suite and real
 * Postgres in `pnpm test:contract` — against whatever the registered migrations actually created.
 */

/**
 * Relations `app_user` can reach that deliberately have NO row-level security, each with the reason.
 * Schema-qualified, so a table in another schema can never be exempted by a bare name.
 *
 * These are INFRA tables read while resolving who is calling — before any tenant context exists — so
 * `app_user` holds a cross-tenant `SELECT` on them and no policy applies.
 *
 * Adding a name here removes a relation from the guarantee `SECURITY.md` makes, so it is a security
 * decision and belongs in that file too — which `EXPECTED_EXEMPTIONS` below makes a two-file edit
 * rather than something that can be slipped in. A stale entry is a hazard rather than dead weight: it
 * would silently exempt a FUTURE relation reusing the name, so an entry naming nothing also fails.
 */
const RLS_EXEMPT: Record<string, string> = {
    'public.tenants': 'the tenant registry itself, read to resolve a tenant before any tenant context exists',
    'public.organizations':
        'read to resolve a caller org before a tenant context exists; holds a team slug and display name only',
    'public.service_keys':
        'read to verify a service token before a tenant context exists; holds PUBLIC key material only, so its boundary is cryptographic',
}

/**
 * The exemption list, pinned. Changing `RLS_EXEMPT` without changing this fails, and the assertion
 * message says to update `SECURITY.md` in the same commit — because that file enumerates these three
 * to the public and was already caught once promising more than the code delivered.
 */
const EXPECTED_EXEMPTIONS = ['public.organizations', 'public.service_keys', 'public.tenants']

/**
 * Framework tables the framework's own migrations always create. Used as a SHAPE floor rather than a
 * count floor: an earlier version asserted only "more rows than exemptions", and a deliberately
 * broken catalog query that happened to retain the exemption names sailed past it while a shipped
 * table had no RLS at all. A count is not a shape.
 */
const MUST_APPEAR = [
    'public.agreements',
    'public.audit_events',
    'public.jobs',
    'public.job_schedules',
    'public.notifications',
    'public.organizations',
    'public.service_keys',
    'public.tenants',
    'public.webhook_deliveries',
    'public.webhook_endpoints',
]

/** The transaction-scoped setting `runWithTenant` sets; a policy that ignores it is not isolating. */
const TENANT_SETTING = 'app.current_tenant'

/** Relation kinds that can carry RLS. Anything else reachable must be exempted explicitly. */
const CAN_CARRY_RLS = new Set(['r', 'p'])

const KIND_NAMES: Record<string, string> = {
    r: 'table',
    p: 'partitioned table',
    v: 'view',
    m: 'materialized view',
    f: 'foreign table',
}

interface RelationRow {
    schema_name: string
    table_name: string
    kind: string
    enabled: boolean
    forced: boolean
    is_partition: boolean
    policies: number
    policy_src: string
}

interface PrivilegeRow {
    schema_name: string
    table_name: string
    privilege_type: string
    scope: string
}

/**
 * Fails if anything `app_user` can reach is unprotected, if an exemption is stale or unexpected, if
 * the catalog query has stopped seeing the schema, or if an exempt relation has grown a write grant
 * at table OR column level.
 */
export async function proveRlsCoverage(db: Kysely<DB>, expect: (actual: unknown) => ProofExpectation): Promise<void> {
    // Every relation on which app_user — or PUBLIC, which app_user is a member of — holds any
    // privilege, at table or column level. Column ACLs are included because a column-level grant is
    // invisible to has_table_privilege, and one was demonstrated to allow UPDATEing every row of the
    // tenant registry while the previous version of this check reported nothing.
    const reachable = sql`
        SELECT c.oid
        FROM pg_class c
        CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE a.grantee = 0 OR pg_has_role('app_user', a.grantee, 'USAGE')
        UNION
        SELECT c.oid
        FROM pg_class c
        JOIN pg_attribute att ON att.attrelid = c.oid AND att.attacl IS NOT NULL
        CROSS JOIN LATERAL aclexplode(att.attacl) a
        WHERE a.grantee = 0 OR pg_has_role('app_user', a.grantee, 'USAGE')
    `

    const { rows } = await sql<RelationRow>`
        WITH reachable AS (${reachable})
        SELECT n.nspname                                                          AS schema_name,
               c.relname                                                          AS table_name,
               c.relkind::text                                                    AS kind,
               c.relrowsecurity                                                   AS enabled,
               c.relforcerowsecurity                                              AS forced,
               c.relispartition                                                   AS is_partition,
               (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int   AS policies,
               COALESCE((
                   SELECT string_agg(
                       COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
                       COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''), ' ')
                   FROM pg_policy p WHERE p.polrelid = c.oid
               ), '')                                                             AS policy_src
        FROM reachable r
        JOIN pg_class c ON c.oid = r.oid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY n.nspname, c.relname
    `.execute(db)

    const failures: string[] = []
    const name = (row: RelationRow) => `${row.schema_name}.${row.table_name}`
    const present = new Set(rows.map(name))

    // A catalog query that stopped seeing the schema would make every check below vacuously true —
    // the "gate that has only ever passed" failure mode, which this file exists to refuse.
    for (const required of MUST_APPEAR) {
        if (!present.has(required)) {
            failures.push(`the catalog query did not find \`${required}\`; it is not seeing the schema`)
        }
    }

    const exemptions = Object.keys(RLS_EXEMPT).sort()
    if (exemptions.join(',') !== [...EXPECTED_EXEMPTIONS].sort().join(',')) {
        failures.push(
            `RLS_EXEMPT changed to [${exemptions.join(', ')}] — update EXPECTED_EXEMPTIONS and SECURITY.md's ` +
                `list of deliberately exempt tables in the same commit`,
        )
    }
    for (const exempt of Object.keys(RLS_EXEMPT)) {
        if (!present.has(exempt)) {
            failures.push(`RLS_EXEMPT names \`${exempt}\`, which app_user cannot reach here — stale exemption`)
        }
    }

    for (const row of rows) {
        const key = name(row)
        if (RLS_EXEMPT[key] !== undefined) continue

        // A partition inherits its parent's policies and cannot usefully carry its own, so Postgres
        // applies the parent's. Flagging partitions produced an unsatisfiable red gate whose only
        // documented escape was adding them to the exemption list — a false positive that widens the
        // hole. The parent is checked on its own row.
        if (row.is_partition) continue

        if (!CAN_CARRY_RLS.has(row.kind)) {
            const kind = KIND_NAMES[row.kind] ?? row.kind
            failures.push(
                `${key} is a ${kind} reachable by app_user; it cannot carry RLS, so it must be listed in ` +
                    `RLS_EXEMPT with a reason (a view over a protected table bypasses that table's policy ` +
                    `whenever the view's owner is not itself subject to RLS)`,
            )
            continue
        }

        if (!row.enabled) failures.push(`${key} is reachable by app_user but has no ROW LEVEL SECURITY`)
        else if (!row.forced) failures.push(`${key} has RLS but not FORCE ROW LEVEL SECURITY`)
        else if (row.policies === 0) failures.push(`${key} has RLS enabled but no policy`)
        else if (!row.policy_src.includes(TENANT_SETTING)) {
            // Coverage used to accept any policy at all, so `USING (true)` — a policy that exists and
            // isolates nothing — passed. Reading the expression is what distinguishes a policy from a
            // policy that does something.
            failures.push(
                `${key} has a policy that never reads ${TENANT_SETTING}, so it does not isolate tenants: ` +
                    `${row.policy_src.trim()}`,
            )
        }
    }

    // Makes SECURITY.md's "the grants are SELECT-only" a proof rather than a promise — including the
    // column-level and TRUNCATE/REFERENCES forms that has_table_privilege does not report.
    const { rows: privileges } = await sql<PrivilegeRow>`
        SELECT n.nspname AS schema_name, c.relname AS table_name, a.privilege_type AS privilege_type, 'table' AS scope
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE (a.grantee = 0 OR pg_has_role('app_user', a.grantee, 'USAGE'))
          AND a.privilege_type <> 'SELECT'
        UNION ALL
        SELECT n.nspname, c.relname, a.privilege_type, 'column'
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute att ON att.attrelid = c.oid AND att.attacl IS NOT NULL
        CROSS JOIN LATERAL aclexplode(att.attacl) a
        WHERE (a.grantee = 0 OR pg_has_role('app_user', a.grantee, 'USAGE'))
          AND a.privilege_type <> 'SELECT'
    `.execute(db)

    for (const privilege of privileges) {
        const key = `${privilege.schema_name}.${privilege.table_name}`
        if (RLS_EXEMPT[key] === undefined) continue
        failures.push(
            `app_user holds ${privilege.privilege_type} (${privilege.scope}-level) on the exempt relation ${key}, ` +
                `which SECURITY.md promises is SELECT-only`,
        )
    }

    expect(failures.join('\n')).toBe('')
}
