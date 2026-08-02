import 'server-only'

import type { AnalyticsPort } from '../ports/analytics'
import type { AuthPort } from '../ports/auth'
import type { DbPort } from '../ports/db'
import type { EmailPort } from '../ports/email'
import type { JobsPort } from '../ports/jobs'
import type { LlmPort } from '../ports/llm'
import type { StoragePort } from '../ports/storage'
import { fakeAnalytics } from './fake/analytics'
import { fakeAuth } from './fake/auth'
import { fakeDb } from './fake/db'
import { fakeEmail } from './fake/email'
import { fakeJobs } from './fake/jobs'
import { fakeLlm } from './fake/llm'
import { fakeStorage } from './fake/storage'

/**
 * The adapter registry: the ONE place run mode selects implementations. Simulated is the default —
 * dev, demo, and E2E are first-class citizens on fakes; APP_MODE=real is for adapter work
 * against dev cloud resources and for deployed environments.
 *
 * TWO WORDS, DELIBERATELY. The MODE is `simulated` (is this a simulated world? — what the Simulator
 * panel, the fail-closed guard and every route gate ask). The ADAPTER KIND stays `fake`: in the
 * test-double sense a fake is a working implementation with a shortcut, which is exactly what pglite
 * is for Postgres and `.data/` is for S3. So `if (isSimulated) -> fakeDb` reads correctly: in a
 * simulated world, the DB port is served by a fake.
 *
 * `APP_MODE` only ever tests for `'real'`, so an older `APP_MODE=fake` still resolves to `simulated`
 * and no deployed config breaks.
 */
export type AppMode = 'simulated' | 'real'
export const appMode: AppMode = process.env.APP_MODE === 'real' ? 'real' : 'simulated'
export const isSimulated = appMode === 'simulated'

/**
 * Demo build flag. packages/keel/src/adapters is the ONE place process.env is read (lint-enforced), so run-mode
 * signals like this live here and everything else imports the boolean — the demo badge, the fail-closed
 * guard below, etc. A demo build is a simulated-mode build that opts in explicitly via DEMO_MODE=1.
 */
export const isDemoMode = process.env.DEMO_MODE === '1'

/**
 * E2E build flag. Lets the e2e suite run against a PRODUCTION build instead of `next dev`, which is
 * where most of CI's e2e wall clock goes — every route otherwise pays an on-demand compile, and every
 * timeout in the repo is sized to absorb it.
 *
 * This is deliberately NOT `DEMO_MODE=1`, even though that would already satisfy the guard below.
 * A demo build renders `<DemoBadge />`, which changes the very pages the axe sweep asserts on — the
 * suite would be testing a different product than the one that ships. Measured, not assumed: see
 * `.claude/future-tasks/resolved/e2e-against-production-build.md`.
 */
const isE2eBuild = process.env.E2E_BUILD === '1'

// Fail CLOSED: a production build must never silently serve fake auth
// because APP_MODE was forgotten. The guard is about ACCIDENTS, so every way past it is an explicit,
// deliberate opt-in: DEMO_MODE=1 for demo builds, E2E_BUILD=1 for a production-build test run.
// Neither can be set by forgetting something. `authorized-mutations.test.ts`'s sibling
// `production-guard.test.ts` proves the guard still closes when no opt-in is set, and that no
// deployed environment in `infra/stack.ts` carries either flag.
if (isSimulated && process.env.NODE_ENV === 'production' && !isDemoMode && !isE2eBuild) {
    // The message deliberately does NOT offer the bypasses as remedies. An earlier wording listed all
    // three env vars as ways to proceed, which hands someone debugging a real deployment a menu with
    // two wrong answers on it — and the wrong answers are the ones that make the error stop.
    throw new Error(
        'refusing to run fake adapters in a production build. A deployment must set APP_MODE=real. ' +
            'If you are seeing this in a deployed environment then THAT is the bug: do not set DEMO_MODE ' +
            'or E2E_BUILD to silence it. Those exist only for local demo builds and the e2e suite, and ' +
            'with fake adapters sign-in is passwordless person switching — anyone who reaches the URL ' +
            'is an admin.',
    )
}

// Past the guard with fake adapters in a production build means a bypass is active. That is legitimate
// for a demo build or an e2e run and catastrophic anywhere else, and the two are indistinguishable from
// inside the process — so say so loudly rather than starting quietly. Whoever is reading logs when this
// turns out to be the wrong machine will see it.
if (isSimulated && process.env.NODE_ENV === 'production') {
    const bypass = isDemoMode ? 'DEMO_MODE=1' : 'E2E_BUILD=1'
    console.warn(
        `\n${'!'.repeat(80)}\n` +
            `FAKE ADAPTERS IN A PRODUCTION BUILD — bypass active: ${bypass}\n` +
            `Sign-in is passwordless person switching; there is no real authentication.\n` +
            `This is correct for a demo build or the e2e suite. If this is a real deployment,\n` +
            `stop it now and set APP_MODE=real.\n` +
            `${'!'.repeat(80)}\n`,
    )
}

const real = appMode === 'real' ? (await import('./real/index')).createRealPorts() : null

export const auth: AuthPort = real?.auth ?? fakeAuth
export const db: DbPort = real?.db ?? fakeDb
export const storage: StoragePort = real?.storage ?? fakeStorage
export const llm: LlmPort = real?.llm ?? fakeLlm
export const email: EmailPort = real?.email ?? fakeEmail
export const analytics: AnalyticsPort = real?.analytics ?? fakeAnalytics
export const jobs: JobsPort = real?.jobs ?? fakeJobs
