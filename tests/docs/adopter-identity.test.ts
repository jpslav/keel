import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { makeTestTmpDir } from '../support/tmp-dir'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * ENFORCED, not prose. An ejected adopter repo must not name the TEMPLATE maintainer as its own
 * security contact, code owner, or conduct contact — see `scripts/init-app.ts`'s
 * `rewriteAdopterIdentity`. That function used to not exist at all: four files were byte-identical to
 * the template's after a real `pnpm init-app acme --eject-showcase --yes`, and `init-app`'s own
 * "WHAT THIS DID NOT TOUCH" list — precisely where a careful adopter looks — never mentioned any of
 * them. A norm that is not a test rots; this is the test.
 *
 * This runs the SAME command the `adoption-probe` CI job runs (`.github/workflows/checks.yml`),
 * against a throwaway copy of the tree, and inspects the result — because `init-app.ts` resolves its
 * own root from `import.meta.url`, so "run it and check the output" is the only way to test it; the
 * module cannot be imported directly (`main()` runs unconditionally on import and would exit the test
 * process).
 *
 * The copy walks the WORKING TREE, not `git ls-files`. That distinction is load-bearing: this test
 * itself runs a second time inside the adoption-probe CI job (that job's `pnpm verify` step runs the
 * whole suite, including this file, against the tree `init-app` just ejected) — and at that point the
 * eject is uncommitted, so `git ls-files` still lists the PRE-eject paths (`apps/showcase/...`) while
 * the working tree already has `apps/acme/...`. Copying by `git ls-files` there fails with ENOENT the
 * moment it tries to copy a path the eject already deleted — caught by running this file inside a
 * throwaway eject of THIS repo's own working copy, the same failure mode the adoption-probe job hits
 * for real. Walking the real tree has no such blind spot.
 */

/** Directories a copy must skip: dependencies, VCS metadata, and build/test output — never source. */
const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    '.next',
    'build',
    'dist-demo',
    'coverage',
    'playwright-report',
    'test-results',
    '.data',
])

function copyTree(from: string, to: string): void {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue
        const fromPath = path.join(from, entry.name)
        const toPath = path.join(to, entry.name)
        if (entry.isDirectory()) {
            mkdirSync(toPath, { recursive: true })
            copyTree(fromPath, toPath)
        } else if (entry.isFile()) {
            cpSync(fromPath, toPath)
        }
    }
}

const MAINTAINER_HANDLE = '@jpslav'
const MAINTAINER_ADVISORY_URL = 'github.com/jpslav/keel/security/advisories/new'

/**
 * ANY address, rather than the maintainer's own literal.
 *
 * This guard used to hard-code the maintainer's personal address, which had two problems. That
 * constant was the ONLY occurrence of it anywhere in the repository — the check was itself the
 * reason a personal email shipped — and `init-app` does not rewrite such a literal, so every
 * adopter fork inherited it.
 * It was also vacuous by then: the conduct contact had already moved to the advisory link, so no
 * file contained the address and `not.toContain` could not fail.
 *
 * Matching the SHAPE fixes both. It publishes nobody's address, it cannot go vacuous, and it is
 * strictly stronger — these four files route contact through GitHub on purpose
 * (`CODE_OF_CONDUCT.md`: "This project has no separate conduct address"), so an address appearing in
 * one is wrong whoever it belongs to.
 */
const ANY_EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

/** The four files the bug was about — none of them may name the maintainer after an eject. */
const IDENTITY_FILES = ['CODEOWNERS', 'SECURITY.md', '.github/ISSUE_TEMPLATE/config.yml', 'CODE_OF_CONDUCT.md']

let probeDir: string
let initAppOutput: string

beforeAll(() => {
    probeDir = makeTestTmpDir('keel-adopter-identity-')
    copyTree(ROOT, probeDir)

    // The harshest path init-app supports, same as the adoption-probe CI job: rename AND eject in one call.
    const tsx = path.join(ROOT, 'node_modules/.bin/tsx')
    const initApp = spawnSync(tsx, [path.join(probeDir, 'scripts/init-app.ts'), 'acme', '--eject-showcase', '--yes'], {
        cwd: probeDir,
        encoding: 'utf8',
    })
    if (initApp.status !== 0) {
        throw new Error(
            `pnpm init-app acme --eject-showcase --yes exited ${initApp.status}\n` +
                `--- stdout ---\n${initApp.stdout}\n--- stderr ---\n${initApp.stderr}`,
        )
    }
    initAppOutput = initApp.stdout
}, 120_000)

function readProbe(relative: string): string {
    return readFileSync(path.join(probeDir, relative), 'utf8')
}

describe('after `pnpm init-app --eject-showcase`, the adopter repo does not inherit the maintainer identity', () => {
    it.each(IDENTITY_FILES)('%s no longer names the maintainer', (relative) => {
        const text = readProbe(relative)
        expect(text).not.toContain(MAINTAINER_HANDLE)
        expect(text).not.toMatch(ANY_EMAIL_ADDRESS)
        expect(text).not.toContain(MAINTAINER_ADVISORY_URL)
    })

    it('CODEOWNERS keeps the curated path list — only the owner was wrong', () => {
        const text = readProbe('CODEOWNERS')
        for (const owned of [
            '/packages/keel/src/db/',
            '/packages/keel/src/authz/',
            '/packages/keel/src/adapters/',
            '/packages/keel/test-fixture/',
            '/scripts/init-app.ts',
            '/tests/docs/',
            '/.github/workflows/',
            '/docs/adr/',
        ]) {
            expect(text).toContain(owned)
        }
        expect(text).toContain('@PLACEHOLDER_GITHUB_OWNER')
    })

    it("SECURITY.md points the advisory link at the adopter's own repo", () => {
        expect(readProbe('SECURITY.md')).toContain('github.com/PLACEHOLDER_GITHUB_OWNER/acme/security/advisories/new')
    })

    it('the issue-template config repoints both the security and discussions links', () => {
        const text = readProbe('.github/ISSUE_TEMPLATE/config.yml')
        expect(text).toContain('github.com/PLACEHOLDER_GITHUB_OWNER/acme/security/advisories/new')
        expect(text).toContain('github.com/PLACEHOLDER_GITHUB_OWNER/acme/discussions')
    })

    it("the code of conduct enforcement contact is the adopter's own private channel", () => {
        expect(readProbe('CODE_OF_CONDUCT.md')).toContain(
            'github.com/PLACEHOLDER_GITHUB_OWNER/acme/security/advisories/new',
        )
    })

    // Two places correctly KEEP the maintainer's name, and must stay exempt:
    it("LICENSE keeps the maintainer's name — MIT requires preserving the copyright notice verbatim", () => {
        expect(readProbe('LICENSE')).toContain('JP Slavinsky')
    })

    it("docs/adr approver lines keep the maintainer's name — honest provenance for keel's own decisions", () => {
        expect(readProbe('docs/adr/0012-framework-app-line-and-registration.md')).toContain('Approver: JP Slavinsky')
    })
})

/**
 * The other thing a rename leaves behind is CONTENT: the starter's seed world, welcome copy, Items
 * slice and static-demo wiring are all still on screen afterwards, and no gate can call leftover
 * content an error. The closing output is the only place an adopter is told, so it is pinned — the
 * seed, seam, catalog and demo paths it names must exist in the tree `init-app` just produced, or the
 * list is sending people to files that are not there. (The Items files are named in prose, not by
 * path, so they are not checked.)
 */
describe('`pnpm init-app` tells the adopter which starter content is still on screen', () => {
    it('prints the section', () => {
        expect(initAppOutput).toContain('STARTER CONTENT STILL WIRED INTO YOUR UI')
    })

    it.each([
        'apps/acme/src/seed/',
        'apps/acme/src/app-config/abilities.ts',
        'apps/acme/messages/{en,es}.json',
        'apps/acme/src/demo-static/app.tsx',
    ])('names %s, and it exists', (cited) => {
        expect(initAppOutput).toContain(cited)
        for (const relative of cited.includes('{en,es}')
            ? ['en', 'es'].map((locale) => cited.replace('{en,es}', locale))
            : [cited]) {
            expect(() => readProbe(relative.replace(/\/$/, '/index.ts'))).not.toThrow()
        }
    })
})
