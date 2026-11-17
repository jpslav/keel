import { describe, expect, it } from 'vitest'
import { APP, type Fence, fired, GET_DB, GET_DB_COMPUTED, GET_DB_DESTRUCTURE, lint } from './lint-text'

/**
 * The tenancy ban (ADR-0004): request-path code never takes the raw db handle, so every tenant-scoped
 * query goes through db.withTenant() and RLS tenant context is always set. Three selectors carry it
 * (eslint.config.mjs, `getDbSelectors`), one per way of naming `getDb`, and every block that bans it
 * has to list all three, because a later no-restricted-syntax block REPLACES an earlier one for the
 * files both match. One block listed two: the a11y block, the last one for every route, page and
 * component, left out the computed form, and `db['getDb']()` passed lint in a route handler.
 *
 * So this file pins every FORM in every ZONE the ban covers, not one form in one zone. The forms are
 * written as plain JavaScript so the same code lints as `.ts` and as `.mjs`; ./extensions.test.ts runs
 * the ban across all eight extensions.
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

/** Every place the ban holds: an app's request path, keel's screens, and keel's own app-shaped fixture. */
const BANNED = [
    `${APP}/src/app/api/kv/route.ts`,
    `${APP}/src/app/[locale]/kv/page.tsx`,
    `${APP}/src/components/kv-card.tsx`,
    `${APP}/src/domain/kv.ts`,
    `${APP}/src/jobs/publish-kv.ts`,
    'packages/keel/src/components/kv-panel.tsx',
    'packages/keel/test-fixture/api/kv/route.ts',
    'packages/keel/test-fixture/domain/kv.ts',
    // Under routes and screens the ban holds for their tests and stories too (domain/ and jobs/ exempt tests).
    `${APP}/src/components/kv-card.test.tsx`,
    `${APP}/src/components/kv-card.stories.tsx`,
]

describe('getDb: request-path code may not take the raw db handle, in any form', () => {
    describe.each(BANNED)('%s', (file) => {
        it.each(FORMS)('%s', async (_form, code, fence) => {
            expect(fired(await lint(file, code), fence)).toBe(1)
        })
    })

    // A server action is a request path with no route file in front of it: Next runs it on a POST to the
    // page that renders it. It lives in the route tree here, so the ban the tree's other files get is its
    // ban too. (One kept outside app/, components/, domain/ and jobs/ would get no getDb ban at all.)
    it.each(FORMS)("a 'use server' action may not reach it either (%s)", async (_form, code, fence) => {
        expect(fired(await lint(`${APP}/src/app/[locale]/kv/actions.ts`, `'use server'\n${code}`), fence)).toBe(1)
    })

    it('a test under domain/ may, to arrange a case (and only a file vitest runs is a test)', async () => {
        const code = 'export const load = (db) => db.getDb()\n'
        expect(fired(await lint(`${APP}/src/domain/kv.test.ts`, code), GET_DB)).toBe(0)
        expect(fired(await lint(`${APP}/src/domain/kv.test.mjs`, code), GET_DB)).toBe(1)
    })

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

    it('keel’s own db helpers may: they are the keel/db helper the ban’s message sends request paths to', async () => {
        expect(
            fired(await lint('packages/keel/src/db/kv.ts', 'export const load = (db) => db.getDb()\n'), GET_DB),
        ).toBe(0)
    })
})
