/**
 * The seam re-export of the app's seed data (ADR-0012). Framework code that needs the world — the fake
 * auth adapter, the DB seeder, per-tenant theming, the static-demo twin — imports it THROUGH here, so
 * WHERE an app keeps its seed is the app's business. The showcase keeps its in a workspace package
 * (`@app/seed`); this app keeps its in `src/seed`. Neither can see the other's.
 */
export * from '../seed'
