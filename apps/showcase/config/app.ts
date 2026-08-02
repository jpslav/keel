/**
 * App identity — the single source of truth for MECHANICAL identifiers.
 *
 * Doctrine: identifiers that a tool, protocol, or platform keys on and that can COLLIDE across
 * apps (session/viewpoint cookies, the fake-auth JWT issuer, the service-token audience, infra
 * resource names) DERIVE from this slug, so an adopter renames the app in exactly ONE place.
 * Identifiers that are purely origin- or process-scoped are instead given NEUTRAL names that
 * never need renaming. Human-facing DISPLAY copy ("Northwind Support", the product name this demo
 * wears) lives in `messages/*.json` and docs prose — never here.
 *
 * Adopting this template = change this one value.
 *
 * Kept dependency-free on purpose: imported by both `src/` (the app) and `infra/` (CDK) code.
 */
export const APP_SLUG = 'showcase'
