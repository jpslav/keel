import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * keel's public surface is `packages/keel/package.json`'s `exports` map (ADR-0012), and
 * `eslint.config.mjs`'s `keel/public-surface` rule reads that map to fail any
 * `keel/<subpath>` import it does not publish. That makes the map load-bearing, and two ways of
 * breaking it are invisible to every other gate:
 *
 * - a target that no longer exists. The lint rule matches on KEYS, so deleting or renaming a
 *   published module leaves an entry that points at nothing and still lets the import pass lint.
 * - a catch-all pattern. `"./*": "./src/*.ts"` is what the map used to be, and re-adding it would
 *   publish all 149 modules again while every check in the repo stayed green — the exact regression
 *   this surface exists to prevent, and the one nothing else can see.
 */
// Resolved from the repo root (vitest's cwd) rather than from import.meta.url, which the happy-dom
// environment reports as an http: URL — the same reason authorized-mutations.test.ts walks from cwd.
const packageDir = path.resolve(process.cwd(), 'packages/keel')
const exportsMap = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')).exports as Record<
    string,
    string | string[] | null
>

const targetsFor = (target: string | string[] | null): string[] =>
    target === null ? [] : Array.isArray(target) ? target : [target]

describe('keel public surface', () => {
    it('publishes only targets that exist', () => {
        const missing = Object.entries(exportsMap).flatMap(([key, target]) =>
            targetsFor(target)
                .filter((file) => !file.includes('*') && !existsSync(path.join(packageDir, file)))
                .map((file) => `${key} -> ${file}`),
        )
        expect(missing).toEqual([])
    })

    it('publishes no test or story file', () => {
        const leaked = Object.entries(exportsMap)
            .filter(([, target]) => targetsFor(target).some((file) => /\.(test|stories)\.tsx?$/.test(file)))
            .map(([key]) => key)
        expect(leaked).toEqual([])
    })

    it('has no catch-all pattern that would republish the whole package', () => {
        // A pattern is only a surface if it names a bounded set. `./*` and `./*.<ext>` re-export the
        // entire tree; a scoped pattern like `./i18n/messages/*.json` is fine.
        const catchAll = Object.keys(exportsMap).filter((key) => /^\.\/\*(\.[a-z]+)?$/.test(key))
        expect(catchAll).toEqual([])
    })

    /**
     * The size of the surface is quoted in doctrine, and quoting it by hand has gone wrong every
     * single time: the number has been 120, then 124, then 126, each written down confidently and
     * each measured differently (whether `./package.json` counts, whether the two JSON catalogs do).
     * A norm — "re-derive a number before you quote it" — did not survive three attempts, so the
     * count becomes a gate: change the map without changing the sentence and this goes red.
     *
     * Counted exactly as `eslint.config.mjs`'s `keel/public-surface` rule counts it, since that rule
     * is what the sentence is describing.
     */
    it('is the size CLAUDE.md says it is', () => {
        const published = Object.keys(exportsMap).filter((key) => key !== '.' && key !== './package.json').length
        const claude = readFileSync(path.resolve(process.cwd(), 'CLAUDE.md'), 'utf8')
        const stated = /(\d+)\s+published subpaths/.exec(claude)
        expect(stated, 'CLAUDE.md no longer states a published-subpath count').not.toBeNull()
        expect(Number(stated?.[1])).toBe(published)
    })

    /**
     * The complement: every module under `src/` the map does NOT publish. It was quoted by hand and
     * ungated, and it drifted twice (build-notes: 33 stated, 34 real; then 34 stated while two new
     * Simulator internals made it 36). `docs/adopting.md` is where an adopter reads it, so that sentence
     * is the one held. A module is a non-test, non-story, non-declaration `.ts`/`.tsx` file; a published
     * target counts once however many keys point at it.
     */
    it('leaves exactly as many modules internal as docs/adopting.md says', () => {
        const published = new Set(
            Object.values(exportsMap)
                .flatMap(targetsFor)
                .map((file) => path.join(packageDir, file)),
        )
        const modules: string[] = []
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) walk(full)
                else if (/\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$|\.d\.ts$/.test(entry.name)) {
                    modules.push(full)
                }
            }
        }
        walk(path.join(packageDir, 'src'))
        const internal = modules.filter((file) => !published.has(file)).length
        const adopting = readFileSync(path.resolve(process.cwd(), 'docs/adopting.md'), 'utf8')
        const stated = /other\s+(\d+)\s+modules of the package are internals/.exec(adopting)
        expect(stated, 'docs/adopting.md no longer states an internal-module count').not.toBeNull()
        expect(Number(stated?.[1])).toBe(internal)
    })
})
