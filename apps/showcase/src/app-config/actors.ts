/**
 * The Simulator "actors" registry (the app side — ADR-0012). Actors are in-page automations that drive
 * the SAME service/webhook surfaces a real counterparty would, so the async job loop runs end-to-end
 * with no human clicking. They are DEMO content: a real adopter registers its own actors here (or none).
 * PURE TypeScript, no framework imports — shared by the server glue and the static-demo twin.
 *
 * The desk's two counterparties split the world by org so their job pools stay disjoint:
 *   - bundle-analyzer: the partner service the FRONTLINE desk sends diagnostic bundles to (its minted
 *     token is scoped to that team by construction), claiming and completing its jobs over
 *     /api/service/*.
 *   - partner-desk: the outsourced desk that handles every OTHER team's work (cross-tenant, like a real
 *     BPO), delivering genuine completion webhooks for the jobs it is handed.
 *
 * `title`/`description` are i18n keys in the APP's own `actors` namespace (apps/showcase/messages);
 * the host glue translates them and hands the Simulator Actors tab finished strings, so a counterparty
 * an app invents never needs a key in the framework's catalog.
 */

/** One registered actor: its id plus the app-catalog i18n keys for its card title and description. */
export const actors = [
    { id: 'bundle-analyzer', titleKey: 'analyzerTitle', descriptionKey: 'analyzerDescription' },
    { id: 'partner-desk', titleKey: 'partnerTitle', descriptionKey: 'partnerDescription' },
] as const

export type ActorId = (typeof actors)[number]['id']

export function isActorId(value: string): value is ActorId {
    return actors.some((actor) => actor.id === value)
}

/**
 * The one team the bundle-analyzer serves. The partner-desk's pending-build pool is DEFINED as
 * "every non-terminal job whose org is not a service-managed one" (see serviceManagedOrgSlugs in
 * src/app-config/jobs.ts), keeping the two actors' pools disjoint — no fighting over the same job, and
 * the 409-tolerance in each tick stays a robustness net rather than load-bearing.
 */
export const analyzerOrgSlug = 'frontline'
