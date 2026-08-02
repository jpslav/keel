/**
 * Host identity — the app half of the seam the framework reads its slug through.
 *
 * `APP_SLUG` is the ONE value an adopter changes to rename the app's mechanical identity: session and
 * viewpoint cookies, the fake-auth JWT issuer, the service-token audience, outbound webhook header
 * names, and the infra resource names. See `config/app.ts` for the collision-risk doctrine that decides
 * which identifiers derive from it and which are neutral instead.
 *
 * Why it is re-exported HERE rather than imported directly from the repo root: keel is a package, and a
 * package that reaches out to its host's filesystem by relative escape only works while there is exactly
 * one host. ADR-0012 recorded that escape as an accepted wart; a second app closes it. The framework now
 * reads identity through `@app-config/identity` like every other piece of app vocabulary, so each app
 * supplies its own slug and neither can see the other's.
 */
export { APP_SLUG } from '../../config/app'
