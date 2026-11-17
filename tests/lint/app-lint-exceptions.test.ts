import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { loadAppLintExceptions } from '../../eslint.config.mjs'
import { makeTestTmpDir } from '../support/tmp-dir'

/**
 * App-owned lint exceptions (eslint.config.mjs, loadAppLintExceptions): an app names the modules a fence
 * should let through in its own `apps/<app>/lint-exceptions.mjs`, by path relative to the app, so an adopter
 * never edits keel's eslint.config.mjs and `pnpm init-app` renaming the app cannot break an exception.
 * Everything is checked when the config loads, and anything that could widen an exception quietly fails it.
 */
const RAW_DB = 'keel/no-raw-db-handle'

/** A scratch repo root holding one app, its exceptions file, and the source files it names. */
function tree(app: string, exceptions: string, files: string[] = []): string {
    const root = makeTestTmpDir('lint-exceptions-')
    const appDir = path.join(root, 'apps', app)
    for (const file of files) {
        mkdirSync(path.dirname(path.join(appDir, file)), { recursive: true })
        writeFileSync(path.join(appDir, file), 'export const x = 1\n')
    }
    mkdirSync(appDir, { recursive: true })
    writeFileSync(path.join(appDir, 'lint-exceptions.mjs'), `export default ${exceptions}\n`)
    return root
}
const entry = (file: string, reason = 'runs as the system to purge every tenant’s expired rows') =>
    `{ ${JSON.stringify(RAW_DB)}: [{ file: ${JSON.stringify(file)}, reason: ${JSON.stringify(reason)} }] }`

describe('an app lists its own exceptions, by path relative to the app', () => {
    it('an app with no exceptions file has none', async () => {
        const root = makeTestTmpDir('lint-exceptions-')
        mkdirSync(path.join(root, 'apps', 'acme', 'src'), { recursive: true })
        expect(await loadAppLintExceptions(root)).toEqual({ [RAW_DB]: [] })
    })

    it('an entry becomes an exact path under that app, whatever the app is called', async () => {
        const file = 'src/domain/maintenance.ts'
        for (const app of ['starter', 'acme', 'pages']) {
            const loaded = await loadAppLintExceptions(tree(app, entry(file), [file]))
            expect(loaded[RAW_DB]).toEqual([`apps/${app}/${file}`])
        }
    })

    it('a Next route path is matched literally, not as a glob', async () => {
        const file = 'src/app/[locale]/admin/purge/route.ts'
        const loaded = await loadAppLintExceptions(tree('acme', entry(file), [file]))
        expect(loaded[RAW_DB]).toEqual(['apps/acme/src/app/\\[locale\\]/admin/purge/route.ts'])
        // ESLint reads the escaped path as that one file, and not as its sibling.
        const root = makeTestTmpDir('lint-exceptions-')
        const eslint = new ESLint({
            cwd: root,
            overrideConfigFile: true,
            overrideConfig: [
                { files: ['apps/*/src/**/*.ts'], ignores: loaded[RAW_DB], rules: { 'no-console': 'error' } },
            ],
        })
        const listed = await eslint.calculateConfigForFile(path.join(root, 'apps/acme', file))
        const sibling = await eslint.calculateConfigForFile(
            path.join(root, 'apps/acme/src/app/[locale]/admin/other.ts'),
        )
        expect(listed?.rules?.['no-console']).toBeUndefined()
        expect(sibling?.rules?.['no-console']).toBeDefined()
    })
})

describe('anything that could widen an exception fails the config load', () => {
    it.each([
        ['a glob', entry('src/domain/*.ts'), [], /is a glob/],
        ['a directory', entry('src/domain'), ['src/domain/maintenance.ts'], /names no file/],
        ['a file that does not exist', entry('src/domain/gone.ts'), [], /names no file/],
        ['a path out of the app', entry('src/../../other/src/x.ts'), [], /path under the app's src/],
        ['a path outside src/', entry('config/params.ts'), ['config/params.ts'], /path under the app's src/],
        ['backslashes', entry('src\\domain\\maintenance.ts'), ['src/domain/maintenance.ts'], /path under/],
        ['no reason', entry('src/domain/maintenance.ts', '  '), ['src/domain/maintenance.ts'], /needs a reason/],
        ['no file', `{ ${JSON.stringify(RAW_DB)}: [{ reason: 'purges every tenant' }] }`, [], /names no file/],
        [
            'a rule that takes no exceptions',
            `{ 'keel/no-dynamic-app-import': [{ file: 'src/x.ts', reason: 'r' }] }`,
            ['src/x.ts'],
            /takes no app exceptions/,
        ],
        [
            'entries that are not a list',
            `{ ${JSON.stringify(RAW_DB)}: 'src/x.ts' }`,
            ['src/x.ts'],
            /must map to an array/,
        ],
        ['a default export that is not an object', `['src/x.ts']`, [], /default export must be an object/],
    ])('%s', async (_case, exceptions, files, why) => {
        const root = tree('acme', exceptions, files)
        await expect(loadAppLintExceptions(root)).rejects.toThrow(/apps\/acme\/lint-exceptions\.mjs: /)
        await expect(loadAppLintExceptions(root)).rejects.toThrow(why)
    })
})

// The wiring, end to end: the repo's real config, reading a scratch tree's exceptions (KEEL_LINT_EXCEPTIONS_ROOT),
// lets the listed file through the tenancy ban and nothing else. A child process, so the config loads fresh.
describe('a listed module passes the tenancy ban, and an unlisted one still fails it', () => {
    const lintAs = (root: string, file: string) => {
        const eslintBin = path.join(process.cwd(), 'node_modules/eslint/bin/eslint.js')
        try {
            execFileSync(process.execPath, [eslintBin, '--stdin', '--stdin-filename', file, '--format', 'json'], {
                cwd: process.cwd(),
                env: { ...process.env, KEEL_LINT_EXCEPTIONS_ROOT: root },
                input: 'export const purge = (db) => db.getDb()\n',
                stdio: ['pipe', 'pipe', 'pipe'],
            })
            return []
        } catch (error) {
            const [result] = JSON.parse((error as { stdout: Buffer }).stdout.toString())
            return result.messages.map((m: { ruleId: string }) => m.ruleId)
        }
    }

    it('in a scratch app called acme', () => {
        const listed = 'src/domain/maintenance.ts'
        const root = tree('acme', entry(listed), [listed])
        expect(lintAs(root, `apps/acme/${listed}`)).not.toContain(RAW_DB)
        expect(lintAs(root, 'apps/acme/src/domain/other.ts')).toContain(RAW_DB)
    })
})
