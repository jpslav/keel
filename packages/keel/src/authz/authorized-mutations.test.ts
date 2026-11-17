import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
    type Exemption,
    type Gate,
    type ScanPolicy,
    type ScanRoot,
    exemptionFor,
    judge,
    scanRoutes,
} from './route-scan'

/**
 * Bypass-catcher for the authorization choke point. Subject orgIds are handler-derived, so
 * authorize(...) can't be a route wrapper — it's an explicit call inside each mutating handler. This
 * build-time scan makes "every mutating product route is authorized" a checked invariant rather than
 * a discipline: it walks every route file under each of the roots below and judges EACH exported mutating
 * handler (POST/PUT/PATCH/DELETE) on its own: the handler must reach authorize(...) on its own path, or its
 * route must sit in the justified exemption map AND the handler must pass that exemption's gate. GET-only
 * files never have to authorize.
 *
 * The judging is ./route-scan.ts: it reads the files with the TypeScript compiler's parser and binder, so a
 * string, a comment, a call in another handler, a dead branch or an uncalled function proves nothing (the
 * scan used to match the file's TEXT, and each of those passed; ADR-0012 addendum, 2026-11-17). What it
 * follows and what it refuses is stated at the top of that file. THIS file is the policy: the roots, the
 * exemptions and the gates they rest on.
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
 * mutating app handler still has to reach authorize(...) or pass an exemption's gate.
 *
 * The per-root "is really walked" case below is the walk guard: a wrong root finds nothing and fails
 * loudly instead of passing vacuously behind the other root's results.
 */
const REPO_DIR = process.cwd()
const APPS_DIR = path.resolve(REPO_DIR, 'apps')
// fileURLToPath on the URL STRING, then path.resolve — NOT `new URL('…', import.meta.url)`: this suite
// runs in the happy-dom environment, whose global URL does not resolve a relative reference against a
// `file:` base the way node's does, and `fileURLToPath` then rejects the result as non-file.
const FIXTURE_API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-fixture/api')

/**
 * Each root's `exemptDir` differs from its `dir` for an app because Next serves `route.ts` from ANYWHERE
 * under `src/app`, not only under `api/`. Walking `api/` alone left a real hole: a `route.ts` exporting a
 * bare `POST` at `src/app/[locale]/danger/route.ts` was scanned by nothing, and the scan passed while the
 * endpoint answered `200` to an unauthenticated POST.
 *
 * Exemptions stay measured from `api/` so the map below did not have to be rewritten, and a route
 * OUTSIDE `api/` can match no exemption at all: legitimate non-api handlers exist
 * (`sitemap.xml/route.ts`, `robots.txt/route.ts`), so they are scanned rather than banned, but a
 * mutating one has to reach authorize(...) on its own merits.
 *
 * `tsconfig` is the one whose module resolution a re-exported handler is followed with: each app's own
 * (its `@/*` alias), and for the fixture the root one, which is what typechecks it.
 */
const ROOTS: ScanRoot[] = [
    ...readdirSync(APPS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
            label: `apps/${entry.name}`,
            dir: path.join(APPS_DIR, entry.name, 'src/app'),
            exemptDir: path.join(APPS_DIR, entry.name, 'src/app/api'),
            // An app without one (a JS app's jsconfig.json, or neither) still gets scanned: relative
            // re-exports resolve without a config, and an alias that does not resolve is refused, loudly.
            tsconfig: ['tsconfig.json', 'jsconfig.json']
                .map((name) => path.join(APPS_DIR, entry.name, name))
                .find((file) => existsSync(file)),
        }))
        .filter((root) => existsSync(root.dir)),
    {
        label: 'keel/test-fixture',
        dir: FIXTURE_API_DIR,
        exemptDir: FIXTURE_API_DIR,
        tsconfig: path.join(REPO_DIR, 'tsconfig.json'),
    },
]

/**
 * Exemption map — paths relative to a ROOT's api dir (an app's src/app/api, or the fixture's api/),
 * each with the reason it needs no per-actor authorize(...) call. Blanket by prefix (whole dirs) or
 * exact by file. Keep this list honest: a new mutating route that isn't genuinely one of these must
 * call authorize(...), not be added here. Every entry is backed by a file in the fixture tree, which
 * is what keeps the staleness checks below meaningful with or without the demo app.
 *
 * EVERY exemption names the gate its reason rests on as `mustMatch`, and the scan checks it on EVERY
 * exempted mutating HANDLER, per verb, so the claim is ENFORCED, not prose: a guarded POST does not carry an
 * open DELETE beside it. `mustMatch` is REQUIRED — a meta-case below fails an entry without one —
 * because a bare exemption is matched by RELATIVE PATH IN EVERY ROOT, including an adopter's app.
 * Without a gate, `profile/route.ts` would exempt any file at that path from authorize(...): an
 * adopter's PUT that updated any user by id would ship un-authorized and the gate would stay green.
 * With one, that handler has to reach `auth.updateProfile(` — a port call that takes no user id and
 * so cannot express "update someone else" — to inherit the exemption.
 *
 * A gate is one of three kinds (./route-scan.ts, `Gate`), and the kind is the entry's statement of what
 * "guarded" means for its reason:
 *
 * - `wrapped-by`: the guard WRAPS the handler, so the handler must BE the call (`export const POST =
 *   withWebhookSecret(…)`). Reaching the guard somewhere inside is not enough.
 * - `calls`: the reason rests on a port call the handler makes, so the handler must reach that call.
 * - `opens-with-simulated-404`: the handler's FIRST statement is `if (!isSimulated) return …`.
 *
 * What a gate does NOT promise: it proves the exempted route is the KIND of route the reason
 * describes, not that the reason's full claim holds. `llm.complete(` proves a handler is the
 * model-calling route; it cannot prove the route persists nothing. The gates are strongest where the
 * reason is mechanical (a simulated-mode 404, a signature wrapper, a self-only port call) and weakest
 * where it is about intent. See ADR-0012 for the trade-off in full.
 */
const SIMULATED_404: Gate = { kind: 'opens-with-simulated-404' }

// No `service/` entry, deliberately. A service caller used to be exempt here as "org-scoped by
// construction"; it is now a MACHINE actor (keel/core/abilities `MachineActor`) and its mutations call
// authorize(...) like any other route, so the per-action check replaced the blanket one (ADR-0012
// addendum, 2026-11-16). The fixture's service/jobs/route.ts is that machine route. What the old entry
// ALSO guaranteed (that a service route verifies its caller) is kept, below.
const EXEMPT_PREFIXES: Record<string, Exemption> = {
    'webhooks/': {
        reason:
            'authenticated by a machine caller, not a user session — a shared webhook secret ' +
            '(withWebhookSecret) or the Mailgun inbound signature (withMailgunSignature) — so no ' +
            'per-actor ability applies',
        mustMatch: { kind: 'wrapped-by', callees: ['withWebhookSecret', 'withMailgunSignature'] },
    },
    'simulator/': {
        reason: 'simulated-world surface, simulated-mode-gated (404 in real) — never a product mutation path',
        mustMatch: SIMULATED_404,
    },
}

const EXEMPT_FILES: Record<string, Exemption> = {
    'profile/route.ts': {
        reason: 'self-service: the subject is the caller (User.update is self-only), no cross-actor authorization',
        // The port call that MAKES it self-only: updateProfile takes no user id, so a route that
        // updates another user by id cannot be written through it and cannot inherit this exemption.
        mustMatch: { kind: 'calls', callees: ['auth.updateProfile'] },
    },
    'assistant/route.ts': {
        reason:
            'stateless LLM call — creates no persisted, org-scoped resource to authorize. Any read tool it ' +
            "exposes stays inside the caller's OWN active-org scope (filtered inside withTenant by the " +
            'handler-resolved orgId, the same scope as that app’s own list route) — no per-actor product mutation',
        mustMatch: { kind: 'calls', callees: ['llm.complete', 'llm.stream', 'llm.runToolLoop'] },
    },
    'analytics/page-view/route.ts': {
        reason: 'telemetry beacon — records a page view, mutates no product resource',
        mustMatch: { kind: 'calls', callees: ['analytics.capture'] },
    },
    'auth/org/route.ts': {
        reason: 'setActiveOrg enforces membership at the auth port (ForbiddenError for non-members)',
        mustMatch: { kind: 'calls', callees: ['auth.setActiveOrg'] },
    },
    'auth/signout/route.ts': {
        reason: 'session lifecycle (sign-out) — no product resource, runs post-authz',
        mustMatch: { kind: 'calls', callees: ['auth.signOut'] },
    },
    'auth/dev-signin/route.ts': {
        reason: 'session lifecycle (dev sign-in) — pre-authz by definition, simulated-mode only',
        mustMatch: SIMULATED_404,
    },
    'auth/accept-invite/route.ts': {
        reason: 'invite acceptance is authorized by possession of the invite token, before any membership exists',
        mustMatch: { kind: 'calls', callees: ['acceptInvite'] },
    },
    'storage-upload/route.ts': {
        reason:
            'simulated-mode-only (404 in real) multipart upload endpoint — the local twin of an S3 presigned POST, ' +
            'authenticated by the server-signed HMAC upload-target fields (like the webhook secret), NOT a user ' +
            'session; the upload TARGET was already authorized by the app route that minted it',
        mustMatch: SIMULATED_404,
    },
}

/**
 * Gates a mutating handler under a prefix must pass IN ADDITION to reaching authorize(...). Authorizing an
 * actor means something only if the actor came from a verified credential: `authorize(` alone is satisfied
 * just as well by a `{ kind: 'machine', credential: { kind: 'service-key' } … }` literal built from the
 * request. So a service handler must also BE the wrapper call that verifies its caller and BUILDS that
 * actor. Matched by relative path in every root, like the exemptions, and backed by a fixture route.
 */
const REQUIRED_ALONGSIDE: Record<string, Exemption> = {
    'service/': {
        reason:
            'a service route verifies its caller with withServiceCaller, which builds the machine actor ' +
            '(ctx.actor) the route should authorize. The gate proves the wrapper is the handler, not that the ' +
            'actor authorized is the one it built (ADR-0012: a gate proves the KIND of route)',
        mustMatch: { kind: 'wrapped-by', callees: ['withServiceCaller'] },
    },
}

/**
 * What the failure says to a route whose caller is not a session, because that is where an author is
 * most likely to look for an exemption, and since 2026-11-16 there is none to find: `service/` routes
 * used to be exempt, and an adopter's old one fails here on taking the update.
 */
const NON_SESSION_HINT =
    'A caller that is not a session authorizes its actor with the three-argument form, ' +
    'authorize(actor, action, subject): a service key via abilityActorFromService (withServiceCaller passes it as ' +
    'ctx.actor), a machine the app verifies via machineActor, or a person holding a non-session credential (a ' +
    'personal API token) via abilityActorFromCredential. The `service/` exemption was retired (ADR-0012 addendum, 2026-11-16).'

const POLICY: ScanPolicy = {
    exemptPrefixes: EXEMPT_PREFIXES,
    exemptFiles: EXEMPT_FILES,
    requiredAlongside: REQUIRED_ALONGSIDE,
    hint: NON_SESSION_HINT,
}

describe('every mutating API route is authorized', () => {
    const routes = scanRoutes(ROOTS)
    const mutating = routes.filter((route) => route.handlers.length > 0)
    /** Mutating routes contributed by the FIXTURE root — what the exemption map is checked against. */
    const fixture = mutating.filter((route) => route.root === 'keel/test-fixture')
    const fixtureRels = new Set(fixture.map((route) => route.rel))

    it.each(ROOTS.map((root) => root.label))('%s is really walked (guards against a broken walk)', (label) => {
        // Per root, not in aggregate: a mis-resolved root finds nothing and would otherwise hide
        // behind the other roots' results, which is exactly the vacuous pass this case exists to
        // prevent. ROUTE FILES, not mutating ones: an app may legitimately be read-only (a reporting
        // dashboard, an app mid-build), and demanding a mutation from every app root would fail a
        // FRAMEWORK test for an app that has done nothing wrong. Non-vacuity of the exemption
        // machinery is the FIXTURE root's job — the case below — and that root is package-relative,
        // so it is present in every checkout no matter which apps exist.
        expect(routes.filter((route) => route.root === label).length, label).toBeGreaterThan(0)
    })

    it('the fixture root contributes mutating routes (nothing below is vacuous)', () => {
        expect(fixtureRels.size).toBeGreaterThan(0)
    })

    it('the fixture tree still carries a route for every invariant this scan asserts', () => {
        // Named explicitly so a rename inside the fixture cannot quietly retire an invariant: an
        // authorized product mutation, a file whose two verbs are judged separately (one through a same-file
        // helper), a framework membership mutation, a MACHINE mutation (a service caller, authorized with its
        // machine actor rather than exempted), and one route per gated prefix. The exemption-staleness cases
        // below cover the EXEMPT_FILES half.
        for (const rel of [
            'dockets/route.ts',
            'dockets/[id]/route.ts',
            'org/invite/route.ts',
            'service/jobs/route.ts',
            'webhooks/jobs/route.ts',
            'simulator/reset/route.ts',
        ]) {
            expect([...fixtureRels], rel).toContain(rel)
        }
        const perVerb = fixture.find((route) => route.rel === 'dockets/[id]/route.ts')
        expect(perVerb?.handlers.map((handler) => handler.verb)).toEqual(['PATCH', 'DELETE'])
    })

    it('at least one mutating handler is NON-exempt and genuinely reaches authorize(...)', () => {
        // Without this the whole suite could pass vacuously: if every mutating route were exempt,
        // each per-handler case below would take the exemption branch and never check anything.
        const enforced = mutating.filter(
            (route) =>
                !exemptionFor(POLICY, route.rel) && route.handlers.some((handler) => handler.facts?.reachesAuthorize),
        )
        expect(enforced.length).toBeGreaterThan(0)
    })

    for (const route of mutating) {
        for (const handler of route.handlers) {
            it(`${route.root}: ${route.rel} ${handler.verb} reaches authorize(...) or passes its exemption's gate`, () => {
                // Exempt: the gate the reason rests on must hold for THIS handler, in THIS root, so an app
                // route never inherits an exemption on the strength of its path alone, and one verb's gate
                // never covers another's.
                expect(judge(route, handler, POLICY)).toBeUndefined()
            })
        }
    }

    it('every exemption carries a checkable gate', () => {
        // The type already requires `mustMatch`, but a type is not present at run time and this map
        // is the one place where forgetting it costs an authorization bypass in someone ELSE's app:
        // an exemption is matched by relative path in every root, so a gateless entry would exempt
        // any adopter route that happened to sit at that path. Belt and braces, deliberately.
        for (const [rel, exemption] of [
            ...Object.entries(EXEMPT_FILES),
            ...Object.entries(EXEMPT_PREFIXES),
            ...Object.entries(REQUIRED_ALONGSIDE),
        ]) {
            expect(
                isGate(exemption.mustMatch),
                `exemption for ${rel} has no checkable mustMatch — a bare exemption exempts that path in EVERY root, ` +
                    `including an adopter's app. Name the gate the reason rests on, or drop the exemption.`,
            ).toBe(true)
            expect(exemption.reason.length, rel).toBeGreaterThan(0)
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

    it('has no stale required-alongside gates (each covers a mutating route in the fixture tree)', () => {
        for (const prefix of Object.keys(REQUIRED_ALONGSIDE)) {
            expect(
                [...fixtureRels].some((rel) => rel.startsWith(prefix)),
                `required gate ${prefix} covers no mutating route in packages/keel/test-fixture/api`,
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

/** A runtime check of the `Gate` shape: the map is data, and a type is not present when the suite runs. */
function isGate(gate: unknown): boolean {
    if (typeof gate !== 'object' || gate === null || !('kind' in gate)) return false
    if (gate.kind === 'opens-with-simulated-404') return true
    if (gate.kind !== 'wrapped-by' && gate.kind !== 'calls') return false
    return (
        'callees' in gate &&
        Array.isArray(gate.callees) &&
        gate.callees.length > 0 &&
        gate.callees.every((callee) => typeof callee === 'string' && callee.length > 0)
    )
}

/**
 * The route shapes that PASSED the text-matching scan this replaced (ADR-0012 addendum, 2026-11-17), judged
 * against the real policy above. Each was dropped into an app's api tree and run through the old scan, which
 * passed every `fails` row below; the first two rows of the webhook group are the ones that review found
 * (`.claude/future-tasks/resolved/authz-scan-exemption-matches-text-not-verbs.md`), the rest are the same flaw
 * in the main rule, in the `service/` gate and in the `simulator/` gate.
 */
describe('the shapes the text-matching scan passed now fail', () => {
    const AUTHORIZE = "import { authorize } from 'keel/authz/authorize'\n"
    const CREATE = "authorize(user, 'depot', 'create', { type: 'Docket', orgId: 'depot' })"
    const cases: Array<{ name: string; rel: string; src: string; fails: string[] }> = [
        {
            name: 'a webhook route wrapped by its guard (the real shape) passes',
            rel: 'webhooks/repro/route.ts',
            src: "import { withWebhookSecret } from '../respond'\nexport const POST = withWebhookSecret(async () => Response.json({}))\n",
            fails: [],
        },
        {
            name: "the guard's name in a string, and an open POST",
            rel: 'webhooks/repro/route.ts',
            src: "const why = 'withWebhookSecret('\nexport const POST = async () => Response.json({ why })\n",
            fails: ['POST'],
        },
        {
            name: 'a guarded POST beside an unguarded DELETE',
            rel: 'webhooks/repro/route.ts',
            src:
                "import { withWebhookSecret } from '../respond'\nexport const POST = withWebhookSecret(async () => Response.json({}))\n" +
                'export async function DELETE() { return Response.json({ open: true }) }\n',
            fails: ['DELETE'],
        },
        {
            name: "the guard's name only in a comment (failed before too)",
            rel: 'webhooks/repro/route.ts',
            src: '// withWebhookSecret(\nexport const POST = async () => Response.json({})\n',
            fails: ['POST'],
        },
        {
            name: "'authorize(' in a string, and an open POST",
            rel: 'repro/route.ts',
            src: "const why = 'authorize('\nexport async function POST() { return Response.json({ why }) }\n",
            fails: ['POST'],
        },
        {
            name: 'an authorized POST beside an open DELETE',
            rel: 'repro/route.ts',
            src:
                `${AUTHORIZE}declare const user: never\nexport async function POST() { ${CREATE}; return Response.json({}) }\n` +
                'export async function DELETE() { return Response.json({ open: true }) }\n',
            fails: ['DELETE'],
        },
        {
            name: 'authorize(...) under `if (false)`',
            rel: 'repro/route.ts',
            src: `${AUTHORIZE}declare const user: never\nexport async function POST() { if (false) ${CREATE}; return Response.json({}) }\n`,
            fails: ['POST'],
        },
        {
            name: 'authorize(...) after the return',
            rel: 'repro/route.ts',
            src: `${AUTHORIZE}declare const user: never\nexport async function POST() { return Response.json({}); ${CREATE} }\n`,
            fails: ['POST'],
        },
        {
            name: 'authorize(...) in a function the handler never calls',
            rel: 'repro/route.ts',
            src:
                `${AUTHORIZE}declare const user: never\n` +
                `export async function POST() { const check = () => ${CREATE}; return Response.json({ check: typeof check }) }\n`,
            fails: ['POST'],
        },
        {
            name: 'authorize(...) only in the GET beside an open POST',
            rel: 'repro/route.ts',
            src:
                `${AUTHORIZE}declare const user: never\nexport async function GET() { ${CREATE}; return Response.json({}) }\n` +
                'export async function POST() { return Response.json({ open: true }) }\n',
            fails: ['POST'],
        },
        {
            name: 'a service route naming withServiceCaller only in a string',
            rel: 'service/repro/route.ts',
            src: `${AUTHORIZE}declare const user: never\nconst note = 'withServiceCaller('\nexport async function POST() { ${CREATE}; return Response.json({ note }) }\n`,
            fails: ['POST'],
        },
        {
            name: 'a wrapped service POST beside an unwrapped PATCH',
            rel: 'service/repro/route.ts',
            src:
                `${AUTHORIZE}import { withServiceCaller } from '../../respond'\ndeclare const user: never\n` +
                `export const POST = withServiceCaller(async () => { ${CREATE}; return Response.json({}) })\n` +
                `export async function PATCH() { ${CREATE}; return Response.json({}) }\n`,
            fails: ['PATCH'],
        },
        {
            name: 'a simulator route whose 404 gate guards POST only, beside an open DELETE',
            rel: 'simulator/repro/route.ts',
            src:
                "import { isSimulated } from 'keel/adapters/index'\n" +
                'export async function POST() { if (!isSimulated) return new Response(null, { status: 404 }); return Response.json({}) }\n' +
                'export async function DELETE() { return Response.json({ open: true }) }\n',
            fails: ['DELETE'],
        },
        {
            name: 'a simulator route naming its gate only in a string',
            rel: 'simulator/repro/route.ts',
            src: "const note = 'if (!isSimulated)'\nexport async function POST() { return Response.json({ note }) }\n",
            fails: ['POST'],
        },
        {
            name: 'a webhook route wrapped by a local look-alike of its guard',
            rel: 'webhooks/repro/route.ts',
            src: 'const withWebhookSecret = (h: unknown) => h\nexport const POST = withWebhookSecret(async () => Response.json({ open: true }))\n',
            fails: ['POST'],
        },
        {
            name: 'a simulator route whose isSimulated is a local constant',
            rel: 'simulator/repro/route.ts',
            src:
                'const isSimulated = true\n' +
                'export async function POST() { if (!isSimulated) return new Response(null, { status: 404 }); return Response.json({}) }\n',
            fails: ['POST'],
        },
        {
            name: 'a simulator route whose real-mode branch mutates before the 404',
            rel: 'simulator/repro/route.ts',
            src:
                "import { isSimulated } from 'keel/adapters/index'\ndeclare const db: { wipe(): Promise<void> }\n" +
                'export async function POST() { if (!isSimulated) { await db.wipe(); return new Response(null, { status: 404 }) } return Response.json({}) }\n',
            fails: ['POST'],
        },
    ]

    it.each(cases)('$name', ({ rel, src, fails }) => {
        const dir = makeTestTmpDir('authz-repro-')
        mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
        writeFileSync(path.join(dir, rel), src)
        const [route] = scanRoutes([{ label: 'repro', dir, exemptDir: dir }])
        expect(route?.rel).toBe(rel)
        const failing = route!.handlers.filter((handler) => judge(route!, handler, POLICY) !== undefined)
        expect(failing.map((handler) => handler.verb)).toEqual(fails)
        // The handlers that pass are checked too, so a case cannot pass by the scan finding no handler at all.
        expect(route!.handlers.length).toBeGreaterThan(0)
    })
})
