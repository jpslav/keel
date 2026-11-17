import { describe, expect, it } from 'vitest'
import { APP, type Fence, fired, GET_DB, GET_DB_COMPUTED, GET_DB_DESTRUCTURE, lint } from './lint-text'

/**
 * The tenancy ban (ADR-0004): no module in an app's src/, in keel's screens or in keel's fixture takes the
 * raw db handle, so every tenant-scoped query goes through db.withTenant() and RLS tenant context is always
 * set. It is deny-by-default (eslint.config.mjs, `keel/no-raw-db-handle`): it used to name directories, and
 * a 'use server' action in src/actions or src/lib served requests with no ban at all. It is also its own
 * rule id: as no-restricted-syntax selectors, re-listed block by block, it once lost its computed form for
 * every route, page and component, because a later block's list REPLACES an earlier one for a file.
 *
 * So this file pins every FORM in every ZONE, a directory nobody has made yet included, and each named
 * exception. The forms are written as plain JavaScript so the same code lints as `.ts` and as `.mjs`;
 * ./extensions.test.ts runs the ban across all eight extensions.
 */
const FORMS: [string, string, Fence][] = [
    ['a method call', 'export const load = (db) => db.getDb()\n', GET_DB],
    ['a bound method', 'export const load = (db) => db.getDb.bind(db)\n', GET_DB],
    ['computed access', "export const load = (db) => db['getDb']()\n", GET_DB_COMPUTED],
    ['computed access with a template literal', 'export const load = (db) => db[`getDb`]()\n', GET_DB_COMPUTED],
    ['optional computed access', "export const load = (db) => db?.['getDb']()\n", GET_DB_COMPUTED],
    [
        'destructuring',
        'export const load = (db) => {\n    const { getDb } = db\n    return getDb()\n}\n',
        GET_DB_DESTRUCTURE,
    ],
    [
        'destructuring a quoted key',
        "export const load = (db) => {\n    const { 'getDb': raw } = db\n    return raw()\n}\n",
        GET_DB_DESTRUCTURE,
    ],
    ['destructuring a parameter', 'export const load = ({ getDb }) => getDb()\n', GET_DB_DESTRUCTURE],
]

/** Every kind of place the ban holds: all of an app's src/, keel's screens, and keel's app-shaped fixture. */
const BANNED = [
    // the directories it used to name
    `${APP}/src/app/api/kv/route.ts`,
    `${APP}/src/app/[locale]/kv/page.tsx`,
    `${APP}/src/components/kv-card.tsx`,
    `${APP}/src/domain/kv.ts`,
    `${APP}/src/jobs/publish-kv.ts`,
    // the ones it did not
    `${APP}/src/lib/kv.ts`,
    `${APP}/src/ports/kv.ts`,
    `${APP}/src/app-config/jobs.ts`,
    `${APP}/src/seed/world.ts`,
    `${APP}/src/demo-static/app.tsx`,
    `${APP}/src/adapters/index.ts`,
    `${APP}/src/adapters/fake/kv.ts`,
    `${APP}/src/adapters/real/kv.ts`,
    `${APP}/src/proxy.ts`,
    `${APP}/src/instrumentation.ts`,
    // and one nobody has made yet: deny-by-default means a new directory is inside before anyone thinks of it
    `${APP}/src/anything-new/kv.ts`,
    'packages/keel/src/components/kv-panel.tsx',
    'packages/keel/src/demo-static/shell.tsx',
    'packages/keel/test-fixture/api/kv/route.ts',
    'packages/keel/test-fixture/domain/kv.ts',
    // Under routes, screens and the fixture the ban holds for tests and stories too.
    `${APP}/src/components/kv-card.test.tsx`,
    `${APP}/src/app/api/kv/route.test.ts`,
    'packages/keel/src/components/kv-panel.test.tsx',
    'packages/keel/test-fixture/api/kv/route.test.ts',
    `${APP}/src/components/kv-card.stories.tsx`,
]

describe('getDb: no app module, keel screen or fixture file takes the raw db handle, in any form', () => {
    describe.each(BANNED)('%s', (file) => {
        it.each(FORMS)('%s', async (_form, code, fence) => {
            expect(fired(await lint(file, code), fence)).toBe(1)
        })
    })

    // A server action is a request path with no route file in front of it: Next runs it on a POST to the
    // page that renders it. Wherever it is kept, the ban is its ban too: in the route tree, and in the
    // src/actions or src/lib that the directory-named ban used to leave open.
    it.each([`${APP}/src/app/[locale]/kv/actions.ts`, `${APP}/src/actions/kv.ts`, `${APP}/src/lib/tickets/actions.ts`])(
        "a 'use server' action in %s may not reach it either",
        async (file) => {
            for (const [form, code, fence] of FORMS) {
                expect(fired(await lint(file, `'use server'\n${code}`), fence), form).toBe(1)
            }
        },
    )
})

// The exceptions, each with the reason eslint.config.mjs gives for it.
describe('getDb: the named exceptions', () => {
    const rawCall = 'export const load = (db) => db.getDb()\n'

    // A test arranging a case is not a request path; this is the domain/ and jobs/ suites' own pattern.
    it.each([`${APP}/src/domain/kv.test.ts`, `${APP}/src/jobs/publish-kv.test.ts`, `${APP}/src/lib/kv.test.ts`])(
        'a test outside routes and screens may: %s',
        async (file) => {
            expect(fired(await lint(file, rawCall), GET_DB)).toBe(0)
        },
    )

    it('only a file vitest runs is a test: a .test.mjs is an ordinary module', async () => {
        expect(fired(await lint(`${APP}/src/domain/kv.test.mjs`, rawCall), GET_DB)).toBe(1)
    })

    // keel's own src/ outside its screens is outside the zone: it is what opens withTenant.
    it.each([
        'packages/keel/src/db/kv.ts',
        'packages/keel/src/server-lib/kv.ts',
        'packages/keel/src/adapters/real/db.ts',
    ])('keel’s own %s may: it is the keel/db helper the ban’s message sends request code to', async (file) => {
        expect(fired(await lint(file, rawCall), GET_DB)).toBe(0)
    })
})

describe('getDb: what the selectors match', () => {
    // A template key is the name only when it has no expressions: this one is `getDbRaw`.
    it('a template key with an expression in it is not getDb', async () => {
        const code = "export const load = (db) => db[`getDb${''}Raw`]()\n"
        expect(fired(await lint(`${APP}/src/app/api/kv/route.ts`, code), GET_DB_COMPUTED)).toBe(0)
    })

    // In a computed access an identifier is a variable, not the name, so the computed selector leaves it
    // out (eslint.config.mjs, quotedKey). The dot selector still sees it, once.
    it('db[getDb] with getDb a variable is reported once, not twice', async () => {
        const code = "const getDb = 'withTenant'\nexport const load = (db) => db[getDb]()\n"
        const findings = await lint(`${APP}/src/app/api/kv/route.ts`, code)
        expect(fired(findings, GET_DB_COMPUTED)).toBe(0)
        expect(fired(findings, GET_DB)).toBe(1)
    })
})
