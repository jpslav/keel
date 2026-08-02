import { describe, expect, it } from 'vitest'
import { citedPaths, doctrineDocs, resolves } from './doc-set'

/**
 * The docs must not send you somewhere that no longer exists.
 *
 * When the framework moved to `packages/keel` (ADR-0012), four doctrine documents and all three
 * recipes kept teaching `src/ports`, `src/adapters`, `src/core` — paths the lint fence now rejects. The
 * docs said one thing and the tree said another, and nothing caught it. This is the catch: the same
 * discipline `authorized-mutations.test.ts` applies to routes, applied to prose.
 *
 * The doc set, the citation parser and the resolution rule all live in `./doc-set.ts`, shared with
 * `scripts/init-app.ts`. That sharing is the point: adoption REWRITES these citations, and a rewriter
 * working from its own idea of what counts would leave the gate red on the adopter's first command.
 */
describe('doctrine docs cite paths that exist', () => {
    const docs = doctrineDocs()

    it('scans the whole doctrine set', () => {
        expect(docs.length).toBeGreaterThan(20)
    })

    it.each(docs)('%s', (file) => {
        const broken = citedPaths(file)
            .filter(({ path }) => !resolves(path))
            .map(({ path, line }) => `${file}:${line} cites \`${path}\``)

        expect(broken).toEqual([])
    })
})
