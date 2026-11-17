import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * The apps that have a contract suite: every directory under `apps/` with a `tests/contract`. Discovered, not
 * listed, so `vitest.contract.config.ts` needs no edit (and `pnpm init-app` no rewrite of it) when an app is renamed
 * or the showcase is ejected, and a new app gets its contract project the day it gets the directory.
 * tests/tooling/app-scaffold.test.ts is what stops an app from quietly NOT having one.
 */
export function contractApps(repoRoot: string): string[] {
    const appsDir = path.join(repoRoot, 'apps')
    if (!existsSync(appsDir)) return []
    return readdirSync(appsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(path.join(appsDir, entry.name, 'tests', 'contract')))
        .map((entry) => entry.name)
        .sort()
}
