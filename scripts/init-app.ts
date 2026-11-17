/**
 * `pnpm init-app` — the mechanical half of adopting this template.
 *
 * WHAT THIS EXISTS TO FIX. Adoption is meant to be "delete one directory, run one command", but the
 * identity rename was a hand checklist in docs/adopting.md, and walking it broke `pnpm verify`:
 * two e2e specs hard-asserted the product's name. A guide whose own acceptance test fails at step
 * two is not a guide. So the rename is a script (this file), the specs now assert against the loaded
 * catalog instead of a literal, and the two halves are verified together by running them.
 *
 * WHAT IT CHANGES is derived from the tree, not from a list someone maintains: the current slug is
 * read from the app's `config/app.ts`, the current display name from its `welcome` namespace, the
 * current package name from its `package.json`. Every edit is a literal replacement of the value it
 * found, so re-running the command is a no-op — idempotent by construction rather than by a flag.
 *
 * WHAT IT DOES NOT CHANGE is printed at the end, because the things it leaves alone (deployment
 * params, seed data, cutover rows) are the things that actually take judgement.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { doctrineDocs, EXEMPT, generalizeAppCitations, resolves } from '../tests/docs/doc-set'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * GitHub's own syntax for "nobody" — values that are loudly wrong rather than silently absent. Two
 * tokens, because the owner and the repository NAME are two things init-app cannot know: neither is
 * the app slug (a company's `console` app lives in a repo called `pages`, under an org that is neither).
 * Declared this early because `USAGE` interpolates them.
 */
const PLACEHOLDER_OWNER = 'PLACEHOLDER_GITHUB_OWNER'
const PLACEHOLDER_REPO = 'PLACEHOLDER_GITHUB_REPO'

const USAGE = `
pnpm init-app <slug> [options]        rename the app you keep
pnpm init-app --eject-showcase        delete the demo app (slug optional; both can run at once)
pnpm init-app --repo <name>           fill in the repository name on a tree adopted without it

  <slug>              the new APP_SLUG: lowercase letters, digits and dashes. Also becomes the app's
                      directory name and package name (the workspace root becomes <slug>-workspace,
                      so "pnpm --filter <slug>" can only ever mean the app).
  --name "<Name>"     display name for UI copy and titles (default: title-cased <slug>)
  --app <dir>         which directory under apps/ to rename (default: starter, else the only app)
  --repo <name>       the GitHub repository NAME this will live in: not the owner, and not the app slug
                      (an app can live in a repo of another name). Used in the advisory and discussions links of
                      SECURITY.md, the issue-template config and CODE_OF_CONDUCT.md. Without it those
                      links say ${PLACEHOLDER_REPO}, next to ${PLACEHOLDER_OWNER}, for you to replace
  --eject-showcase    remove apps/showcase and every reference to it
  --dry-run           print the plan and change nothing
  --yes               skip the confirmation prompt (required when stdin is not a terminal)
`.trimStart()

// ---------------------------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------------------------

/**
 * FLAGS VS POSITIONAL, and why. The slug is the one argument adoption cannot do without — ADR-0012
 * makes it the single source of mechanical identity, so "adopting = change this one value" — and a
 * command with exactly one irreducible argument should take it positionally: `pnpm init-app acme`
 * reads like the sentence it is. Everything else is either DERIVABLE from the slug (the display
 * name defaults to its title case) or a MODE (eject, dry-run, confirm), and both of those want a
 * name at the call site: `--name "Acme Research"` says which of two strings is which, and
 * `--eject-showcase` is a decision you should have to spell out. A second positional would be a
 * coin-flip to read six months later.
 */
interface Options {
    slug: string | null
    displayName: string | null
    app: string | null
    repo: string | null
    ejectShowcase: boolean
    dryRun: boolean
    assumeYes: boolean
}

function parseArgs(argv: string[]): Options {
    const options: Options = {
        slug: null,
        displayName: null,
        app: null,
        repo: null,
        ejectShowcase: false,
        dryRun: false,
        assumeYes: false,
    }
    const takesValue = new Map<string, (value: string) => void>([
        ['--name', (value) => (options.displayName = value)],
        ['--app', (value) => (options.app = value)],
        [
            '--repo',
            (value) => {
                if (options.repo !== null) fail('--repo given twice')
                options.repo = value
            },
        ],
    ])

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]
        const setter = takesValue.get(arg)
        if (setter) {
            const value = argv[index + 1]
            if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`)
            setter(value)
            index += 1
        } else if (arg === '--eject-showcase') options.ejectShowcase = true
        else if (arg === '--dry-run') options.dryRun = true
        else if (arg === '--yes' || arg === '-y') options.assumeYes = true
        else if (arg === '--help' || arg === '-h') {
            console.log(USAGE)
            process.exit(0)
        } else if (arg.startsWith('-')) fail(`unknown option ${arg}`)
        else if (options.slug === null) options.slug = arg
        else fail(`unexpected argument "${arg}" — the display name is a flag: --name "${arg}"`)
    }
    return options
}

function fail(message: string): never {
    console.error(`init-app: ${message}\n`)
    console.error(USAGE)
    process.exit(1)
}

// ---------------------------------------------------------------------------------------------
// tiny fs + formatting helpers
// ---------------------------------------------------------------------------------------------

let dryRun = false
const changed: string[] = []
const skipped: string[] = []
/** Every file actually written, so the formatting pass can be scoped to them. */
const touched = new Set<string>()

function abs(relative: string): string {
    return path.join(ROOT, relative)
}

function readText(relative: string): string {
    return readFileSync(abs(relative), 'utf8')
}

function writeText(relative: string, next: string): void {
    touched.add(relative)
    if (!dryRun) writeFileSync(abs(relative), next)
}

function note(list: string[], message: string): void {
    list.push(message)
}

/**
 * Move recorded paths along with a directory that just moved. The formatting pass runs LAST, after
 * `apps/<old>` has become `apps/<new>`, so without this it is handed paths that no longer exist:
 * prettier reports each one and exits 2, which the script then reports as a failure on every single
 * rename — while the app's own rewritten files silently go unformatted, the one thing the pass exists
 * to prevent.
 */
function retargetTouched(fromPrefix: string, toPrefix: string): void {
    for (const file of [...touched]) {
        if (!file.startsWith(fromPrefix)) continue
        touched.delete(file)
        touched.add(toPrefix + file.slice(fromPrefix.length))
    }
}

/** Literal (not regex) replacements, reported once per file. A file that needs nothing is silent. */
function rewrite(relative: string, pairs: [from: string, to: string][], label: string): void {
    if (!existsSync(abs(relative))) return
    const before = readText(relative)
    let after = before
    for (const [from, to] of pairs) {
        if (from === to) continue
        after = after.split(from).join(to)
    }
    if (after === before) return
    writeText(relative, after)
    note(changed, `${relative} — ${label}`)
}

interface PackageJson {
    name?: string
    description?: string
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    [key: string]: unknown
}

function readJson<T>(relative: string): T {
    return JSON.parse(readText(relative)) as T
}

/** Edits JSON in place, re-emitted prettier-shaped: four spaces, trailing newline, insertion order. */
function editJson<T>(relative: string, label: string, edit: (value: T) => void): void {
    if (!existsSync(abs(relative))) return
    const before = readText(relative)
    const value = JSON.parse(before) as T
    edit(value)
    const after = `${JSON.stringify(value, null, 4)}\n`
    if (after === before) return
    writeText(relative, after)
    note(changed, `${relative} — ${label}`)
}

/**
 * A TypeScript string literal quoted the way prettier would quote it, so a name containing an
 * apostrophe does not fail `prettier --check` on the adopter's first `pnpm lint`.
 */
function tsString(value: string): string {
    const singles = (value.match(/'/g) ?? []).length
    const doubles = (value.match(/"/g) ?? []).length
    return singles > doubles
        ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
        : `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function titleCase(slug: string): string {
    return slug
        .split('-')
        .filter(Boolean)
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(' ')
}

function listApps(): string[] {
    return readdirSync(abs('apps'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
}

/** The gated markdown, minus the append-only records — the files whose path citations must resolve. */
function gatedDocs(): string[] {
    const previousCwd = process.cwd()
    process.chdir(ROOT)
    try {
        return doctrineDocs().filter((file) => !EXEMPT.some((exempt) => file.startsWith(exempt)))
    } finally {
        process.chdir(previousCwd)
    }
}

// ---------------------------------------------------------------------------------------------
// the app's current identity, read from the tree
// ---------------------------------------------------------------------------------------------

interface Identity {
    dir: string
    slug: string
    packageName: string
    displayName: string
}

const APP_SLUG_LINE = /export const APP_SLUG = '([^']+)'/

function readIdentity(dir: string): Identity {
    const configPath = `apps/${dir}/config/app.ts`
    if (!existsSync(abs(configPath))) fail(`apps/${dir} has no config/app.ts — is that an app directory?`)
    const slugMatch = APP_SLUG_LINE.exec(readText(configPath))
    if (!slugMatch) fail(`${configPath} does not declare \`export const APP_SLUG = '…'\``)

    const pkg = readJson<PackageJson>(`apps/${dir}/package.json`)
    const catalog = readJson<Record<string, Record<string, string>>>(`apps/${dir}/messages/en.json`)
    const welcome = catalog.welcome ?? {}

    return {
        dir,
        slug: slugMatch[1],
        packageName: pkg.name ?? dir,
        // `welcome.appName` is the header prop an app passes to keel's AppHeader (the framework
        // catalog's `shell.appName` can only name one product — ADR-0012). Apps that predate the
        // prop only have a title, so fall back to it.
        displayName: welcome.appName ?? welcome.title ?? titleCase(dir),
    }
}

// ---------------------------------------------------------------------------------------------
// step 1 — the identity rename
// ---------------------------------------------------------------------------------------------

function renameApp(current: Identity, slug: string, displayName: string): void {
    const { dir, slug: oldSlug, packageName: oldPackage, displayName: oldName } = current

    // --- the app itself -------------------------------------------------------------------
    rewrite(
        `apps/${dir}/config/app.ts`,
        [
            [`export const APP_SLUG = '${oldSlug}'`, `export const APP_SLUG = '${slug}'`],
            [`\`${oldSlug}_session\``, `\`${slug}_session\``],
        ],
        `APP_SLUG → ${slug}`,
    )

    editJson<PackageJson>(`apps/${dir}/package.json`, 'package name + description', (pkg) => {
        pkg.name = slug
        pkg.description = `${displayName} — the application.`
    })

    for (const locale of ['en', 'es']) {
        editJson<Record<string, Record<string, string>>>(
            `apps/${dir}/messages/${locale}.json`,
            `welcome copy (${locale})`,
            (catalog) => {
                const welcome = catalog.welcome
                if (!welcome) return
                // Only the untouched default copy is replaced; copy the adopter has already
                // written is theirs, and re-running must not clobber it.
                if (welcome.appName === oldName) welcome.appName = displayName
                else if (welcome.appName !== undefined && welcome.appName !== displayName) {
                    note(skipped, `apps/${dir}/messages/${locale}.json welcome.appName is customised — left alone`)
                }
                if (welcome.title === oldName) welcome.title = displayName
                else if (welcome.title !== displayName) {
                    note(skipped, `apps/${dir}/messages/${locale}.json welcome.title is customised — left alone`)
                }
            },
        )
    }

    rewrite(
        `apps/${dir}/src/app/[locale]/layout.tsx`,
        [[`title: ${tsString(oldName)}`, `title: ${tsString(displayName)}`]],
        'document metadata title',
    )
    rewrite(
        `apps/${dir}/src/demo-static/index.html`,
        [[`<title>${oldName} `, `<title>${displayName} `]],
        'static-demo document title',
    )

    // --- the repo around it ---------------------------------------------------------------
    editJson<PackageJson>('package.json', 'root package identity + app-scoped scripts', (pkg) => {
        // NOT `slug`: the workspace root and an app sharing a name makes `pnpm --filter <slug> <script>`
        // match BOTH, and the root's scripts fan out to every app — so `pnpm --filter acme test:e2e`
        // started two dev servers on the same port. Watched failing with EADDRINUSE before this suffix.
        pkg.name = `${slug}-workspace`
        pkg.description = `${displayName} — a multi-tenant web application built on the keel template.`
        if (!pkg.scripts) return
        const scripts: Record<string, string> = {}
        for (const [name, command] of Object.entries(pkg.scripts)) {
            const renamed = name === `dev:${dir}` ? `dev:${slug}` : name
            scripts[renamed] = command.split(`--filter ${oldPackage} `).join(`--filter ${slug} `)
        }
        pkg.scripts = scripts
    })

    // The three root configs that name an app directory. Each was reduced to a single literal for
    // exactly this reason — see the header comments in the two vitest configs.
    rewrite('knip.json', [[`"apps/${dir}"`, `"apps/${slug}"`]], 'knip workspace key')
    rewrite(
        'vitest.config.ts',
        [
            [`'${dir}'`, `'${slug}'`],
            [`apps/${dir}/`, `apps/${slug}/`],
        ],
        'app list / framework-suite app',
    )
    rewrite('vitest.contract.config.ts', [[`'${dir}'`, `'${slug}'`]], 'contract app')
    // tsconfig.json deliberately needs NO rewrite: no path in it names an app. `@app-config/*`
    // points at packages/keel/test-fixture, and there is no `@/*` entry to repoint.
    // config/params too: infra/app.ts reads `params.database.transport` to pick the network shape. And
    // the app's tsconfig, which the stack bundles its Lambdas with (`APP_TSCONFIG`): it is what points
    // `@app-config/*` at this app's seam, so the migrator ships this app's migrations.
    for (const file of ['infra/app.ts', 'infra/stack.ts', 'infra/lib/tags.ts']) {
        rewrite(
            file,
            [
                [`apps/${dir}/config/app`, `apps/${slug}/config/app`],
                [`apps/${dir}/config/params`, `apps/${slug}/config/params`],
                [`apps/${dir}/tsconfig.json`, `apps/${slug}/tsconfig.json`],
            ],
            'app config imports',
        )
    }

    // --- the docs -------------------------------------------------------------------------
    for (const doc of gatedDocs()) {
        rewrite(
            doc,
            [
                [`apps/${dir}/`, `apps/${slug}/`],
                [`apps/${dir}\``, `apps/${slug}\``],
            ],
            'path citations',
        )
    }

    // --- and finally the directory --------------------------------------------------------
    if (dir !== slug) {
        if (existsSync(abs(`apps/${slug}`))) fail(`apps/${slug} already exists — pick another slug or remove it`)
        if (!dryRun) renameSync(abs(`apps/${dir}`), abs(`apps/${slug}`))
        retargetTouched(`apps/${dir}/`, `apps/${slug}/`)
        note(changed, `apps/${dir}/ → apps/${slug}/ — directory renamed`)
    }
}

// ---------------------------------------------------------------------------------------------
// step 2 — ejecting the showcase
// ---------------------------------------------------------------------------------------------

const SHOWCASE = 'showcase'

/**
 * Two things inside the showcase are not the demo: the RLS contract harness (generic — it runs
 * keel's composed proof runner against real Postgres, and is the anti-drift gate CI depends on) and
 * `config/params.ts` (the deployment-parameter scaffold every cutover row points at). Deleting the
 * directory around them would quietly delete a gate, so they are relocated to the surviving app
 * first. Everything else in there is the demo product.
 */
function rescueFromShowcase(onDisk: string): void {
    const contractSource = abs(`apps/${SHOWCASE}/tests/contract`)
    const contractTarget = abs(`apps/${onDisk}/tests/contract`)
    if (existsSync(contractSource) && !existsSync(contractTarget)) {
        if (!dryRun) {
            mkdirSync(path.dirname(contractTarget), { recursive: true })
            cpSync(contractSource, contractTarget, { recursive: true })
        }
        note(changed, `apps/${onDisk}/tests/contract/ — RLS contract harness relocated from the showcase`)
    }

    const paramsSource = `apps/${SHOWCASE}/config/params.ts`
    const paramsTarget = `apps/${onDisk}/config/params.ts`
    if (existsSync(abs(paramsSource)) && !existsSync(abs(paramsTarget))) {
        if (!dryRun) cpSync(abs(paramsSource), abs(paramsTarget))
        note(changed, `${paramsTarget} — deployment params relocated from the showcase`)
    }

    // The harness imports embedded-postgres/pg/vitest; with pnpm's isolated node_modules those must
    // be declared by the package the test file now lives in, or a root-run `pnpm test:contract`
    // cannot resolve them.
    const showcasePkg = readJson<PackageJson>(`apps/${SHOWCASE}/package.json`)
    editJson<PackageJson>(`apps/${onDisk}/package.json`, 'contract-harness devDependencies', (pkg) => {
        const devDependencies = { ...pkg.devDependencies }
        for (const dependency of ['embedded-postgres', 'pg', 'vitest']) {
            const version = showcasePkg.devDependencies?.[dependency]
            if (version && !devDependencies[dependency]) devDependencies[dependency] = version
        }
        pkg.devDependencies = Object.fromEntries(Object.entries(devDependencies).sort(([a], [b]) => a.localeCompare(b)))
    })
}

/**
 * `survivor` is the app's name AFTER the rename (what the rewritten files should say); `onDisk` is
 * the directory that exists right now. They differ under --dry-run, where the rename was only
 * printed — so reads use `onDisk` and rewrites use `survivor`, and the preview stays honest.
 */
function ejectShowcase(survivor: string, onDisk: string): void {
    if (!existsSync(abs(`apps/${SHOWCASE}`))) {
        note(skipped, 'apps/showcase is already gone — nothing to eject')
        return
    }
    if (survivor === SHOWCASE) fail('cannot eject the showcase while it is the only app')

    rescueFromShowcase(onDisk)

    const survivorPkg = readJson<PackageJson>(`apps/${onDisk}/package.json`)
    const survivorName = survivorPkg.name ?? survivor
    const survivorScripts = new Set(Object.keys(survivorPkg.scripts ?? {}))

    // --- delete ---------------------------------------------------------------------------
    // `llm-record` is not on this list because it lives INSIDE the demo app (apps/showcase/scripts):
    // it reads that app's assistant registration and writes that app's fixtures, so it goes with it.
    for (const victim of [`apps/${SHOWCASE}`, 'packages/seed']) {
        if (!existsSync(abs(victim))) continue
        if (!dryRun) rmSync(abs(victim), { recursive: true, force: true })
        note(changed, `${victim} — removed`)
    }

    // --- repoint what named it --------------------------------------------------------------
    editJson<PackageJson>('package.json', 'root scripts repointed at the surviving app', (pkg) => {
        if (!pkg.scripts) return
        const scripts: Record<string, string> = {}
        for (const [name, command] of Object.entries(pkg.scripts)) {
            const next = command.split(`--filter ${SHOWCASE} `).join(`--filter ${survivorName} `)
            // A root script is a thin delegation; if the surviving app has no such script, the root
            // one would only ever produce "No projects matched". Drop it and say so.
            const delegated = /^pnpm --filter \S+ (\S+)$/.exec(next)
            if (delegated && !survivorScripts.has(delegated[1])) {
                note(skipped, `root script "${name}" dropped — apps/${survivor} has no ${delegated[1]} script`)
                continue
            }
            // `dev:<survivor>` existed only to reach the second app past the showcase-bound `dev`.
            if (name === `dev:${survivor}` && scripts.dev === next) {
                note(skipped, `root script "${name}" dropped — "dev" now means the same thing`)
                continue
            }
            scripts[name] = next
        }
        pkg.scripts = scripts
    })

    editJson<{ workspaces?: Record<string, { includeEntryExports?: boolean }> }>(
        'knip.json',
        'workspaces (and keel back to entry-point semantics)',
        (config) => {
            if (!config.workspaces) return
            delete config.workspaces[`apps/${SHOWCASE}`]
            delete config.workspaces['packages/seed']
            // `includeEntryExports: true` means "every symbol keel PUBLISHES must have a consumer"
            // (ADR-0012). That invariant was true because the showcase used nearly all of it; with a
            // one-entity app it stops being a dead-code signal and starts demanding you delete 47
            // framework capabilities you merely have not reached yet. The declared surface goes back
            // to being entry points, and knip keeps reporting unused FILES.
            const keel = config.workspaces['packages/keel']
            if (keel?.includeEntryExports) keel.includeEntryExports = false
        },
    )

    // Only the app list: keel's own vitest project runs against packages/keel/test-fixture and names no
    // app, so ejecting the demo leaves the framework's suite entirely alone.
    rewrite(
        'vitest.config.ts',
        [
            [`const APPS = ['${SHOWCASE}', '${survivor}'] as const`, `const APPS = ['${survivor}'] as const`],
            [`const APPS = ['${survivor}', '${SHOWCASE}'] as const`, `const APPS = ['${survivor}'] as const`],
        ],
        'app list collapsed to the surviving app',
    )
    rewrite(
        'vitest.contract.config.ts',
        [[`const CONTRACT_APP = '${SHOWCASE}'`, `const CONTRACT_APP = '${survivor}'`]],
        'contract app',
    )
    // tsconfig.json needs no rewrite here either — see the rename path. Its `@app-config/*` pointing
    // at packages/keel/test-fixture is what keeps `tsc` green through an eject.
    // config/params moved to the survivor above (rescueFromShowcase), so the stack's import follows it.
    // So does the tsconfig the stack bundles with: the survivor's seam, and so its migrations.
    for (const file of ['infra/app.ts', 'infra/stack.ts', 'infra/lib/tags.ts']) {
        rewrite(
            file,
            [
                [`apps/${SHOWCASE}/config/app`, `apps/${survivor}/config/app`],
                [`apps/${SHOWCASE}/config/params`, `apps/${survivor}/config/params`],
                [`apps/${SHOWCASE}/tsconfig.json`, `apps/${survivor}/tsconfig.json`],
            ],
            'app config imports',
        )
    }

    for (const doc of gatedDocs()) {
        rewrite(
            doc,
            [
                [`apps/${SHOWCASE}/`, `apps/${survivor}/`],
                [`apps/${SHOWCASE}\``, `apps/${survivor}\``],
                // The showcase kept its seed in a workspace package; the surviving app keeps its own
                // inside the app, which is the seam's whole point (WHERE it lives is the app's business).
                ['`packages/seed`', `\`apps/${survivor}/src/seed\``],
            ],
            'path citations',
        )
    }
}

// ---------------------------------------------------------------------------------------------
// step 3 — scrub the maintainer's identity from adopter-facing contact/review files
// ---------------------------------------------------------------------------------------------

/** The files whose links name a repository. CODEOWNERS is not one: it names only an owner. */
const CONTACT_LINK_FILES = ['SECURITY.md', '.github/ISSUE_TEMPLATE/config.yml', 'CODE_OF_CONDUCT.md']

/**
 * Four files route the ADOPTER's users to the TEMPLATE maintainer: a security report, two issue-
 * template links, and the code-of-conduct contact all point at `jpslav`/`jpslav/keel`. Left alone,
 * an ejected repo asks its own reporters to file against someone else's inbox — and CODEOWNERS is
 * worse than silent about it: with "require review from Code Owners" branch protection on and
 * `@jpslav` not a collaborator, GitHub reports an unknown owner and every PR becomes unmergeable.
 *
 * This runs unconditionally, whenever `main` gets past its own usage check (so on a rename-only
 * adoption too) — these are repo-identity files, not app files, so the leak exists independent of
 * whether the showcase is ever ejected.
 *
 * Follows the `PLACEHOLDER_` convention from `apps/showcase/config/params.ts`: a value that reads as
 * "you must supply this" rather than a name that happens to be wrong. The links name a repository, and
 * the repository is NOT the app: this function used to write the app's slug there, which is right only
 * when a repo is named after its one app, and silently wrong otherwise (an app `console` kept in a repo
 * `pages` got `…/console/security/advisories/new`, a link that 404s and looks plausible). So the repo
 * name is its own input, `--repo`, and without it the link carries `PLACEHOLDER_GITHUB_REPO`.
 *
 * It is deliberately NOT read from `git remote get-url origin`. At adoption time that remote is often
 * still the template itself or a fork under its default name, so a derived value would be plausible
 * and wrong with nothing to flag it, and `--dry-run` would print a different plan on every machine.
 *
 * NOT touched, and deliberately so:
 *   - `LICENSE` — MIT requires preserving the copyright notice verbatim.
 *   - `docs/adr/**` approver lines — honest provenance for keel's OWN decisions, which an adopter
 *     inherits as historical record, not as their own project's contact info.
 */
/**
 * Where the contact links stand, which decides what `--repo` can do and what the output may claim:
 *   - `template`:    they still name `jpslav/keel` — the first adoption, with a repository to write.
 *   - `placeholder`: an earlier run wrote `PLACEHOLDER_GITHUB_REPO` (no `--repo` then). A `--repo` now
 *                    fills it in, which is what makes "I forgot the flag" a re-run and not a hand edit.
 *   - `settled`:     neither — they name a repository already. `--repo` has nothing to replace.
 * Read from the files, before any rewrite, so `--dry-run` and the confirmation summary tell the truth too.
 */
type ContactLinks = 'template' | 'placeholder' | 'settled'

const TEMPLATE_ADVISORY = 'github.com/jpslav/keel/security/advisories/new'
const TEMPLATE_DISCUSSIONS = 'github.com/jpslav/keel/discussions'
const PLACEHOLDER_HOME = `github.com/${PLACEHOLDER_OWNER}/${PLACEHOLDER_REPO}`
/**
 * The repository placeholder as a path SEGMENT, which is all that is ever replaced: an adopter who has
 * already filled in the owner (`github.com/myorg/PLACEHOLDER_GITHUB_REPO`) is the natural order, since the
 * closing output lists both placeholders, and must not be told there is nothing left to fill.
 */
const REPO_SEGMENT = `/${PLACEHOLDER_REPO}/`

function contactLinks(): ContactLinks {
    const text = CONTACT_LINK_FILES.filter((file) => existsSync(abs(file)))
        .map(readText)
        .join('\n')
    if (text.includes(TEMPLATE_ADVISORY) || text.includes(TEMPLATE_DISCUSSIONS)) return 'template'
    return text.includes(REPO_SEGMENT) ? 'placeholder' : 'settled'
}

function rewriteAdopterIdentity(repo: string | null, links: ContactLinks): void {
    const home = `github.com/${PLACEHOLDER_OWNER}/${repo ?? PLACEHOLDER_REPO}`
    const newAdvisory = `${home}/security/advisories/new`
    // Replacing the segment with itself is skipped by `rewrite`, so this is inert without --repo.
    const fillRepo: [string, string] = [REPO_SEGMENT, `/${repo ?? PLACEHOLDER_REPO}/`]

    if (repo !== null && links === 'settled') {
        note(
            skipped,
            `--repo ${repo} ignored: the links in ${CONTACT_LINK_FILES.join(', ')} no longer name the template or ` +
                `${PLACEHOLDER_REPO} — edit them directly`,
        )
    }

    rewrite(
        'CODEOWNERS',
        [
            [
                "# Every change gets the maintainer's review by default.",
                `# ${PLACEHOLDER_OWNER} is not a real account — replace every occurrence below with the\n` +
                    '# GitHub user or team who should review changes here before you turn on "require review\n' +
                    '# from Code Owners" branch protection. The path list itself is untouched: it is what a\n' +
                    '# wrong change is expensive and quiet, not who you are.\n' +
                    '#\n' +
                    "# Every change gets its owner's review by default.",
            ],
            ['@jpslav', `@${PLACEHOLDER_OWNER}`],
        ],
        'code owner → placeholder you must fill in',
    )

    rewrite('SECURITY.md', [[TEMPLATE_ADVISORY, newAdvisory], fillRepo], 'advisory URL → your own repo')

    rewrite(
        '.github/ISSUE_TEMPLATE/config.yml',
        [[TEMPLATE_ADVISORY, newAdvisory], [TEMPLATE_DISCUSSIONS, `${home}/discussions`], fillRepo],
        'contact links → your own repo',
    )

    rewrite('CODE_OF_CONDUCT.md', [[TEMPLATE_ADVISORY, newAdvisory], fillRepo], 'enforcement contact → your own repo')
}

// ---------------------------------------------------------------------------------------------
// step 4 — the two post-passes that keep the gate green
// ---------------------------------------------------------------------------------------------

/**
 * A citation rewritten from one app to another can point at something the new app does not have:
 * the scaffold docs teach `src/jobs/`, `src/domain/`, `src/app/api/` because the SHOWCASE has them,
 * and the starter does not. Those sentences never meant "this app" — they meant "your app" — so the
 * honest repair is the metavariable form the path gate already understands (`apps/<app>/…` asserts
 * only that `apps/` exists).
 *
 * The rewrite itself is `doc-set.ts`'s `generalizeAppCitations`, beside the parser that produced the
 * citations — one backticked span can hold SEVERAL of them, and getting that wrong left a command
 * half-rewritten (see the note there). This runs LAST and uses the gate's own parser and resolution
 * rule, which is what makes "after init-app, `pnpm exec vitest run tests/docs/doc-paths.test.ts`
 * passes" a property rather than a hope.
 */
function repairAppCitations(): void {
    const previousCwd = process.cwd()
    process.chdir(ROOT)
    try {
        for (const doc of doctrineDocs()) {
            if (EXEMPT.some((exempt) => doc.startsWith(exempt))) continue
            const before = readFileSync(doc, 'utf8')
            const after = generalizeAppCitations(before, (cited) => !resolves(cited))
            if (after === before) continue
            touched.add(doc)
            if (!dryRun) writeFileSync(doc, after)
            note(changed, `${doc} — citations of files this app does not have generalised to apps/<app>/`)
        }
    } finally {
        process.chdir(previousCwd)
    }
}

/**
 * Prettier over exactly the files that were written. Shortening `apps/showcase` to `apps/acme`
 * re-wraps every markdown table it appears in, and re-emitted JSON does not match prettier's array
 * wrapping — so without this, adoption's first `pnpm lint` fails on formatting alone. The house rule
 * is "run the formatter, never hand-format"; this is the script obeying it.
 */
function formatTouchedFiles(): void {
    const formattable = [...touched].filter((file) => /\.(ts|tsx|json|md|mjs|cjs|css)$/.test(file))
    if (dryRun || formattable.length === 0) return
    const prettier = abs('node_modules/.bin/prettier')
    if (!existsSync(prettier)) {
        note(skipped, 'prettier not installed — run `pnpm lint:fix` before committing')
        return
    }
    const result = spawnSync(prettier, ['--write', '--log-level', 'warn', ...formattable], {
        cwd: ROOT,
        stdio: 'inherit',
    })
    if (result.status === 0) note(changed, `${formattable.length} files — reformatted with prettier`)
    else note(skipped, 'prettier exited non-zero — run `pnpm lint:fix` before committing')
}

// ---------------------------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------------------------

/** Files that still SAY "showcase" (or the old app name) in prose a path rewrite cannot fix. */
function proseToReview(words: string[]): string[] {
    const hits: string[] = []
    for (const doc of gatedDocs()) {
        if (!existsSync(abs(doc))) continue
        const text = readText(doc).toLowerCase()
        if (words.some((word) => text.includes(word.toLowerCase()))) hits.push(doc)
    }
    return hits
}

/**
 * `rewriteAdopterIdentity` used to be invisible: it fell inside the OLD "WHAT THIS DID NOT TOUCH"
 * list, which is precisely where a careful adopter looks for exactly this kind of thing — and got
 * exactly the wrong answer. Now that init-app touches these files, they get their own section, named
 * for what is still missing (real values) rather than what already happened (a rewrite).
 */
function reportNeedsYourDetails(repo: string | null, links: ContactLinks): void {
    // What the three contact files say AFTER this run, from what the run found in them: never from
    // `repo` alone, because a `--repo` on links that were already settled changed nothing.
    const named = repo !== null && links !== 'settled'
    const home = named
        ? `github.com/${PLACEHOLDER_OWNER}/${repo}`
        : links === 'settled'
          ? 'the repository it already names (this run did not change it)'
          : links === 'template'
            ? PLACEHOLDER_HOME
            : `github.com/<owner>/${PLACEHOLDER_REPO}`
    const repoBullet =
        links !== 'settled' && !named
            ? `
  • The repository name — SECURITY.md, the issue-template config and CODE_OF_CONDUCT.md say
    ${PLACEHOLDER_REPO}, because no --repo was given and the app slug is not a reliable guess
    (a "console" app can live in a repo called "pages"). Run \`pnpm init-app --repo <name>\` to fill it in,
    or replace it by hand with the repository's NAME, not the slug. To list every placeholder, owner and
    repo both:
      git grep PLACEHOLDER_GITHUB -- CODEOWNERS SECURITY.md CODE_OF_CONDUCT.md .github`
            : ''
    console.log(`
WHAT NOW NEEDS YOUR DETAILS — placeholders init-app just wrote, not left alone:

  • CODEOWNERS — every @${PLACEHOLDER_OWNER} is the GitHub user or team who should review changes
    here. Fill it in before you turn on "require review from Code Owners" branch protection, or
    GitHub reports an unknown owner and every PR becomes unmergeable.${repoBullet}
  • SECURITY.md — the advisory link now points at ${home},
    which only resolves once you have pushed to that repo AND switched on private vulnerability
    reporting (Settings → Code security). It is OFF by default, and until it is on a reporter
    following your own security policy gets a 404 and no private channel at all.
  • .github/ISSUE_TEMPLATE/config.yml — same two links, same fix. Its Discussions link additionally
    needs Discussions enabled (Settings → General → Features); if you do not want Discussions,
    delete that contact link rather than shipping one that 404s.
  • CODE_OF_CONDUCT.md — the enforcement contact points at the same advisory link, for the same
    reason: it is your repo's only private inbound channel once you have one.`)
}

/**
 * The starter's own content gets a section of its own, for the reason `reportNeedsYourDetails` does:
 * it used to be two bullets here ("Your seed world", "Your domain") that named a directory and said
 * nothing about what a visitor SEES. An adopter built a product world beside the starter's and
 * shipped a static demo that opened on the starter's tenants and Items card. Nothing failed, because
 * leftover content is not an error any gate can name — so the list has to.
 *
 * Printed only when the app being kept has the starter's layout (`hasStarterContent`). `--app
 * showcase` keeps an app whose seed lives in a workspace package and which has no Items slice, and
 * for it every path and every instruction below would be false.
 */
/**
 * The survivor's static-demo size budget, read from its own `check:demo-size` script, because the bullet
 * states it back and a number written here would be stale the first time the app re-sets it. `null` means
 * say nothing rather than guess: no such script, or one that is not exactly the shape the template ships
 * (a number then `&& …`, a quoted or underscored number: `Number('820_000')` is NaN, so the script would
 * refuse what this would have printed). `hasNote` is whether the app has a DEMO-SIZE.md beside the number.
 */
type DemoBudget = { bytes: string; hasNote: boolean } | null

function readDemoBudget(onDisk: string): DemoBudget {
    const file = `apps/${onDisk}/package.json`
    if (!existsSync(abs(file))) return null
    const script = readJson<PackageJson>(file).scripts?.['check:demo-size']
    const bytes = /check-demo-size\.mjs\s+(\d+)\s*$/.exec(script ?? '')?.[1]
    return bytes ? { bytes, hasNote: existsSync(abs(`apps/${onDisk}/DEMO-SIZE.md`)) } : null
}

/**
 * Why this is in "WHAT THIS DID NOT TOUCH" and not something init-app does: the budget is a number the
 * adopter has to own. And why it says where to record a change: the obvious place is the header of
 * scripts/check-demo-size.mjs, which is keel's, so a note written there is a conflict on every later upstream
 * merge (ADR-0013). The history lives beside the number, in the app's own DEMO-SIZE.md where it has one.
 */
function demoBudgetBullet(survivor: string, budget: DemoBudget): string {
    if (budget === null) return ''
    const paragraph =
        `The demo size budget — apps/${survivor}/package.json's check:demo-size passes the static demo's byte ` +
        `budget, ${budget.bytes}. It is yours now.` +
        (budget.hasNote
            ? ` apps/${survivor}/DEMO-SIZE.md says what the number was set for, and is where you record each change ` +
              'and why.'
            : '') +
        " scripts/check-demo-size.mjs is keel's, and an upstream merge will change it: re-set the number in " +
        "package.json, never in the script. When it goes red, that script's header says what to look at first."
    return `\n${wrapBullet(paragraph)}`
}

/** One "  • " bullet, word-wrapped to the width the hand-written bullets around it keep. */
function wrapBullet(paragraph: string, width = 100): string {
    const lines: string[] = []
    let line = '  •'
    for (const word of paragraph.split(' ')) {
        if (line.length + 1 + word.length > width) {
            lines.push(line)
            line = `    ${word}`
        } else line += ` ${word}`
    }
    lines.push(line)
    return lines.join('\n')
}

function reportUntouched(
    survivor: string,
    hasParams: boolean,
    hasStarterContent: boolean,
    demoBudget: DemoBudget,
): void {
    const params = hasParams
        ? `apps/${survivor}/config/params.ts. Every PLACEHOLDER_ value, and\n    sentry.org. Each maps to a row in docs/cutover-checklist.md.`
        : `apps/${survivor} ships no config/params.ts yet. You get one when you eject the\n    showcase, or write it when you reach your first cloud cutover row.`
    console.log(`
WHAT THIS DID NOT TOUCH — the parts that need judgement, not a rename:

  • Deployment parameters — ${params}
  • The cutover checklist — docs/cutover-checklist.md is yours: owners, dates, and the proof each
    row owes. Nothing here closed a row.${demoBudgetBullet(survivor, demoBudget)}
  • The licence — this template is MIT; your product's licence is still yours to choose.
  • Git remotes, CI secrets, and infra account IDs.`)
    if (hasStarterContent) {
        console.log(`
STARTER CONTENT STILL WIRED INTO YOUR UI — renamed around, not removed. No gate fails on any of
it, so it stays on screen until you replace it (skip whatever you already have):

  • The seed world — apps/${survivor}/src/seed/. Its tenants, teams and people are on EVERY sign-in
    picker: the app's, the static demo's, the Simulator's. Replace them; a product world added
    beside them shows both. staffOrgSlug in apps/${survivor}/src/app-config/abilities.ts must name
    a real seed org, and the app's two specs sign in by the starter's person ids.
  • The welcome subtitle — welcome.subtitle in apps/${survivor}/messages/{en,es}.json. Only the
    title and appName were rewritten. It is on the root page and the static demo's first screen.
  • The Items slice — the card, its API route, its dashboard glue, its table, migration,
    ability and RLS proof, and the "items" catalog namespace. It is every signed-in person's
    dashboard. Copy its RLS pattern into your first real slice, then delete it.
  • The static demo's wiring — apps/${survivor}/src/demo-static/app.tsx. A shell or home screen
    you build reaches the demo only through the nav, welcome and dashboard props passed there.

  docs/adopting.md, "The starter's content is still wired into your UI", has the full sweep.`)
    }
    console.log(`
NEXT: \`pnpm install\` (the workspace changed), then \`pnpm verify\`.

COMMIT \`pnpm-lock.yaml\` along with everything else. Renaming an app and dropping packages
changes the lockfile, and CI installs with --frozen-lockfile by default — so leaving it
behind fails your first push with an error that does not mention this command.`)
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

/**
 * `--repo` is the repository NAME. Two mistakes are easy to make, so they get messages of their own: `owner/name` (the owner is a
 * separate placeholder on purpose — it also fills CODEOWNERS, where it may be a team) and a clone URL's
 * `.git` suffix. For the rest: the characters GitHub repository names use (letters, digits, `.`, `_`, `-`),
 * at most 100 of them, and never `.` or `..`.
 */
function checkRepoName(repo: string): void {
    if (repo.includes('/')) {
        fail(`--repo takes the repository NAME only ("pages"), not "${repo}": the owner stays ${PLACEHOLDER_OWNER}`)
    }
    if (/\.git$/i.test(repo))
        fail(`--repo "${repo}": drop the .git suffix — it is the repository name, not a clone URL`)
    if (repo === PLACEHOLDER_REPO) fail(`--repo "${repo}" is the placeholder itself: give the real repository name`)
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === '.' || repo === '..') {
        fail(`"${repo}" is not a valid GitHub repository name: letters, digits, ".", "_" and "-"`)
    }
}

async function confirm(summary: string[], assumeYes: boolean): Promise<void> {
    console.log('init-app will:\n')
    for (const line of summary) console.log(`  • ${line}`)
    console.log('')
    if (assumeYes) return
    if (!process.stdin.isTTY) {
        console.error('init-app rewrites and deletes files. Re-run with --yes to confirm, or --dry-run to preview.')
        process.exit(1)
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question('Proceed? [y/N] ')
    rl.close()
    if (!/^y(es)?$/i.test(answer.trim())) {
        console.log('nothing changed.')
        process.exit(0)
    }
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2))
    dryRun = options.dryRun

    // `--repo` alone is a real run: it fills the repository name in on a tree adopted without it.
    if (!options.slug && !options.ejectShowcase && options.repo === null) {
        console.log(USAGE)
        process.exit(0)
    }

    const apps = listApps()
    if (apps.length === 0) fail('no apps found under apps/')

    // Default target: the starter (the app the template tells you to keep), else the first app that
    // is not the demo, else whatever single app is left.
    const nonDemo = apps.filter((app) => app !== SHOWCASE)
    const defaultDir = apps.includes('starter') ? 'starter' : (nonDemo[0] ?? apps[0])
    const targetDir = options.app ?? defaultDir
    if (!apps.includes(targetDir)) fail(`apps/${targetDir} does not exist (found: ${apps.join(', ')})`)

    const current = readIdentity(targetDir)
    const slug = options.slug
    if (slug !== null) {
        if (!/^[a-z][a-z0-9-]*$/.test(slug)) fail(`"${slug}" is not a valid slug: lowercase letters, digits, dashes`)
        if (slug === SHOWCASE) fail('"showcase" is reserved for the demo app')
        // `keel` is the framework package's own workspace name (and its vitest project's), so an app
        // called that would collide in pnpm-workspace before this script's work could even be tested.
        if (slug === 'keel') fail('"keel" is reserved for the framework package')
    }
    if (options.repo !== null) checkRepoName(options.repo)
    if (options.displayName !== null && slug === null) fail('--name goes with a slug: it names the app being renamed')
    const displayName = options.displayName ?? (slug ? titleCase(slug) : current.displayName)
    const survivor = slug ?? targetDir

    const summary: string[] = []
    if (slug) {
        summary.push(`rename apps/${targetDir} → apps/${slug} (APP_SLUG "${current.slug}" → "${slug}")`)
        summary.push(`set the display name "${current.displayName}" → "${displayName}" in copy and titles`)
        summary.push(`rename the root package to "${slug}" and repoint every app-scoped script`)
    }
    if (options.ejectShowcase) {
        summary.push('rescue the RLS contract harness and config/params.ts into the surviving app')
        summary.push('DELETE apps/showcase and packages/seed')
        summary.push('repoint tsconfig, both vitest configs, knip and infra at the surviving app')
    }
    // `--repo` alone is the fix-up for a tree init-app already adopted, and does only that: no citations, no
    // prose review, no "run pnpm install" (nothing about the workspace changed).
    const repoOnly = !slug && !options.ejectShowcase
    if (!repoOnly) {
        summary.push('repoint path citations in the gated docs (docs/, .claude/, README, CLAUDE, CONTRIBUTING)')
        summary.push(
            `replace the maintainer's identity in CODEOWNERS, SECURITY.md, the issue-template config and ` +
                `CODE_OF_CONDUCT.md with ${PLACEHOLDER_OWNER}`,
        )
    }
    const links = contactLinks()
    // On a tree init-app has not adopted, `--repo` alone would scrub the maintainer's identity and leave
    // everything else, a half-adoption nobody asked for.
    if (repoOnly && links === 'template') {
        fail('--repo on its own only fills in a repository name on a tree init-app has already adopted; give a slug')
    }
    if (links === 'settled') {
        if (options.repo)
            summary.push(`NOT change the contact links: they no longer name the template, so --repo is ignored`)
    } else {
        const name = options.repo ?? PLACEHOLDER_REPO
        summary.push(
            `point the contact links at github.com/${PLACEHOLDER_OWNER}/${name}` +
                (options.repo ? '' : ' (no --repo given: the repository name stays a placeholder)'),
        )
    }
    if (dryRun) summary.push('(--dry-run: nothing will actually be written)')

    await confirm(summary, options.assumeYes || dryRun)

    if (slug) renameApp(current, slug, displayName)
    if (options.ejectShowcase) ejectShowcase(survivor, dryRun ? targetDir : survivor)
    rewriteAdopterIdentity(options.repo, links)
    if (!repoOnly) repairAppCitations()
    formatTouchedFiles()

    console.log(`\n${dryRun ? 'WOULD CHANGE' : 'CHANGED'} (${changed.length}):`)
    for (const line of changed) console.log(`  ${line}`)
    if (changed.length === 0) console.log('  nothing — the tree already matches what you asked for')

    if (skipped.length) {
        console.log(`\nNOT CHANGED (${skipped.length}):`)
        for (const line of skipped) console.log(`  ${line}`)
    }

    if (repoOnly) {
        reportNeedsYourDetails(options.repo, links)
        return
    }

    const words = options.ejectShowcase ? [SHOWCASE, current.displayName] : [current.displayName]
    const review = proseToReview(words)
    if (review.length) {
        console.log(`\nPROSE STILL TO REVIEW — these name ${words.map((w) => `"${w}"`).join(' or ')} in sentences a`)
        console.log('path rewrite cannot fix (the docs still describe the template, not your product):')
        for (const doc of review) console.log(`  ${doc}`)
    }

    reportNeedsYourDetails(options.repo, links)

    // `survivor` is the name AFTER the rename; on disk that directory only exists if the rename
    // actually ran, so a dry run still has to look under the old name (the ejectShowcase convention).
    const survivorOnDisk = dryRun ? targetDir : survivor
    reportUntouched(
        survivor,
        options.ejectShowcase || existsSync(abs(`apps/${survivorOnDisk}/config/params.ts`)),
        existsSync(abs(`apps/${survivorOnDisk}/src/seed`)),
        readDemoBudget(survivorOnDisk),
    )
}

// Not top-level await: the root package is CJS, so tsx transforms this file to CommonJS.
main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
})
