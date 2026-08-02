import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'

/**
 * WHICH MARKDOWN THIS REPO HOLDS TO ITS PATH CITATIONS.
 *
 * Two callers need the same answer and must never drift apart: `doc-paths.test.ts`, which fails the
 * build when a doctrine doc cites a path that does not exist, and `scripts/init-app.ts`, which
 * repoints those citations when an adopter renames an app or ejects the showcase. A second list
 * would mean the rewriter could miss a file the gate checks — a broken gate on the adopter's first
 * command, which is the exact failure this whole seam exists to remove.
 */

/** Prefixes that make a backticked token unambiguously a path in THIS repo. */
const REPO_ROOTS = [
    'apps/',
    'src/',
    'packages/',
    'docs/',
    'tests/',
    'scripts/',
    'config/',
    'infra/',
    'fixtures/',
    'messages/',
    '.claude/',
    '.github/',
    'spikes/',
]

/**
 * Exempt, and why — each of these is an append-only record whose entries were true on the date they
 * were written. Rewriting them to match today's tree would be revisionist, so they are corrected
 * opportunistically but never gated (and never rewritten by `init-app`).
 */
export const EXEMPT = [
    'docs/adr/', // dated decisions; amended by appending a dated addendum, never by editing the body
    'docs/build-notes.md', // running log of dated lessons
    'docs/decision-log.md', // running log of dated decisions
    '.claude/future-tasks/resolved/', // finished tasks; the work that resolved one routinely moved what it cites
    '.claude/worktrees/', // linked worktrees from agent sessions, not this checkout's content
]

function collectDocs(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (EXEMPT.some((e) => path.startsWith(e))) continue
        if (statSync(path).isDirectory()) collectDocs(path, out)
        else if (extname(path) === '.md') out.push(path)
    }
    return out
}

/**
 * Every gated markdown file, as repo-relative paths. Call with the repo root as the cwd.
 *
 * The root-level entries are listed rather than globbed because a repo root accumulates markdown that
 * is NOT doctrine (a stray NOTES.md should not become a build gate). SECURITY.md earns its place by
 * citing the code that backs its claims — an RLS proof suite, a fail-closed guard.
 *
 * Be precise about what that buys: `resolves()` below keeps a FILE citation alive on its parent
 * directory existing, so gating SECURITY.md catches a moved DIRECTORY, not a moved file. That is a
 * deliberate trade (recipes cite files you are meant to create), and it is measured: 22 citations
 * across the doc set resolve only by that fallback, nearly all of them legitimately unbuilt.
 */
export function doctrineDocs(): string[] {
    return [
        ...collectDocs('docs'),
        ...collectDocs('.claude'),
        'README.md',
        'CLAUDE.md',
        'CONTRIBUTING.md',
        'SECURITY.md',
        'CODE_OF_CONDUCT.md',
    ]
}

/**
 * Build outputs are never checked. A doc may legitimately name one — the static demo's
 * `dist-demo/index.html` is the artifact you hand someone — but whether it exists on disk depends on
 * whether you happened to run a build, which would make this gate pass locally and fail on a clean
 * checkout. A gate whose verdict depends on build state is not a gate.
 */
const BUILD_OUTPUTS = ['dist-demo', '.next', 'coverage', 'playwright-report', 'test-results', 'node_modules', '.data']

/** Backtick-quoted spans, which is how this doc set cites every path. */
const BACKTICKED = /`([^`\n]+)`/g

export interface Citation {
    /** The path as the gate reads it: globs and `<metavariables>` truncated to their static prefix. */
    path: string
    /**
     * The full backticked span the path was read out of — which for a command citation is the whole
     * command, not just the path, and can therefore be SHARED by several citations. It must stay the
     * span: narrowing it to the path alone would stop matching the file for the rewriter below, which
     * replaces spans. `generalizeAppCitations` is the only sanctioned way to rewrite on it — see the
     * one-span-many-citations trap documented there.
     */
    raw: string
    line: number
}

/**
 * The path-like tokens inside one backticked span.
 *
 * Usually the span IS the path — `apps/showcase/src/app-config` — and that stays one citation. But
 * the doc set also cites paths INSIDE backticked commands, and such a span starts with `pnpm` or
 * `git`, not with a repo root. Reading whole spans only, the gate could not see those at all, and
 * two had rotted unnoticed: a `fixtures/llm/` and a `tests/e2e/a11y.spec.ts` that had both moved
 * under `apps/showcase/`. A gate blind to a whole citation FORM is not a gate over that form.
 */
function pathTokens(raw: string): string[] {
    if (REPO_ROOTS.some((root) => raw.startsWith(root))) return [raw]
    return raw
        .split(/\s+/)
        .map((token) =>
            token
                .replace(/^['"]+|['"]+$/g, '') // `pnpm --filter './apps/*'`
                .replace(/^\.\//, '') // ./apps/... is the same path as apps/...
                .replace(/[,;)]+$/, ''),
        )
        .filter((token) => REPO_ROOTS.some((root) => token.startsWith(root)))
}

function citationsIn(text: string): Citation[] {
    const found: Citation[] = []
    text.split('\n').forEach((text, index) => {
        for (const match of text.matchAll(BACKTICKED)) {
            const raw = match[1].trim()
            for (const token of pathTokens(raw)) {
                // A trailing `:12` (or `:12:5`) is a LINE REFERENCE into the file, not part of its
                // name — `docs/build-notes.md:52` asserts that document exists, and read literally it
                // asserts a file nothing could ever create.
                const located = token.replace(/:\d+(?::\d+)?$/, '')
                // A glob, a brace expansion or a `<metavariable>` placeholder only asserts its static
                // prefix exists — `packages/keel/src/adapters/<real|fake>/<name>.ts` is a template,
                // and `messages/{en,es}.json` names two files, neither of them spelled that way.
                const stop = ['*', '<', '{'].map((char) => located.indexOf(char)).filter((i) => i >= 0)
                const stripped = stop.length ? located.slice(0, Math.min(...stop)) : located
                const path = stripped.replace(/\/+$/, '')
                if (!path) continue
                if (path.split('/').some((segment) => BUILD_OUTPUTS.includes(segment))) continue
                found.push({ path, raw, line: index + 1 })
            }
        }
    })
    return found
}

export function citedPaths(file: string): Citation[] {
    return citationsIn(readFileSync(file, 'utf8'))
}

/** The `apps/<name>/` prefix of a citation, with globs and metavariables already excluded. */
const APP_PREFIX = /^apps\/[^/<*{]+\//

/**
 * Generalize every citation of an app path that `isMissing` reports as gone into the metavariable
 * form `apps/<app>/…`, which the gate reads as asserting only that `apps/` exists.
 *
 * `scripts/init-app.ts` is the caller: after a rename or an eject, docs cite files the surviving app
 * does not have (the scaffold docs teach `src/jobs/`, `src/domain/`, `src/app/api/` because the
 * SHOWCASE has them). Those sentences never meant "this app" — they meant "your app".
 *
 * ONE SPAN CAN CARRY SEVERAL CITATIONS, and that is the whole subtlety this function exists for. A
 * backticked command — `cp apps/showcase/src/jobs/x.ts apps/showcase/src/domain/y.ts` — yields TWO
 * citations sharing one `raw`. Rewriting them one at a time cannot work: the first rewrite means the
 * original span no longer appears in the document, so every later citation in it is silently skipped
 * (and `String.replace(string, …)` only ever replaced the first occurrence anyway). The result was a
 * half-rewritten command with a dangling path — a doc-path gate red on the adopter's FIRST command,
 * the exact failure the shared list at the top of this file exists to prevent. So: group by span,
 * apply every replacement the span needs, then substitute the span once. Longest path first, so a
 * shorter citation can never eat the prefix of a longer one.
 */
export function generalizeAppCitations(text: string, isMissing: (path: string) => boolean): string {
    const bySpan = new Map<string, string[]>()
    for (const { path: cited, raw } of citationsIn(text)) {
        if (!APP_PREFIX.test(cited) || !isMissing(cited)) continue
        const paths = bySpan.get(raw) ?? []
        if (!paths.includes(cited)) paths.push(cited)
        bySpan.set(raw, paths)
    }

    let out = text
    for (const [raw, paths] of bySpan) {
        let span = raw
        for (const cited of [...paths].sort((a, b) => b.length - a.length)) {
            span = span.split(cited).join(cited.replace(APP_PREFIX, 'apps/<app>/'))
        }
        if (span !== raw) out = out.split(`\`${raw}\``).join(`\`${span}\``)
    }
    return out
}

/**
 * A directory citation must resolve outright. A FILE citation may also pass on its parent directory
 * existing, because a doc may legitimately name a file you are meant to create — every recipe does
 * (`packages/keel/src/adapters/real/esign.ts` is the recipe's output, not a file in the tree).
 *
 * The asymmetry matters: allowing the parent fallback for directories too would let `src/app-confgi`
 * pass on the strength of `src/` existing, which defeats the point.
 */
export function resolves(path: string): boolean {
    if (existsSync(path)) return true
    const looksLikeFile = basename(path).includes('.')
    return looksLikeFile && existsSync(dirname(path))
}
