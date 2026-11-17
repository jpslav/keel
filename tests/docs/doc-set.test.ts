import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeTestTmpDir } from '../support/tmp-dir'
import { citedPaths, generalizeAppCitations, resolves } from './doc-set'

/**
 * The citation parser's own tests, because `doc-paths.test.ts` can only ever prove that TODAY's docs
 * are consistent with TODAY's tree — it says nothing about which citation FORMS the parser can see.
 *
 * That distinction is not academic. The parser originally read a backticked span only when the whole
 * span was a path, so a path written inside a backticked command was invisible to it, and two such
 * citations rotted unnoticed while the gate stayed green. The cases below pin the forms down so a
 * later simplification of the parser has to break a test rather than a promise.
 */
function citationsIn(markdown: string) {
    const dir = makeTestTmpDir('doc-set-')
    const file = path.join(dir, 'doc.md')
    writeFileSync(file, markdown)
    return citedPaths(file).map(({ path: cited }) => cited)
}

describe('citedPaths', () => {
    it('reads a span that is itself a path', () => {
        expect(citationsIn('see `packages/keel/src/ports`')).toEqual(['packages/keel/src/ports'])
    })

    it('reads a path out of a backticked command', () => {
        expect(citationsIn('run `git diff apps/showcase/fixtures/llm/`')).toEqual(['apps/showcase/fixtures/llm'])
    })

    it('reads every path in a command, and ignores the non-path words', () => {
        expect(citationsIn('`cp docs/README.md scripts/out.md`')).toEqual(['docs/README.md', 'scripts/out.md'])
    })

    it('unwraps quoting and a ./ prefix', () => {
        expect(citationsIn(`\`pnpm --filter './apps/*' build\``)).toEqual(['apps'])
    })

    it('truncates a glob or a <metavariable> to its static prefix', () => {
        expect(citationsIn('`packages/keel/src/adapters/<real|fake>/<name>.ts`')).toEqual([
            'packages/keel/src/adapters',
        ])
    })

    it('truncates a brace expansion to its static prefix, in a span and in a command', () => {
        expect(citationsIn('`packages/keel/src/i18n/messages/{en,es}.json`')).toEqual([
            'packages/keel/src/i18n/messages',
        ])
        expect(citationsIn('`rm apps/showcase/messages/{en,es}.json`')).toEqual(['apps/showcase/messages'])
    })

    it('strips a trailing line reference, which names a place in a file and not a file', () => {
        expect(citationsIn('`docs/build-notes.md:52`')).toEqual(['docs/build-notes.md'])
        expect(citationsIn('`apps/showcase/src/app/[locale]/layout.tsx:67:9`')).toEqual([
            'apps/showcase/src/app/[locale]/layout.tsx',
        ])
    })

    it('keeps a colon that is not a line reference', () => {
        expect(citationsIn('`scripts/init-app.ts:latest`')).toEqual(['scripts/init-app.ts:latest'])
    })

    it('ignores build outputs, which depend on whether you happened to run a build', () => {
        expect(citationsIn('`rm -rf apps/showcase/.next`')).toEqual([])
    })

    it('ignores a span with no repo-rooted token', () => {
        expect(citationsIn('`pnpm install` and `--filter showcase`')).toEqual([])
    })

    it('keeps `raw` as the whole span, which is what init-app rewrites on', () => {
        const dir = makeTestTmpDir('doc-set-')
        const file = path.join(dir, 'doc.md')
        writeFileSync(file, '`pnpm --filter showcase exec vitest apps/showcase/src`')
        expect(citedPaths(file)).toEqual([
            { path: 'apps/showcase/src', raw: 'pnpm --filter showcase exec vitest apps/showcase/src', line: 1 },
        ])
    })
})

/**
 * The rewriter half, tested against the shape that broke it: several citations sharing ONE backticked
 * span. `init-app` used to rewrite per citation by replacing the span verbatim, so the first rewrite
 * made the span unfindable and every later path in it was skipped — a command left half-generalised,
 * and the doc-path gate red on the adopter's first command.
 *
 * `gone` stands in for the filesystem check `init-app` passes (`(cited) => !resolves(cited)`), so
 * these cases pin the rewriting rule without needing a tree on disk.
 */
describe('generalizeAppCitations', () => {
    const gone = (cited: string) => cited.startsWith('apps/showcase/')

    it('rewrites EVERY app path in one backticked span', () => {
        expect(
            generalizeAppCitations(
                'Run `cp apps/showcase/src/jobs/x.ts apps/showcase/src/domain/y.ts` to start.',
                gone,
            ),
        ).toBe('Run `cp apps/<app>/src/jobs/x.ts apps/<app>/src/domain/y.ts` to start.')
    })

    it('rewrites a repeated path within the span, not just its first occurrence', () => {
        expect(generalizeAppCitations('`diff apps/showcase/src/a.ts apps/showcase/src/a.ts`', gone)).toBe(
            '`diff apps/<app>/src/a.ts apps/<app>/src/a.ts`',
        )
    })

    it('rewrites every occurrence of a repeated span in the document', () => {
        expect(generalizeAppCitations('`apps/showcase/src/jobs` twice: `apps/showcase/src/jobs`', gone)).toBe(
            '`apps/<app>/src/jobs` twice: `apps/<app>/src/jobs`',
        )
    })

    it('leaves paths that still resolve alone, even beside one that does not', () => {
        expect(generalizeAppCitations('`cp apps/starter/src/a.ts apps/showcase/src/b.ts`', gone)).toBe(
            '`cp apps/starter/src/a.ts apps/<app>/src/b.ts`',
        )
    })

    it('generalises a glob citation at its static prefix', () => {
        expect(generalizeAppCitations('`apps/showcase/src/jobs/*.ts`', gone)).toBe('`apps/<app>/src/jobs/*.ts`')
    })

    it('touches nothing when every citation resolves', () => {
        const text = '`apps/starter/src` and `packages/keel/src`'
        expect(generalizeAppCitations(text, gone)).toBe(text)
    })

    it('ignores paths outside apps/, which have no <app> to generalise to', () => {
        const text = '`rm packages/keel/src/gone.ts`'
        expect(generalizeAppCitations(text, () => true)).toBe(text)
    })

    it('generalises a brace expansion at its static prefix, keeping the braces', () => {
        expect(generalizeAppCitations('`apps/showcase/messages/{en,es}.json`', gone)).toBe(
            '`apps/<app>/messages/{en,es}.json`',
        )
    })
})

/**
 * `resolves` against real directory trees, because what it decides depends on which apps exist. Three trees,
 * and the point is that the template is strict while an adopted tree is not strict about keel's two apps.
 */
describe('resolves', () => {
    /** A tree under a fresh root. `files` are created with their parents; `dirs` are empty directories. */
    function tree(files: string[], dirs: string[] = []): string {
        const root = makeTestTmpDir('doc-set-resolves-')
        for (const dir of dirs) mkdirSync(path.join(root, dir), { recursive: true })
        for (const file of files) {
            mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
            writeFileSync(path.join(root, file), '')
        }
        return root
    }
    // `only-in-temp` exists in these trees and nowhere else, so a lookup that ignored `root` and read the
    // process's own working directory (the real repo) would answer differently.
    const template = () =>
        tree(
            ['apps/showcase/package.json', 'apps/starter/package.json'],
            ['apps/showcase/src/only-in-temp', 'apps/starter/src', 'packages/keel/src'],
        )
    const adopted = () => tree(['apps/console/package.json'], ['apps/console/src', 'packages/keel/src']) // ejected, starter renamed
    const renamedOnly = () =>
        tree(['apps/showcase/package.json', 'apps/console/package.json'], ['apps/showcase/src', 'packages/keel/src'])

    it('reads the tree it is given, not the working directory', () => {
        expect(resolves('apps/showcase/src/only-in-temp', template())).toBe(true)
        expect(resolves('apps/showcase/src/only-in-temp', adopted()), "absent app: keel's").toBe(true)
        expect(resolves('packages/keel/src/only-in-temp', template())).toBe(false)
        expect(resolves('scripts', template()), 'a directory of the real repo that is not in the temp tree').toBe(false)
    })

    it('is strict in the template: a broken citation of either reference app fails', () => {
        const root = template()
        expect(resolves('apps/showcase/src/no-such-dir', root)).toBe(false)
        expect(resolves('apps/starter/src/no-such-dir', root)).toBe(false)
        expect(resolves('apps/showcase', root)).toBe(true)
    })

    it("lets an adopted tree cite keel's reference apps, which are not in it", () => {
        const root = adopted()
        expect(resolves('apps/starter/src/app/[locale]/signin/page.tsx', root)).toBe(true)
        expect(resolves('apps/showcase/src/domain/db/tickets.ts', root)).toBe(true)
        expect(resolves('apps/showcase/src/no-such-dir', root)).toBe(true)
        expect(resolves('apps/starter', root)).toBe(true)
    })

    it('stays strict for everything else in an adopted tree', () => {
        const root = adopted()
        expect(resolves('apps/console/src/no-such-dir', root), "the adopter's own app").toBe(false)
        expect(resolves('packages/keel/src/no-such-dir', root)).toBe(false)
        expect(resolves('docs/no-such-dir', root)).toBe(false)
        expect(resolves('apps/showcase-extra/src', root), 'a lookalike prefix is not the showcase').toBe(false)
    })

    it('judges each reference app by whether IT is present', () => {
        const root = renamedOnly() // the showcase kept, the starter renamed away
        expect(resolves('apps/showcase/src/no-such-dir', root)).toBe(false)
        expect(resolves('apps/starter/src/no-such-dir', root)).toBe(true)
    })

    it('keeps checking an app called starter that the adopter kept', () => {
        const root = tree(['apps/starter/package.json'], ['apps/starter/src', 'packages/keel/src']) // `init-app starter --eject-showcase`
        expect(resolves('apps/starter/src/no-such-dir', root)).toBe(false)
    })

    it('is not fooled by what a merge leaves behind where the app used to be', () => {
        // An upstream merge adds every NEW file under apps/showcase/ back, even after you deleted the app; a
        // local rename leaves apps/starter/node_modules. Neither makes the directory an app again.
        const root = tree(
            ['apps/console/package.json', 'apps/showcase/DEMO-SIZE.md', 'apps/showcase/tests/e2e/new.spec.ts'],
            ['apps/starter/node_modules/left-behind', 'packages/keel/src'],
        )
        expect(resolves('apps/showcase/src/domain/db/tickets.ts', root)).toBe(true)
        expect(resolves('apps/showcase/src/app-config', root)).toBe(true)
        expect(resolves('apps/starter/src/app/[locale]/signin/page.tsx', root)).toBe(true)
    })

    it('agrees with the rewriter: init-app does not generalize a citation the gate accepts', () => {
        // init-app asks `(cited) => !resolves(cited)`; a citation of a reference app that is not here is
        // keel's, so it is left as written instead of becoming `apps/<app>/…`.
        const root = adopted()
        const text = 'see `apps/starter/src/app/[locale]/signin/page.tsx` and `apps/console/src/no-such-dir`'
        expect(generalizeAppCitations(text, (cited) => !resolves(cited, root))).toBe(
            'see `apps/starter/src/app/[locale]/signin/page.tsx` and `apps/<app>/src/no-such-dir`',
        )
    })
})
