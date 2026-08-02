/**
 * The seam re-export of the app's seed data (packages/seed = @app/seed). Framework code that needs the
 * demo world — the fake auth adapter, the DB seeder, per-tenant theming — imports it THROUGH here, never
 * @app/seed directly (fence, ADR-0012). So a package split repoints ONE file instead of many, and a real
 * adopter swaps packages/seed with its own without the framework knowing.
 *
 * `appSeedRows` is the OPTIONAL half of the seam: the framework seeder looks for it here and, when an
 * app exports one, hands over after its own tables are in place so the app can seed its product rows
 * (see ./db/seed-rows.ts). An app with nothing to seed omits the export — apps/starter does — and the
 * framework skips the step.
 */
export * from '@app/seed'
export { appSeedRows } from './db/seed-rows'
