import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Bypass-catcher for the authorization choke point. Subject orgIds are handler-derived, so
 * authorize(...) can't be a route wrapper — it's an explicit call inside each mutating handler. This
 * build-time scan makes "every mutating product route is authorized" a checked invariant rather than
 * a discipline: it walks every route file under each of the roots below, and for any file that exports
 * a mutating verb (POST/PUT/PATCH/DELETE) asserts the file either calls authorize(...) or appears in
 * the justified exemption map. A test (not a lint rule) because the invariant is file-level, not a
 * single AST node — same reasoning as messages-parity.test.ts. GET-only files never have to authorize.
 */

/**
 * TWO KINDS OF ROOT, and why the second one exists.
 *
 * The scan's original subject is the HOST APPS' route trees (Next.js keeps route files in the app's
 * src/app forever — ADR-0012), resolved from the repo the suite runs in rather than relative to this
 * file. EVERY app under apps/ is scanned against the same rules (ADR-0007 — the apps/ tree): no app
 * may opt out by existing.
 *
 * But an apps-only scan makes this FRAMEWORK test depend on a host app for its own subject matter, and
 * most exemptions below were backed only by the demo app — so ejecting the demo turned the exemption
 * map into a pile of stale entries and the walk guard into a failure. The FIXTURE root
 * (packages/keel/test-fixture/api, resolved package-relative so it is found wherever the suite runs)
 * is the framework's own reference tree: one thin, never-served file per invariant this scan asserts.
 *
 * What that MOVES: "is this exemption still real?" is now a question about the framework's reference
 * tree, not about whichever apps happen to be checked out. That is the honest reading once apps are
 * pluggable — an adopter who ships no assistant route has not made the "stateless LLM call" exemption
 * a lie, they have merely stopped using it — and it is the only reading that survives
 * `pnpm init-app --eject-showcase`. What it does NOT move: every app route is still scanned, and a
 * mutating app route still has to call authorize(...) or match an exemption.
 *
 * The per-root "finds mutating routes to check" case below is the walk guard: a wrong root finds
 * nothing and fails loudly instead of passing vacuously behind the other root's results.
 */
const APPS_DIR = path.resolve(process.cwd(), 'apps')
// fileURLToPath on the URL STRING, then path.resolve — NOT `new URL('…', import.meta.url)`: this suite
// runs in the happy-dom environment, whose global URL does not resolve a relative reference against a
// `file:` base the way node's does, and `fileURLToPath` then rejects the result as non-file.
const FIXTURE_API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-fixture/api')

interface ScanRoot {
    /** Human label — disambiguates identical route paths across roots in test names. */
    label: string
    /** Where the WALK starts. */
    dir: string
    /**
     * Where exemption paths are measured from, and the only subtree an exemption can apply to.
     *
     * These differ for an app because Next serves `route.ts` from ANYWHERE under `src/app`, not only
     * under `api/`. Walking `api/` alone left a real hole: a `route.ts` exporting a bare `POST` at
     * `src/app/[locale]/danger/route.ts` was scanned by nothing, and the scan passed while the
     * endpoint answered `200` to an unauthenticated POST. It was latent rather than live — every one
     * of the 113 route files in this repo is under `api/` — but the point of this scan is the route
     * somebody adds later.
     *
     * Exemptions stay measured from `api/` so the map below did not have to be rewritten, and a route
     * OUTSIDE `api/` can match no exemption at all: legitimate non-api handlers exist
     * (`sitemap.xml/route.ts`, `robots.txt/route.ts`), so they are scanned rather than banned, but a
     * mutating one has to call authorize(...) on its own merits.
     */
    exemptDir: string
}

const ROOTS: ScanRoot[] = [
    ...readdirSync(APPS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
            label: `apps/${entry.name}`,
            dir: path.join(APPS_DIR, entry.name, 'src/app'),
            exemptDir: path.join(APPS_DIR, entry.name, 'src/app/api'),
        }))
        .filter((root) => existsSync(root.dir)),
    { label: 'keel/test-fixture', dir: FIXTURE_API_DIR, exemptDir: FIXTURE_API_DIR },
]

// Detects the handler-export forms Next accepts: `export [async] function POST` (a sync function
// returning a promise is a valid handler), `export const/let/var POST = wrapper(...)` (plus the
// destructuring variant `export const { POST } = handlers`), export-list / re-export forms
// (`export { POST } from './impl'`, `export { handler as POST }`), and `export *` (which re-exports
// whatever verbs the source module has — treated as mutating sight-unseen). Over-matching is safe —
// a false positive just demands authorize(...) or an exemption, loudly; under-matching is exactly
// the silent bypass this scan exists to prevent.
const VERBS = 'POST|PUT|PATCH|DELETE'
const MUTATING = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+(?:${VERBS})\\b` +
        `|export\\s+(?:const|let|var)\\s+(?:${VERBS})\\b` +
        `|export\\s+(?:const|let|var)\\s*\\{[^}]*\\b(?:${VERBS})\\b[^}]*\\}` +
        `|export\\s*\\{[^}]*\\b(?:${VERBS})\\b[^}]*\\}` +
        `|export\\s*\\*`,
)
const CALLS_AUTHORIZE = /\bauthorize\s*\(/

// Next.js routes route.ts/tsx/js/jsx/mjs — the scan must cover them all, or the bypass-catcher is
// itself bypassable by filename (a mutating handler in route.js would evade a route.ts-only walk).
const ROUTE_FILE = /^route\.(?:mjs|[jt]sx?)$/

/** Strip line and block comments so a `// authorize(...)` mention in prose can't satisfy the check. */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * Exemption map — paths relative to a ROOT's api dir (an app's src/app/api, or the fixture's api/),
 * each with the reason it needs no per-actor authorize(...) call. Blanket by prefix (whole dirs) or
 * exact by file. Keep this list honest: a new mutating route that isn't genuinely one of these must
 * call authorize(...), not be added here. Every entry is backed by a file in the fixture tree, which
 * is what keeps the staleness checks below meaningful with or without the demo app.
 *
 * EVERY exemption names the gate its reason rests on as `mustMatch`, and the scan verifies every
 * exempted mutating file actually contains it (against comment-stripped source), so the claim is
 * ENFORCED, not prose. `mustMatch` is REQUIRED — a meta-case below fails an entry without one —
 * because a bare exemption is matched by RELATIVE PATH IN EVERY ROOT, including an adopter's app.
 * Without a gate, `profile/route.ts` would exempt any file at that path from authorize(...): an
 * adopter's PUT that updated any user by id would ship un-authorized and the gate would stay green.
 * With one, that route has to contain `auth.updateProfile(` — a port call that takes no user id and
 * so cannot express "update someone else" — to inherit the exemption.
 *
 * What a gate does NOT promise: it proves the exempted route is the KIND of route the reason
 * describes, not that the reason's full claim holds. `llm.complete(` proves a file is the
 * model-calling route; it cannot prove the route persists nothing. The gates are strongest where the
 * reason is mechanical (a simulated-mode 404, a signature wrapper, a self-only port call) and weakest
 * where it is about intent. See ADR-0012 for the trade-off in full.
 */
interface Exemption {
    reason: string
    /** Gate the reason rests on — must appear in each exempted mutating file, in every root. */
    mustMatch: RegExp
}

const EXEMPT_PREFIXES: Record<string, Exemption> = {
    'service/': {
        reason:
            'service callers are org-scoped by construction (the verifying key row IS an org); gated by ' +
            'withServiceCaller (ServiceIdentity — see the decision-log service-auth entry)',
        mustMatch: /withServiceCaller\s*[(<]/,
    },
    'webhooks/': {
        reason:
            'authenticated by a machine caller, not a user session — a shared webhook secret ' +
            '(withWebhookSecret) or the Mailgun inbound signature (withMailgunSignature) — so no ' +
            'per-actor ability applies',
        mustMatch: /with(?:WebhookSecret|MailgunSignature)\s*\(/,
    },
    'simulator/': {
        reason: 'simulated-world surface, simulated-mode-gated (404 in real) — never a product mutation path',
        mustMatch: /if\s*\(\s*!isSimulated\s*\)/,
    },
}

const EXEMPT_FILES: Record<string, Exemption> = {
    'profile/route.ts': {
        reason: 'self-service: the subject is the caller (User.update is self-only), no cross-actor authorization',
        // The port call that MAKES it self-only: updateProfile takes no user id, so a route that
        // updates another user by id cannot be written through it and cannot inherit this exemption.
        mustMatch: /auth\.updateProfile\s*\(/,
    },
    'assistant/route.ts': {
        reason:
            'stateless LLM call — creates no persisted, org-scoped resource to authorize. Any read tool it ' +
            "exposes stays inside the caller's OWN active-org scope (filtered inside withTenant by the " +
            'handler-resolved orgId, the same scope as that app’s own list route) — no per-actor product mutation',
        mustMatch: /llm\.(?:complete|stream|runToolLoop)\s*\(/,
    },
    'analytics/page-view/route.ts': {
        reason: 'telemetry beacon — records a page view, mutates no product resource',
        mustMatch: /analytics\.capture\s*\(/,
    },
    'auth/org/route.ts': {
        reason: 'setActiveOrg enforces membership at the auth port (ForbiddenError for non-members)',
        mustMatch: /auth\.setActiveOrg\s*\(/,
    },
    'auth/signout/route.ts': {
        reason: 'session lifecycle (sign-out) — no product resource, runs post-authz',
        mustMatch: /auth\.signOut\s*\(/,
    },
    'auth/dev-signin/route.ts': {
        reason: 'session lifecycle (dev sign-in) — pre-authz by definition, simulated-mode only',
        mustMatch: /if\s*\(\s*!isSimulated\s*\)/,
    },
    'auth/accept-invite/route.ts': {
        reason: 'invite acceptance is authorized by possession of the invite token, before any membership exists',
        mustMatch: /\bacceptInvite\s*\(/,
    },
    'storage-upload/route.ts': {
        reason:
            'simulated-mode-only (404 in real) multipart upload endpoint — the local twin of an S3 presigned POST, ' +
            'authenticated by the server-signed HMAC upload-target fields (like the webhook secret), NOT a user ' +
            'session; the upload TARGET was already authorized by the app route that minted it',
        mustMatch: /if\s*\(\s*!isSimulated\s*\)/,
    },
}

function routeFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...routeFiles(full))
        else if (ROUTE_FILE.test(entry.name)) out.push(full)
    }
    return out
}

/** Exemption covering this relative path, or undefined if it must call authorize(...). */
function exemptionFor(rel: string): Exemption | undefined {
    if (EXEMPT_FILES[rel]) return EXEMPT_FILES[rel]
    const prefix = Object.keys(EXEMPT_PREFIXES).find((p) => rel.startsWith(p))
    return prefix ? EXEMPT_PREFIXES[prefix] : undefined
}

describe('every mutating API route is authorized', () => {
    // Deliberate asymmetry: CLASSIFY on raw content (a commented-out export over-matches, which
    // fails loud and safe — and naive comment-stripping can truncate at a `//` inside a string
    // literal, which would UNDER-match, the silent direction), but require authorize(...) on
    // stripped content, so a `// authorize(...)` mention in prose can't satisfy the check.
    const files = ROOTS.flatMap((root) =>
        routeFiles(root.dir).map((full) => {
            // Measured from the exempt base, so the map's api-relative keys keep matching unchanged.
            // A file outside that base yields a `../`-prefixed path, which no exemption key can equal
            // or prefix — so `exemptionFor` cannot cover it, which is the intent.
            const rel = path.relative(root.exemptDir, full).split(path.sep).join('/')
            return { root: root.label, rel, content: readFileSync(full, 'utf8') }
        }),
    )

    const mutating = files.filter((f) => MUTATING.test(f.content))
    /** Mutating routes contributed by the FIXTURE root — what the exemption map is checked against. */
    const fixtureRels = new Set(mutating.filter((f) => f.root === 'keel/test-fixture').map((f) => f.rel))

    it('the mutating-export detector catches the handler-export forms Next accepts', () => {
        const caught = [
            'export async function POST(request: Request) {}',
            'export function PUT(request: Request) { return handle(request) }',
            'export const POST = withPortErrors(handler)',
            'export const { POST } = handlers',
            "export { POST } from './impl'",
            'export { handler as PATCH }',
            "export * from './impl'", // whatever verbs the source has — mutating sight-unseen
        ]
        for (const form of caught) expect(MUTATING.test(form), form).toBe(true)
        expect(MUTATING.test('export async function GET(request: Request) {}')).toBe(false)
        expect(MUTATING.test("export { GET } from './impl'")).toBe(false)
    })

    it.each(ROOTS.map((root) => root.label))('%s is really walked (guards against a broken walk)', (label) => {
        // Per root, not in aggregate: a mis-resolved root finds nothing and would otherwise hide
        // behind the other roots' results, which is exactly the vacuous pass this case exists to
        // prevent. ROUTE FILES, not mutating ones: an app may legitimately be read-only (a reporting
        // dashboard, an app mid-build), and demanding a mutation from every app root would fail a
        // FRAMEWORK test for an app that has done nothing wrong. Non-vacuity of the exemption
        // machinery is the FIXTURE root's job — the case below — and that root is package-relative,
        // so it is present in every checkout no matter which apps exist.
        expect(files.filter((f) => f.root === label).length, label).toBeGreaterThan(0)
    })

    it('the fixture root contributes mutating routes (nothing below is vacuous)', () => {
        expect(fixtureRels.size).toBeGreaterThan(0)
    })

    it('the fixture tree still carries a route for every invariant this scan asserts', () => {
        // Named explicitly so a rename inside the fixture cannot quietly retire an invariant: an
        // authorized product mutation, a framework membership mutation, and one route per gated
        // prefix. The exemption-staleness cases below cover the EXEMPT_FILES half.
        for (const rel of [
            'dockets/route.ts',
            'org/invite/route.ts',
            'service/jobs/route.ts',
            'webhooks/jobs/route.ts',
            'simulator/reset/route.ts',
        ]) {
            expect([...fixtureRels], rel).toContain(rel)
        }
    })

    it('at least one mutating route is NON-exempt and genuinely calls authorize(...)', () => {
        // Without this the whole suite could pass vacuously: if every mutating route were exempt,
        // each per-file case below would take the exemption branch and never check anything.
        const enforced = mutating.filter((f) => !exemptionFor(f.rel) && CALLS_AUTHORIZE.test(stripComments(f.content)))
        expect(enforced.length).toBeGreaterThan(0)
    })

    for (const file of mutating) {
        const exemption = exemptionFor(file.rel)
        it(`${file.root}: ${file.rel} calls authorize(...) or is a justified exemption`, () => {
            if (exemption) {
                // Exempt: the reason documents WHY it needs no per-actor ability check, and the gate
                // that reason rests on must actually be present in the file — in THIS root, so an
                // app route never inherits an exemption on the strength of its path alone.
                expect(exemption.reason.length).toBeGreaterThan(0)
                expect(
                    exemption.mustMatch.test(stripComments(file.content)),
                    `${file.root}: ${file.rel} is exempt because of ${exemption.mustMatch}, but the file does not ` +
                        `contain it — the exemption's justification does not hold here; add the gate or call authorize(...)`,
                ).toBe(true)
            } else {
                expect(
                    CALLS_AUTHORIZE.test(stripComments(file.content)),
                    `${file.rel} exports a mutating handler but neither calls authorize(...) nor is in the exemption map. ` +
                        `Add an authorize(...) call, or (only if genuinely not a per-actor product mutation) a justified exemption.`,
                ).toBe(true)
            }
        })
    }

    it('every exemption carries a checkable gate', () => {
        // The type already requires `mustMatch`, but a type is not present at run time and this map
        // is the one place where forgetting it costs an authorization bypass in someone ELSE's app:
        // an exemption is matched by relative path in every root, so a gateless entry would exempt
        // any adopter route that happened to sit at that path. Belt and braces, deliberately.
        for (const [rel, exemption] of [...Object.entries(EXEMPT_FILES), ...Object.entries(EXEMPT_PREFIXES)]) {
            expect(
                exemption.mustMatch instanceof RegExp,
                `exemption for ${rel} has no mustMatch — a bare exemption exempts that path in EVERY root, ` +
                    `including an adopter's app. Name the gate the reason rests on, or drop the exemption.`,
            ).toBe(true)
        }
    })

    it('has no stale exact exemptions (each is backed by a mutating route in the fixture tree)', () => {
        // Checked against the FIXTURE, not the apps: see the ROOTS note above. An entry with no
        // fixture file behind it is either dead or an exemption nobody is prepared to demonstrate.
        for (const rel of Object.keys(EXEMPT_FILES)) {
            expect(
                fixtureRels.has(rel),
                `exemption for ${rel} is stale — packages/keel/test-fixture/api has no mutating route at that path`,
            ).toBe(true)
        }
    })

    it('has no stale prefix exemptions (each covers a mutating route in the fixture tree)', () => {
        for (const prefix of Object.keys(EXEMPT_PREFIXES)) {
            expect(
                [...fixtureRels].some((rel) => rel.startsWith(prefix)),
                `prefix exemption ${prefix} covers no mutating route in packages/keel/test-fixture/api — ` +
                    `remove it or a rename left it dangling`,
            ).toBe(true)
        }
    })
})
