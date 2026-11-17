import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contractApps } from '../support/contract-apps'
import { contractDatabaseName } from '../support/contract-postgres'
import {
    appNames,
    callsDefineContractSuite,
    citedCutoverRows,
    cutoverRows,
    leafPaths,
    readAppFacts,
    scaffoldProblems,
    type AppFacts,
} from '../support/app-scaffold'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Every app keeps its own deployment parameters and its own contract suite (tests/support/app-scaffold.ts). The first
 * block is the gate on THIS repo's apps; the rest proves the gate can fail, on synthetic apps, so a rule that has only
 * ever passed is not what the first block rests on.
 */
describe('the apps in this repo', () => {
    it('each carries config/params.ts of one shape, citing cutover rows that exist, and a contract suite for its migrations', async () => {
        const apps = await Promise.all(appNames(REPO_ROOT).map((name) => readAppFacts(REPO_ROOT, name)))
        const checklist = readFileSync(path.join(REPO_ROOT, 'docs', 'cutover-checklist.md'), 'utf8')
        expect(apps.length).toBeGreaterThan(0)
        expect(scaffoldProblems(apps, cutoverRows(checklist))).toEqual([])
    })

    it('has a contract project for every app that has a contract suite', async () => {
        const discovered = contractApps(REPO_ROOT)
        const withSuites = (await Promise.all(appNames(REPO_ROOT).map((name) => readAppFacts(REPO_ROOT, name))))
            .filter((app) => app.contractSuites.length > 0)
            .map((app) => app.name)
        expect(discovered).toEqual(withSuites)
        // not empty: an app with migrations and no suite is scaffoldProblems's finding, and this is what it rests on
        expect(discovered.length).toBeGreaterThan(0)
    })
})

describe('contractDatabaseName', () => {
    it.each([
        ['starter', 'starter_contract'],
        ['showcase', 'showcase_contract'],
        ['acme-corp', 'acme_corp_contract'],
        ['Acme.Corp 2', 'acme_corp_2_contract'],
        ['2fast', 'app_2fast_contract'],
    ])('names the database of %s %s', (slug, database) => {
        expect(contractDatabaseName(slug)).toBe(database)
    })

    it('fits Postgres identifiers however long the slug', () => {
        expect(contractDatabaseName('a'.repeat(200)).length).toBeLessThanOrEqual(63)
    })

    it('gives two different slugs two different databases', () => {
        expect(contractDatabaseName('one-app')).not.toBe(contractDatabaseName('two-app'))
    })
})

describe('scaffoldProblems fails when an app is missing what it must carry', () => {
    const rows = new Set(['cloud-accounts', 'auth-dev'])
    const params = ['aws.region', 'database.transport']
    const app = (over: Partial<AppFacts>): AppFacts => {
        const name = over.name ?? 'one'
        return {
            name,
            paramsKeys: params,
            paramsSource: '// cutover: cloud-accounts\n',
            hasMigrations: true,
            contractSuites: ['rls-contract.test.ts'],
            contractDatabase: `${name}_contract`,
            ...over,
        }
    }

    it('passes a complete app, and two apps of one shape', () => {
        expect(scaffoldProblems([app({})], rows)).toEqual([])
        expect(scaffoldProblems([app({}), app({ name: 'two' })], rows)).toEqual([])
    })

    it('flags an app with no params.ts', () => {
        expect(scaffoldProblems([app({ paramsKeys: null, paramsSource: null })], rows)).toEqual([
            expect.stringMatching(/apps\/one: no config\/params.ts/),
        ])
    })

    it('flags a params.ts whose shape differs from another app’s, in both directions', () => {
        const problems = scaffoldProblems(
            [app({}), app({ name: 'two', paramsKeys: ['aws.region', 'mailgun.domain'] })],
            rows,
        )
        expect(problems).toEqual([
            expect.stringMatching(/apps\/two: config\/params.ts lacks database.transport, which apps\/one's has/),
            expect.stringMatching(/apps\/two: config\/params.ts has mailgun.domain, which apps\/one's lacks/),
        ])
    })

    it('flags a cutover row that the checklist has no row for', () => {
        expect(
            scaffoldProblems([app({ paramsSource: '// cutover: no-such-row — x\n// cutover: auth-dev\n' })], rows),
        ).toEqual([expect.stringMatching(/cites cutover row "no-such-row"/)])
    })

    it('flags an app that registers migrations and has no contract suite, and lets one without migrations pass', () => {
        expect(scaffoldProblems([app({ contractSuites: [] })], rows)).toEqual([
            expect.stringMatching(/apps\/one: registers migrations but has no contract suite/),
        ])
        expect(scaffoldProblems([app({ contractSuites: [], hasMigrations: false })], rows)).toEqual([])
    })
})

describe('scaffoldProblems fails when two suites would share a database, or take keel’s', () => {
    const rows = new Set<string>()
    const app = (name: string, contractDatabase: string | null): AppFacts => ({
        name,
        paramsKeys: [],
        paramsSource: '',
        hasMigrations: false,
        contractSuites: [],
        contractDatabase,
    })

    it('flags two apps whose slugs fold to one database name, once', () => {
        // `acme-corp` and `acme_corp` are two slugs and one database: on CI's one server their migrations would meet.
        const same = contractDatabaseName('acme-corp')
        expect(same).toBe(contractDatabaseName('acme_corp'))
        expect(scaffoldProblems([app('acme-corp', same), app('acme_corp', same)], rows)).toEqual([
            expect.stringMatching(
                /apps\/acme-corp and apps\/acme_corp: contract database "acme_corp_contract" is the same/,
            ),
        ])
    })

    it('flags an app whose database would be keel’s own, and lets other names pass', () => {
        expect(scaffoldProblems([app('keel-data-api', contractDatabaseName('keel-data-api'))], rows)).toEqual([
            expect.stringMatching(
                /apps\/keel-data-api: contract database "keel_data_api_contract" starts with "keel_"/,
            ),
        ])
        expect(scaffoldProblems([app('one', 'one_contract'), app('two', 'two_contract')], rows)).toEqual([])
    })
})

describe('the helpers behind it', () => {
    it('callsDefineContractSuite counts a call and not a mention in a comment', () => {
        expect(callsDefineContractSuite("defineContractSuite({ database: 'x' })")).toBe(true)
        expect(
            callsDefineContractSuite('// defineContractSuite(...) is what it calls\n/* defineContractSuite( */'),
        ).toBe(false)
        expect(callsDefineContractSuite('/**\n * defineContractSuite(\n */\nexport {}')).toBe(false)
    })

    it('leafPaths reads every leaf of nested params, sorted', () => {
        expect(leafPaths({ b: { y: 'x', x: 'x' }, a: 'x' })).toEqual(['a', 'b.x', 'b.y'])
    })

    it('cutoverRows reads the backticked ids of a checklist table, whatever the status glyph', () => {
        const table = [
            '| Status | Item | What |',
            '| --- | --- | --- |',
            '| ⬜ | `auth-dev` | x |',
            '| ✅ | `cloud-accounts` | y |',
        ].join('\n')
        expect([...cutoverRows(table)].sort()).toEqual(['auth-dev', 'cloud-accounts'])
    })

    it('citedCutoverRows takes the first id of each comment', () => {
        expect(
            citedCutoverRows(
                '// cutover: auth-dev (development), auth-prod (production)\n// cutover: errors — the DSN',
            ),
        ).toEqual(['auth-dev', 'errors'])
    })
})
