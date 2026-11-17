import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { contractDatabaseName } from './contract-postgres'

/**
 * What every app in `apps/*` must carry to be a template an adopter can keep, checked the same way for all of them:
 * the deployment parameters the cutover rows point at, and a contract suite for its migrations. These were once the
 * two things `pnpm init-app --eject-showcase` copied out of the showcase before deleting it, because only the
 * showcase had them; each app owns them now, and these are the gates that say so. Generic over apps and
 * deliberately free of any one app's content, so the conformance kit (ADR-0014, P5) can take it as it is.
 */

export interface AppFacts {
    name: string
    /** The dotted key path of every leaf of `config/params.ts`'s `params`, or null when the file is absent. */
    paramsKeys: string[] | null
    /** The source of `config/params.ts`, for the cutover rows it cites. */
    paramsSource: string | null
    /** Whether the app registers migrations of its own. */
    hasMigrations: boolean
    /** The app's `tests/contract/*.test.ts` files that call `defineContractSuite`. */
    contractSuites: string[]
    /** The database its contract suite uses (`contractDatabaseName` of its `config/app.ts` slug), or null with no slug. */
    contractDatabase: string | null
}

/** The prefix of keel's own contract databases (`keel_contract`, `keel_data_api_contract`, `keel_data_api_lock`), which
 *  no app's may start with: the framework's fixture runs on the same server. */
const FRAMEWORK_DATABASE_PREFIX = 'keel_'

/** Whether a source CALLS `defineContractSuite(`: a mention in a comment is not a call. */
export function callsDefineContractSuite(source: string): boolean {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    return code.includes('defineContractSuite(')
}

/** Every leaf of a value as a dotted path: `{ a: { b: 'x' } }` is `['a.b']`. */
export function leafPaths(value: unknown, prefix = ''): string[] {
    if (value === null || typeof value !== 'object') return prefix ? [prefix] : []
    return Object.entries(value)
        .flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key))
        .sort()
}

/** The row ids of docs/cutover-checklist.md: the backticked name in each table row's second cell. */
export function cutoverRows(checklist: string): Set<string> {
    const rows = new Set<string>()
    for (const line of checklist.split('\n')) {
        const row = /^\|\s*[^|]*\|\s*`([a-z0-9][a-z0-9-]*)`\s*\|/.exec(line)
        if (row) rows.add(row[1]!)
    }
    return rows
}

/** The row each `// cutover: <row>` comment of a params file names. (The first id of a comment: a second one in the same
 *  comment, as in "auth-dev (…), auth-prod (…)", is prose.) */
export function citedCutoverRows(paramsSource: string): string[] {
    return [...paramsSource.matchAll(/cutover:\s*([a-z0-9][a-z0-9-]*)/g)].map((match) => match[1]!)
}

export function scaffoldProblems(apps: readonly AppFacts[], rows: ReadonlySet<string>): string[] {
    const problems: string[] = []
    const withParams = apps.filter((app) => app.paramsKeys !== null)
    const reference = withParams[0]

    for (const app of apps) {
        if (app.paramsKeys === null) {
            problems.push(
                `apps/${app.name}: no config/params.ts (the deployment parameters every cutover row points at)`,
            )
        } else if (reference && reference.paramsKeys) {
            const missing = reference.paramsKeys.filter((key) => !app.paramsKeys!.includes(key))
            const extra = app.paramsKeys.filter((key) => !reference.paramsKeys!.includes(key))
            if (missing.length > 0) {
                problems.push(
                    `apps/${app.name}: config/params.ts lacks ${missing.join(', ')}, which apps/${reference.name}'s has ` +
                        '(infra reads the same keys whichever app it is pointed at)',
                )
            }
            if (extra.length > 0) {
                problems.push(
                    `apps/${app.name}: config/params.ts has ${extra.join(', ')}, which apps/${reference.name}'s lacks`,
                )
            }
        }
        for (const cited of app.paramsSource === null ? [] : citedCutoverRows(app.paramsSource)) {
            if (!rows.has(cited)) {
                problems.push(
                    `apps/${app.name}: config/params.ts cites cutover row "${cited}", which docs/cutover-checklist.md has no row for`,
                )
            }
        }
        if (app.contractDatabase !== null) {
            const sharing = apps.filter((other) => other !== app && other.contractDatabase === app.contractDatabase)
            if (sharing.length > 0 && app.name < sharing[0]!.name) {
                problems.push(
                    `apps/${app.name} and apps/${sharing.map((other) => other.name).join(', apps/')}: contract database "${app.contractDatabase}" ` +
                        'is the same for both (their slugs fold to one name), and two migration sets cannot share a database',
                )
            }
            if (app.contractDatabase.startsWith(FRAMEWORK_DATABASE_PREFIX)) {
                problems.push(
                    `apps/${app.name}: contract database "${app.contractDatabase}" starts with "${FRAMEWORK_DATABASE_PREFIX}", ` +
                        "which is keel's own fixture databases' prefix on the same server",
                )
            }
        }
        if (app.hasMigrations && app.contractSuites.length === 0) {
            problems.push(
                `apps/${app.name}: registers migrations but has no contract suite (a tests/contract/*.test.ts calling defineContractSuite), ` +
                    'so its own tables never meet real Postgres',
            )
        }
    }
    return problems
}

/** Reads one app's facts from disk. */
export async function readAppFacts(repoRoot: string, name: string): Promise<AppFacts> {
    const dir = path.join(repoRoot, 'apps', name)
    const paramsFile = path.join(dir, 'config', 'params.ts')
    let paramsKeys: string[] | null = null
    let paramsSource: string | null = null
    if (existsSync(paramsFile)) {
        paramsSource = readFileSync(paramsFile, 'utf8')
        const loaded = (await import(pathToFileURL(paramsFile).href)) as { params?: unknown }
        paramsKeys = leafPaths(loaded.params)
    }
    const slugFile = path.join(dir, 'config', 'app.ts')
    const slug = existsSync(slugFile)
        ? ((await import(pathToFileURL(slugFile).href)) as { APP_SLUG?: unknown }).APP_SLUG
        : undefined
    const migrations = path.join(dir, 'src', 'app-config', 'db', 'migrations')
    const contract = path.join(dir, 'tests', 'contract')
    return {
        name,
        paramsKeys,
        paramsSource,
        hasMigrations: existsSync(migrations) && readdirSync(migrations).some((file) => /^\d+_.+\.ts$/.test(file)),
        contractSuites: existsSync(contract)
            ? readdirSync(contract).filter(
                  (file) =>
                      file.endsWith('.test.ts') &&
                      callsDefineContractSuite(readFileSync(path.join(contract, file), 'utf8')),
              )
            : [],
        contractDatabase: typeof slug === 'string' ? contractDatabaseName(slug) : null,
    }
}

/** Every app directory under `apps/`. */
export function appNames(repoRoot: string): string[] {
    const appsDir = path.join(repoRoot, 'apps')
    return existsSync(appsDir)
        ? readdirSync(appsDir, { withFileTypes: true })
              .filter((entry) => entry.isDirectory())
              .map((entry) => entry.name)
              .sort()
        : []
}
