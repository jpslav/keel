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

interface Probe {
    /** The throwaway copy `init-app` ran in. */
    dir: string
    /** What `init-app` printed. */
    output: string
}

/** Copies the tree, runs `init-app <args>` in the copy, and hands back the result for inspection. */
function runInitApp(prefix: string, args: string[]): Probe {
    const dir = makeTestTmpDir(prefix)
    copyTree(ROOT, dir)
    const tsx = path.join(ROOT, 'node_modules/.bin/tsx')
    const initApp = spawnSync(tsx, [path.join(dir, 'scripts/init-app.ts'), ...args], { cwd: dir, encoding: 'utf8' })
    if (initApp.status !== 0) {
        throw new Error(
            `pnpm init-app ${args.join(' ')} exited ${initApp.status}\n` +
                `--- stdout ---\n${initApp.stdout}\n--- stderr ---\n${initApp.stderr}`,
        )
    }
    return { dir, output: initApp.stdout }
}

/**
 * The app slug and the repository name are DIFFERENT strings, on purpose, and neither is the other's
 * default. The rewrite used to write the slug into the repo position of every link, which is right only
 * when a repo happens to be named after its one app — and the test used to pin exactly that, so it
 * could not see the bug. A slug that differs from the repo name is what makes this check able to fail.
 */
const SLUG = 'acme'
const REPO = 'pages'
const OWNER = 'PLACEHOLDER_GITHUB_OWNER'
const REPO_PLACEHOLDER = 'PLACEHOLDER_GITHUB_REPO'

/** The harshest path init-app supports, same as the adoption-probe CI job: rename AND eject in one call. */
let ejected: Probe
/** Rename-only, with the repository named: the other path through the identity rewrite. */
let named: Probe

beforeAll(() => {
    ejected = runInitApp('keel-adopter-identity-', [SLUG, '--eject-showcase', '--yes'])
    named = runInitApp('keel-adopter-identity-named-', [SLUG, '--repo', REPO, '--yes'])
}, 120_000)

function readProbe(relative: string, probe: Probe = ejected): string {
    return readFileSync(path.join(probe.dir, relative), 'utf8')
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
        expect(text).toContain(`@${OWNER}`)
    })

    // With no --repo, the repository is a placeholder of its own — never the slug, which is a guess.
    const UNNAMED = `github.com/${OWNER}/${REPO_PLACEHOLDER}`

    it("SECURITY.md points the advisory link at the adopter's own repo, still to be named", () => {
        expect(readProbe('SECURITY.md')).toContain(`${UNNAMED}/security/advisories/new`)
    })

    it('the issue-template config repoints both the security and discussions links', () => {
        const text = readProbe('.github/ISSUE_TEMPLATE/config.yml')
        expect(text).toContain(`${UNNAMED}/security/advisories/new`)
        expect(text).toContain(`${UNNAMED}/discussions`)
    })

    it("the code of conduct enforcement contact is the adopter's own private channel", () => {
        expect(readProbe('CODE_OF_CONDUCT.md')).toContain(`${UNNAMED}/security/advisories/new`)
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
 * `--repo` names the repository, and the links must say THAT — not the app slug. The slug and the repo
 * are different here (`acme` in `pages`), so a link that still carries the slug fails by name.
 */
describe('`pnpm init-app --repo <name>` writes the repository name into the contact links', () => {
    const FILES = ['SECURITY.md', '.github/ISSUE_TEMPLATE/config.yml', 'CODE_OF_CONDUCT.md']

    it.each(FILES)('%s links github.com/<owner>/<repo>, never the app slug', (relative) => {
        const text = readProbe(relative, named)
        expect(text).toContain(`github.com/${OWNER}/${REPO}/security/advisories/new`)
        expect(text).not.toContain(REPO_PLACEHOLDER)
        expect(text, 'the slug is not the repository').not.toContain(`github.com/${OWNER}/${SLUG}`)
    })

    it('the issue-template discussions link names it too', () => {
        expect(readProbe('.github/ISSUE_TEMPLATE/config.yml', named)).toContain(
            `github.com/${OWNER}/${REPO}/discussions`,
        )
    })

    it('the owner stays a placeholder, since it also fills CODEOWNERS where it may be a team', () => {
        expect(readProbe('CODEOWNERS', named)).toContain(`@${OWNER}`)
    })

    it('the closing output asks for the repository name only when none was given', () => {
        expect(ejected.output).toContain(REPO_PLACEHOLDER)
        expect(ejected.output).toContain('The repository name')
        expect(named.output).not.toContain(REPO_PLACEHOLDER)
        expect(named.output).not.toContain('The repository name')
    })

    it.each([
        ['owner/name', 'a/b', 'NAME only'],
        ['a clone URL suffix', 'pages.git', '.git'],
        ['a dot-dot', '..', 'not a valid'],
        ['a space', 'my repo', 'not a valid'],
    ])('rejects %s as a repository name', (_label, value, message) => {
        // --dry-run: validation runs before anything is planned, and nothing may be written either way.
        const result = spawnSync(
            path.join(ROOT, 'node_modules/.bin/tsx'),
            [path.join(named.dir, 'scripts/init-app.ts'), SLUG, '--repo', value, '--dry-run'],
            { cwd: named.dir, encoding: 'utf8' },
        )
        expect(result.status).toBe(1)
        expect(result.stderr).toContain(message)
    })

    it("a re-run's --repo is reported as ignored instead of silently dropped", () => {
        const result = spawnSync(
            path.join(ROOT, 'node_modules/.bin/tsx'),
            [path.join(named.dir, 'scripts/init-app.ts'), SLUG, '--repo', 'elsewhere', '--dry-run'],
            { cwd: named.dir, encoding: 'utf8' },
        )
        expect(result.status).toBe(0)
        expect(result.stdout).toContain('--repo elsewhere ignored')
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
        expect(ejected.output).toContain('STARTER CONTENT STILL WIRED INTO YOUR UI')
    })

    it.each([
        'apps/acme/src/seed/',
        'apps/acme/src/app-config/abilities.ts',
        'apps/acme/messages/{en,es}.json',
        'apps/acme/src/demo-static/app.tsx',
    ])('names %s, and it exists', (cited) => {
        expect(ejected.output).toContain(cited)
        for (const relative of cited.includes('{en,es}')
            ? ['en', 'es'].map((locale) => cited.replace('{en,es}', locale))
            : [cited]) {
            expect(() => readProbe(relative.replace(/\/$/, '/index.ts'))).not.toThrow()
        }
    })
})
