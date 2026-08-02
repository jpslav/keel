/**
 * Host identity — the app half of the seam the framework reads its slug through (ADR-0012).
 *
 * `APP_SLUG` is the ONE value an adopter changes to rename the app's mechanical identity: session and
 * viewpoint cookies, the fake-auth JWT issuer, the service-token audience, outbound webhook header
 * names, and the infra resource names. See `config/app.ts` for the collision-risk doctrine.
 */
export { APP_SLUG } from '../../config/app'
