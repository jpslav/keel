import type { DigestBodySource } from 'keel/jobs/digest-email'

/**
 * The APP's digest source (the seam side of keel/jobs/digest-email.ts, ADR-0012). The framework's
 * scheduled-work example knows there is a digest and how to count and snip it; WHICH rows it is about
 * is app vocabulary, so it arrives here. This is the server twin of the option the static demo has
 * always passed (`digestBodies` in src/demo-static/app.tsx) — the two now read from the same contract.
 *
 * For a desk, "what is there to report" is the OPEN queue: resolved tickets are done, so a digest that
 * counted them would flatter the numbers. Same tenant-scoped, org-filtered shape as GET /api/tickets:
 * every read goes through withTenant, so RLS is the enforcement rather than query discipline.
 */
export const digestBodies: DigestBodySource = async ({ db, tenantId, orgId }) => {
    const rows = await db.withTenant(tenantId, (trx) =>
        trx
            .selectFrom('tickets')
            .select(['ref', 'subject'])
            .where('org_id', '=', orgId)
            .where('status', '!=', 'resolved')
            .orderBy('created_at', 'desc')
            .execute(),
    )
    return rows.map((row) => `${row.ref} — ${row.subject}`)
}
