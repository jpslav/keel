// Per-session ports, so two agent sessions in two git worktrees can run dev servers and e2e suites
// at the same time without silently driving each other's app.
//
// The failure this prevents is recorded THREE times in docs/build-notes.md (:269, :475, :851):
// Playwright's webServer sets `reuseExistingServer: !CI`, so a `next dev` that another worktree left
// on :3000 is ADOPTED rather than replaced, and the suite quietly tests someone else's build. The
// symptoms look exactly like product defects, the tell is easy to miss (no `[WebServer]` startup
// lines in the log), and it has burned multiple full verify runs.
//
// Two properties this derivation must have, and one it must not:
//
//   * PURE FUNCTION OF THE CHECKOUT PATH, not a scan for a free port. showcase's `test:e2e` runs TWO
//     separate `playwright test` invocations (chromium, then destructive) and both must land on the
//     same port. A free-port scan could disagree between them; a hash cannot.
//   * STABLE ACROSS PROCESSES. The package script that starts the server and the Playwright config
//     that points at it compute it independently — they agree only because neither one guesses.
//   * NOT applied to the main checkout. It keeps the documented defaults, so every runbook, ADR and
//     doc that names :3000 or :3100 stays true for the human reading it. Only linked worktrees
//     under .claude/worktrees/ derive.
//
// An explicit env var always wins, which is what makes an isolated one-off run possible without
// editing anything: `SHOWCASE_PORT=3210 pnpm dev`.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * This checkout's root, found by walking up from the working directory to the workspace manifest.
 *
 * Deliberately NOT `import.meta.dirname`, which would be the more direct answer: Playwright compiles
 * `playwright.config.ts` — and everything it imports — to CommonJS, and `import.meta` is a syntax
 * error there. That failure is at config-load time, so it takes the whole suite with it. Anything
 * imported by a Playwright config has to parse as both ESM and CJS, which rules out `import.meta`
 * and `__dirname` alike. Walking from cwd is the portable option, and it converges on the same
 * directory from every entry point that uses this: the repo root (vitest, root scripts) and each app
 * directory (package scripts, Playwright configs).
 */
function findCheckoutRoot(start) {
    let dir = path.resolve(start)
    for (;;) {
        if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
        const parent = path.dirname(dir)
        if (parent === dir) {
            throw new Error(`ports: no pnpm-workspace.yaml above ${start} — run this from inside the repo`)
        }
        dir = parent
    }
}

const CHECKOUT_ROOT = findCheckoutRoot(process.cwd())

/**
 * Wide enough that a handful of concurrent worktrees rarely collide (4 worktrees over 200 slots is
 * ~3%), narrow enough to stay in a memorable band. A collision is not silent: the second server
 * fails to bind, which is a loud EADDRINUSE rather than the quiet wrong-app adoption above.
 */
const SLOTS = 200

/**
 * Derived showcase/starter ports share a slot and sit adjacent (3200/3201, 3202/3203, …) so one
 * session's pair never straddles another's. Neither band overlaps the defaults.
 */
const SERVICES = {
    showcase: { env: 'SHOWCASE_PORT', fallback: 3000, derive: (slot) => 3200 + slot * 2 },
    starter: { env: 'STARTER_PORT', fallback: 3100, derive: (slot) => 3201 + slot * 2 },
    ladle: { env: 'LADLE_PORT', fallback: 61000, derive: (slot) => 61000 + slot },
    contractPg: { env: 'CONTRACT_PG_PORT', fallback: 5439, derive: (slot) => 5440 + slot },
}

function slotFor(root) {
    // Any stable spread works; sha1 is here for distribution, not for security.
    return createHash('sha1').update(root).digest().readUInt32BE(0) % SLOTS
}

/**
 * The pure derivation: what port a checkout at `root` should use, given an environment. Separated
 * from the process it runs in so it can be tested against checkouts that do not exist here.
 *
 * @param {string} root — a checkout root, real or hypothetical
 * @param {keyof typeof SERVICES} service
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function portForRoot(root, service, env = process.env) {
    const spec = SERVICES[service]
    if (!spec) throw new Error(`ports: unknown service "${service}" (known: ${Object.keys(SERVICES).join(', ')})`)

    const override = env[spec.env]
    if (override) {
        const parsed = Number(override)
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
            throw new Error(`ports: ${spec.env} must be a port number, got "${override}"`)
        }
        return parsed
    }

    const linked = root.includes(`${path.sep}.claude${path.sep}worktrees${path.sep}`)
    return linked ? spec.derive(slotFor(root)) : spec.fallback
}

/**
 * The port THIS checkout should use for a service.
 *
 * @param {keyof typeof SERVICES} service
 * @returns {number}
 */
export function portFor(service) {
    return portForRoot(CHECKOUT_ROOT, service)
}

/**
 * `http://localhost:<port>` for a service — the form Playwright's `use.baseURL` and `webServer.url`
 * both want. Kept here so no caller re-assembles the origin by hand.
 *
 * @param {keyof typeof SERVICES} service
 * @returns {string}
 */
export function originFor(service) {
    return `http://localhost:${portFor(service)}`
}

/** The service names this module knows, for the CLI's usage message. */
export const SERVICE_NAMES = /** @type {(keyof typeof SERVICES)[]} */ (Object.keys(SERVICES))
