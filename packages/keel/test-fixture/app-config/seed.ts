/**
 * The seam re-export of the fixture's seed world (ADR-0012). Framework code that needs the world — the
 * fake auth adapter, the DB seeder, per-tenant theming, the static-demo twin — imports it THROUGH here,
 * so WHERE the seed lives is the app's business. The fixture keeps its one directory up, beside the
 * seam rather than inside it.
 */
export * from '../seed'
