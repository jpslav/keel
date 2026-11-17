import path from 'node:path'
import { ESLint } from 'eslint'
import { expect } from 'vitest'

/**
 * The lint gates in this directory pin eslint.config.mjs's fences against the repo's REAL config:
 * `new ESLint()` with no override, linting virtual files at the paths the fences are about. Nothing is
 * written to disk, so there is no dead fixture for knip, tsc or jscpd to trip over, and no vendor package
 * has to be installed. `no-restricted-imports` judges the specifier and never resolves it.
 *
 * The paths sit under `apps/any-app/`, which is neither of this repo's apps, on purpose. Every fence
 * is written `apps/*`, so the app's name is not what is being tested, and a name nobody owns
 * survives `pnpm init-app` renaming or ejecting the real ones.
 */
const repoRoot = process.cwd()
export const APP = 'apps/any-app'

let eslint: ESLint | undefined
const linter = () => (eslint ??= new ESLint({ cwd: repoRoot }))

export interface Finding {
    rule: string
    message: string
}

export async function lint(relativePath: string, code: string): Promise<Finding[]> {
    const [result] = await linter().lintText(code, { filePath: path.join(repoRoot, relativePath) })
    // A parse failure, or the warning for a file the config ignores, carries no rule id. Either one
    // would make every "nothing fired" expectation pass vacuously, so it fails the case instead.
    expect(
        result.messages.filter((m) => !m.ruleId),
        `${relativePath} was not actually linted`,
    ).toEqual([])
    return result.messages.map((m) => ({ rule: m.ruleId as string, message: m.message }))
}

export const isIgnored = (relativePath: string) => linter().isPathIgnored(path.join(repoRoot, relativePath))

// Each fence is told apart by its rule id AND its message, because several patterns report as
// `no-restricted-imports` (vendor, two real-adapter forms, keel's real adapters, next/font/google) and
// several selectors as `no-restricted-syntax` (getDb in three forms, process.env, run mode, dynamic
// real/, a11y).
export interface Fence {
    rule: string
    fragment: string
}
export const VENDOR_STATIC: Fence = { rule: 'no-restricted-imports', fragment: 'Vendor SDKs may only be imported' }
export const VENDOR_DYNAMIC: Fence = { rule: 'keel/no-dynamic-vendor-import', fragment: 'is a vendor SDK' }
export const PROCESS_ENV: Fence = { rule: 'no-restricted-syntax', fragment: 'process.env is read ONLY' }
export const RUN_MODE: Fence = { rule: 'no-restricted-syntax', fragment: "Run mode is keel's" }
export const REAL_ADAPTER: Fence = {
    rule: 'no-restricted-imports',
    fragment: "Reach the app's real adapters through its registry",
}
export const REAL_ADAPTER_INSIDE: Fence = {
    rule: 'no-restricted-imports',
    fragment: 'real/ is loaded only with import()',
}
export const REAL_ADAPTER_DYNAMIC: Fence = { rule: 'no-restricted-syntax', fragment: "Only the app's registry" }
export const KEEL_REAL_ADAPTER: Fence = { rule: 'no-restricted-imports', fragment: "never import keel's real adapters" }
export const NEXT_FONT: Fence = { rule: 'no-restricted-imports', fragment: 'next/font/google phones home' }
export const JSX_LITERAL: Fence = { rule: 'react/jsx-no-literals', fragment: '' }
export const A11Y_LITERAL: Fence = {
    rule: 'no-restricted-syntax',
    fragment: 'aria-label/placeholder/title/alt carry user-visible copy',
}
export const GET_DB: Fence = { rule: 'no-restricted-syntax', fragment: 'must not use the raw db handle' }
export const GET_DB_COMPUTED: Fence = {
    rule: 'no-restricted-syntax',
    fragment: "Reaching the raw db handle as db['getDb']",
}
export const GET_DB_DESTRUCTURE: Fence = {
    rule: 'no-restricted-syntax',
    fragment: 'Destructuring getDb out of the db port',
}

// The vendor import every gate here uses, statically and with import().
export const IMPORTS_VENDOR = "import { S3Client } from '@aws-sdk/client-s3'\nexport const client = S3Client\n"
export const LOADS_VENDOR = "export const load = () => import('@aws-sdk/client-s3')\n"

export const fired = (findings: Finding[], fence: Fence) =>
    findings.filter((f) => f.rule === fence.rule && f.message.includes(fence.fragment)).length
