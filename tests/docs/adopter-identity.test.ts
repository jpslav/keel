import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { makeTestTmpDir } from '../support/tmp-dir'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * ENFORCED, not prose. An adopted repo must not name the TEMPLATE maintainer as its own security
 * contact, code owner, or conduct contact — see `scripts/init-app.ts`'s `rewriteAdopterIdentity`. That
 * function used to not exist at all: four files were byte-identical to the template's after a real
 * `pnpm init-app acme --eject-showcase --yes`, and `init-app`'s own "WHAT THIS DID NOT TOUCH" list —
 * precisely where a careful adopter looks — never mentioned any of them. A norm that is not a test
 * rots; this is the test.
 *
 * THIS FILE SHIPS TO EVERY ADOPTER and comes back with every upstream merge (ADR-0013), so it has to be
 * right in two different trees, and it works out which one it is in before it asserts anything:
 *
 *   TEMPLATE  `apps/showcase` exists and the root package is still `keel-workspace`. The identity files
 *             must ALL name the maintainer (that is `init-app`'s input), and the suite below runs the
 *             SAME command the `adoption-probe` CI job runs (`.github/workflows/checks.yml`) against
 *             throwaway copies of the tree and inspects what comes out. `init-app.ts` resolves its own
 *             root from `import.meta.url`, so "run it and check the output" is the only way to test it:
 *             the module cannot be imported (`main()` runs unconditionally on import and would exit the
 *             test process).
 *   ADOPTED   anything else. `init-app` already ran, so there is no rewrite to test — it replaces the
 *             template's literals and they are gone — and the one claim left is the one that matters to
 *             an adopter, checked directly on their real files: none of the four names the maintainer.
 *             That also catches the way it comes back in a fork: an upstream merge adding a line owned
 *             by `@jpslav` to your CODEOWNERS (the exact spelling; the template's own files use one).
 *
 * THE TWO ARE TOLD APART BY STRUCTURE, NOT BY THE IDENTITY BEING TESTED. Every `init-app` run that is
 * allowed to adopt renames the root package (`<slug>-workspace`) or deletes `apps/showcase`, so an
 * adopted tree fails one of the two conditions. Keying on "do the files still name the maintainer"
 * instead looks equivalent and has a hole: move the maintainer's identity (a repo transfer, a new
 * handle), update the four files and nothing else, and every file reads as "adopted" — the init-app
 * suite switches itself off and `init-app` silently stops scrubbing anything. Here the same change
 * leaves a template-shaped tree whose files no longer name the maintainer, which is red.
 *
 * WHY IT IS NOT "SKIP WHEN THE SHOWCASE IS GONE". This file used to run `init-app` on a copy of
 * WHATEVER tree it was in, with the slug `acme` hard-coded, and assert what the rewrite produced. In an
 * adopted tree the rewrite finds nothing to replace, so those assertions read the adopter's own files:
 * with an app called `console`, three tests went red on `…/acme/security/advisories/new`, and once the
 * owner placeholder was filled in a fourth did too. It stayed green in the `adoption-probe` job for one
 * reason: that job also adopts as `acme`. A coincidence, not a design. Skipping on "no `apps/showcase`"
 * would have fixed the adopter and switched the gate off in the probe's ejected tree, which has none —
 * where the ADOPTED check above now runs against the tree the real command produced.
 *
 * The copies walk the WORKING TREE, not `git ls-files`: a maintainer is mid-edit, and the index lists
 * paths an uncommitted change has already deleted (ENOENT on the copy).
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
/** The template's own repo, which every link in the contact files pointed at before the rewrite. */
const MAINTAINER_REPO = 'github.com/jpslav/keel'

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
 *
 * Template-only: it asserts the TEMPLATE's policy about the output of `init-app`. An adopter's own
 * security policy may legitimately carry an address.
 */
const ANY_EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

/** The four files the bug was about — none of them may name the maintainer after an adoption. */
const IDENTITY_FILES = ['CODEOWNERS', 'SECURITY.md', '.github/ISSUE_TEMPLATE/config.yml', 'CODE_OF_CONDUCT.md']

/** What `init-app` renames the root package away from. `keel` itself is a reserved slug, so no adoption keeps it. */
const TEMPLATE_ROOT_PACKAGE = 'keel-workspace'

function rootPackageName(root: string): unknown {
    try {
        return (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { name?: unknown }).name
    } catch {
        return undefined
    }
}

/** See "TEMPLATE" above. Takes a root so the probes can be classified too: that is how it is tested. */
function looksLikeTemplate(root: string): boolean {
    return existsSync(path.join(root, 'apps/showcase')) && rootPackageName(root) === TEMPLATE_ROOT_PACKAGE
}

/** Decided once, at load, so the suites below can be switched on and off by it. */
const isTemplate = looksLikeTemplate(ROOT)

/** A file that does not exist cannot name anyone — an adopter may delete one. */
function namesMaintainer(relative: string): boolean {
    const file = path.join(ROOT, relative)
    if (!existsSync(file)) return false
    const text = readFileSync(file, 'utf8')
    return text.includes(MAINTAINER_HANDLE) || text.includes(MAINTAINER_REPO)
}

describe('the maintainer identity lives in the template only', () => {
    it('the identity files name the maintainer exactly when this is the pristine template', () => {
        const carriers = IDENTITY_FILES.filter(namesMaintainer)
        const expected = isTemplate ? IDENTITY_FILES : []
        const explanation = isTemplate
            ? `This tree is shaped like the pristine template (apps/showcase exists and the root package is still ` +
              `${TEMPLATE_ROOT_PACKAGE}), so all four identity files must name the template maintainer ` +
              `(${MAINTAINER_HANDLE}, ${MAINTAINER_REPO}): that is the input init-app's rewrite is tested on. ` +
              `Only ${carriers.join(', ') || 'none of them'} do. If the maintainer's identity changed, change the ` +
              `constants in this file and \`rewriteAdopterIdentity\` together. If you adopted by hand, rename the ` +
              `root package or delete apps/showcase so this tree stops looking like the template.`
            : `These files still name the template maintainer (${MAINTAINER_HANDLE}, ${MAINTAINER_REPO}): ` +
              `${carriers.join(', ')}. In an adopted repo that file routes people to someone else: replace it ` +
              `(\`pnpm init-app\` writes the placeholders). If this IS the template, it no longer looks like one to ` +
              `this test, which needs apps/showcase and a root package named ${TEMPLATE_ROOT_PACKAGE}.`
        expect(carriers, explanation).toEqual(expected)
    })
})

interface Probe {
    /** The throwaway copy `init-app` ran in. */
    dir: string
    /** What `init-app` printed. */
    output: string
}

function spawnInitApp(dir: string, args: string[]) {
    const tsx = path.join(ROOT, 'node_modules/.bin/tsx')
    return spawnSync(tsx, [path.join(dir, 'scripts/init-app.ts'), ...args], { cwd: dir, encoding: 'utf8' })
}

/** Copies the tree, runs `init-app <args>` in the copy, and hands back the result for inspection. */
function runInitApp(prefix: string, args: string[]): Probe {
    const dir = makeTestTmpDir(prefix)
    copyTree(ROOT, dir)
    const initApp = spawnInitApp(dir, args)
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

const CONTACT_FILES = ['SECURITY.md', '.github/ISSUE_TEMPLATE/config.yml', 'CODE_OF_CONDUCT.md']

/** The harshest path init-app supports, same as the adoption-probe CI job: rename AND eject in one call. */
let ejected: Probe
/** Rename-only, with the repository named: the other path through the identity rewrite. */
let named: Probe
/** Adopted without `--repo`, then given it by a second run: "I forgot the flag". */
let fixedUp: Probe
let fixUpRun: ReturnType<typeof spawnInitApp>
/** Ejected with no slug: the one adopting run that renames nothing. */
let ejectOnly: Probe
/** Adopted without `--repo`, the OWNER filled in by hand (the natural order), then `--repo`. */
let ownerFirst: Probe
let ownerFirstRun: ReturnType<typeof spawnInitApp>
/** An untouched copy: the positive control for the classifier, and the target of the bare-`--repo` refusal. */
let pristineDir: string

function readProbe(relative: string, probe: Probe = ejected): string {
    return readFileSync(path.join(probe.dir, relative), 'utf8')
}

describe.runIf(isTemplate)('TEMPLATE: `pnpm init-app` scrubs the maintainer identity', () => {
    beforeAll(() => {
        ejected = runInitApp('keel-adopter-identity-', [SLUG, '--eject-showcase', '--yes'])
        named = runInitApp('keel-adopter-identity-named-', [SLUG, '--repo', REPO, '--yes'])
        fixedUp = runInitApp('keel-adopter-identity-fixup-', [SLUG, '--yes'])
        fixUpRun = spawnInitApp(fixedUp.dir, ['--repo', REPO, '--yes'])
        ejectOnly = runInitApp('keel-adopter-identity-eject-', ['--eject-showcase', '--yes'])
        ownerFirst = runInitApp('keel-adopter-identity-owner-', [SLUG, '--yes'])
        for (const relative of IDENTITY_FILES) {
            const file = path.join(ownerFirst.dir, relative)
            writeFileSync(file, readFileSync(file, 'utf8').split(OWNER).join('myorg'))
        }
        ownerFirstRun = spawnInitApp(ownerFirst.dir, ['--repo', REPO, '--yes'])
        pristineDir = makeTestTmpDir('keel-adopter-identity-pristine-')
        copyTree(ROOT, pristineDir)
    }, 120_000)

    /**
     * The always-on test above is only as good as the classifier, and nothing else proves the classifier
     * flips: an adopted tree has to fail one of its two conditions, whichever way `init-app` was called.
     */
    describe('the structural classifier tells the template from every tree `init-app` produces', () => {
        it('calls an untouched copy the template (the positive control)', () => {
            expect(looksLikeTemplate(pristineDir)).toBe(true)
        })

        it.each([
            ['renamed and ejected', () => ejected],
            ['renamed only (the showcase stays, the root package does not)', () => named],
            ['adopted, then given its repo name', () => fixedUp],
            ['ejected with no slug (the root package keeps its name, the showcase goes)', () => ejectOnly],
        ])('calls a tree %s adopted', (_label, probe) => {
            expect(looksLikeTemplate(probe().dir)).toBe(false)
        })
    })

    describe('after `pnpm init-app --eject-showcase`, the adopter repo does not inherit the maintainer identity', () => {
        it.each(IDENTITY_FILES)('%s no longer names the maintainer', (relative) => {
            const text = readProbe(relative)
            expect(text).not.toContain(MAINTAINER_HANDLE)
            expect(text).not.toMatch(ANY_EMAIL_ADDRESS)
            expect(text).not.toContain(MAINTAINER_REPO)
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
            expect(readProbe('docs/adr/0012-framework-app-line-and-registration.md')).toContain(
                'Approver: JP Slavinsky',
            )
        })
    })

    /**
     * `--repo` names the repository, and the links must say THAT — not the app slug. The slug and the repo
     * are different here (`acme` in `pages`), so a link that still carries the slug fails by name.
     */
    describe('`pnpm init-app --repo <name>` writes the repository name into the contact links', () => {
        it.each(CONTACT_FILES)('%s links github.com/<owner>/<repo>, never the app slug', (relative) => {
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
            // One unbroken line, or pasting it into a shell runs a fragment.
            expect(ejected.output).toContain(
                'git grep PLACEHOLDER_GITHUB -- CODEOWNERS SECURITY.md CODE_OF_CONDUCT.md .github',
            )
            expect(named.output).not.toContain(REPO_PLACEHOLDER)
            expect(named.output).not.toContain('The repository name')
        })

        it.each([
            ['owner/name', ['--repo', 'a/b'], 'NAME only'],
            ['a clone URL suffix', ['--repo', 'pages.git'], '.git'],
            ['a clone URL suffix in any case', ['--repo', 'Pages.GIT'], '.git'],
            ['a dot-dot', ['--repo', '..'], 'not a valid'],
            ['a space', ['--repo', 'my repo'], 'not a valid'],
            ['the placeholder itself', ['--repo', REPO_PLACEHOLDER], 'the placeholder itself'],
            ['a second --repo', ['--repo', 'a', '--repo', 'b'], 'given twice'],
        ])('rejects %s', (_label, args, message) => {
            // --dry-run: validation runs before anything is planned, and nothing may be written either way.
            const result = spawnInitApp(named.dir, [SLUG, ...args, '--dry-run'])
            expect(result.status).toBe(1)
            expect(result.stderr).toContain(message)
        })

        it('on its own, on a tree init-app has not adopted, refuses rather than half-adopting', () => {
            const result = spawnInitApp(pristineDir, ['--repo', REPO, '--yes'])
            expect(result.status).toBe(1)
            expect(result.stderr).toContain('already adopted')
            expect(readFileSync(path.join(pristineDir, 'CODEOWNERS'), 'utf8')).toContain(MAINTAINER_HANDLE)
        })

        it('rejects --name without a slug, which would be accepted and silently dropped', () => {
            const result = spawnInitApp(named.dir, ['--repo', REPO, '--name', 'Brand New', '--dry-run'])
            expect(result.status).toBe(1)
            expect(result.stderr).toContain('goes with a slug')
        })
    })

    /**
     * Adopting without `--repo` is the easy mistake, and the fix has to be a command and not a hand edit
     * across three files — and what the run PRINTS has to match what it did.
     */
    describe('`pnpm init-app --repo <name>` on a tree adopted without it fills the placeholder in', () => {
        it('exits cleanly and names the repository in all three contact files', () => {
            expect(fixUpRun.status, fixUpRun.stderr).toBe(0)
            for (const relative of CONTACT_FILES) {
                const text = readProbe(relative, fixedUp)
                expect(text).toContain(`github.com/${OWNER}/${REPO}/security/advisories/new`)
                expect(text).not.toContain(REPO_PLACEHOLDER)
            }
            expect(readProbe('.github/ISSUE_TEMPLATE/config.yml', fixedUp)).toContain(
                `github.com/${OWNER}/${REPO}/discussions`,
            )
        })

        it('no longer asks for the repository name it was just given', () => {
            // The CLOSING section, not the plan above it: the plan says the same words before anything ran.
            const closing = fixUpRun.stdout.slice(fixUpRun.stdout.indexOf('WHAT NOW NEEDS YOUR DETAILS'))
            expect(closing).toContain(`the advisory link now points at github.com/${OWNER}/${REPO}`)
            expect(closing).not.toContain('The repository name')
            expect(closing).not.toContain(REPO_PLACEHOLDER)
        })

        it('does only that: no citation rewrite, no prose review, no "run pnpm install"', () => {
            for (const unrelated of [
                'repoint path citations',
                'PROSE STILL TO REVIEW',
                'WHAT THIS DID NOT TOUCH',
                'pnpm install',
            ]) {
                expect(fixUpRun.stdout, unrelated).not.toContain(unrelated)
            }
        })

        it('fills the placeholder even after the owner was filled in first', () => {
            expect(ownerFirstRun.status, ownerFirstRun.stderr).toBe(0)
            for (const relative of CONTACT_FILES) {
                const text = readProbe(relative, ownerFirst)
                expect(text).toContain(`github.com/myorg/${REPO}/security/advisories/new`)
                expect(text).not.toContain(REPO_PLACEHOLDER)
            }
            expect(ownerFirstRun.stdout).not.toContain('ignored')
        })

        it('a further --repo, with nothing left to replace, is reported as ignored and claims no change', () => {
            const result = spawnInitApp(named.dir, [SLUG, '--repo', 'elsewhere', '--dry-run'])
            expect(result.status).toBe(0)
            expect(result.stdout).toContain('--repo elsewhere ignored')
            expect(result.stdout).toContain('NOT change the contact links')
            expect(result.stdout).not.toContain(`github.com/${OWNER}/elsewhere`)
            expect(result.stdout).not.toContain('The repository name')
        })
    })

    /**
     * The demo size budget is the adopter's number the moment they keep the starter, and the closing
     * output is the only place they are told. What it says must be what their tree holds, so the number is
     * read back from the probe's own package.json rather than restated here, and the script it sends them
     * to must carry the parts it names.
     */
    describe('`pnpm init-app` tells the adopter the demo size budget is theirs now', () => {
        const flat = (text: string) => text.replace(/\s+/g, ' ')
        const budgetOf = (probe: Probe) => {
            const pkg = JSON.parse(readProbe(`apps/${SLUG}/package.json`, probe)) as {
                scripts?: Record<string, string>
            }
            return /check-demo-size\.mjs\s+(\d+)\s*$/.exec(pkg.scripts?.['check:demo-size'] ?? '')?.[1]
        }

        it("names the number the app's own package.json passes", () => {
            const budget = budgetOf(ejected)
            expect(
                budget,
                'the starter no longer passes check-demo-size.mjs a number: rewrite the bullet',
            ).toBeDefined()
            expect(flat(ejected.output)).toContain(
                `apps/${SLUG}/package.json's check:demo-size passes the static demo's byte budget, ${budget}.`,
            )
        })

        it('says the showcase is gone, and what that left behind, only when it was ejected', () => {
            expect(flat(ejected.output)).toContain('still describe the showcase you removed')
            expect(flat(named.output)).not.toContain('still describe the showcase you removed')
            expect(flat(named.output)).toContain('The demo size budget')
        })

        it('leaves scripts/check-demo-size.mjs exactly as the template has it, whichever way it is called', () => {
            // A rewrite of its history is the false-sentence trap; the bullet says what is stale instead.
            const template = readFileSync(path.join(ROOT, 'scripts/check-demo-size.mjs'), 'utf8')
            expect(readProbe('scripts/check-demo-size.mjs', ejected)).toBe(template)
            expect(readProbe('scripts/check-demo-size.mjs', named)).toBe(template)
        })

        it('points at a script that has what it promises: a default, and a WHEN IT GOES RED section', () => {
            const script = readProbe('scripts/check-demo-size.mjs')
            expect(script).toContain('DEFAULT_BUDGET_BYTES')
            expect(script).toContain('WHEN IT GOES RED')
        })

        it('says the default applies when the app passes no number (a renamed showcase)', () => {
            // --dry-run on an untouched copy: the showcase's own script passes no number.
            const result = spawnInitApp(pristineDir, ['demo', '--app', 'showcase', '--dry-run'])
            expect(result.status, result.stderr).toBe(0)
            expect(flat(result.stdout)).toContain(
                "apps/demo/package.json's check:demo-size passes no number, so DEFAULT_BUDGET_BYTES in scripts/check-demo-size.mjs is your budget",
            )
            expect(flat(result.stdout)).not.toContain('still describe the showcase you removed')
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
            `apps/${SLUG}/src/seed/`,
            `apps/${SLUG}/src/app-config/abilities.ts`,
            `apps/${SLUG}/messages/{en,es}.json`,
            `apps/${SLUG}/src/demo-static/app.tsx`,
        ])('names %s, and it exists', (cited) => {
            expect(ejected.output).toContain(cited)
            for (const relative of cited.includes('{en,es}')
                ? ['en', 'es'].map((locale) => cited.replace('{en,es}', locale))
                : [cited]) {
                expect(() => readProbe(relative.replace(/\/$/, '/index.ts'))).not.toThrow()
            }
        })
    })
})
