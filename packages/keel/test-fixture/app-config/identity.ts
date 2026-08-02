/**
 * Host identity — the app half of the seam the framework reads its slug through (ADR-0012).
 *
 * The fixture is not a deployable app, so unlike `apps/*` it has no `config/app.ts` to re-export from:
 * the slug is declared here, and it is deliberately not any real app's. It names the fixture's session
 * and viewpoint cookies, its fake-auth JWT issuer and its service-token audience, which is exactly what
 * `adapters/fake/auth.test.ts` and `adapters/fake/simulator.test.ts` read it for.
 */
export const APP_SLUG = 'keelfix'
