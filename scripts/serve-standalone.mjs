/**
 * Runs the standalone production build locally (`next start` doesn't serve output:'standalone').
 * Copies static assets the way the Lambda packaging step will (ADR-0001), then boots server.js.
 *
 * Run from the app directory (`pnpm --filter <app> start:demo`). In a monorepo Next nests the
 * standalone output under the app's path relative to the inferred workspace root — the server is at
 * `.next/standalone/<…>/apps/<app>/server.js`, not at the top — and static assets must sit beside
 * THAT file. The exact prefix depends on where Next infers the root, so it is discovered rather than
 * assumed.
 */
import { cpSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { portFor } from './ports.mjs'

const root = process.cwd()
const standalone = path.join(root, '.next', 'standalone')
if (!existsSync(standalone)) {
    console.error('No standalone build found — run `pnpm build:demo` (or `pnpm build`) first.')
    process.exit(1)
}

/** The single server.js Next emitted, wherever it nested it. */
function findServer(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name === 'server.js') return path.join(dir, entry.name)
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.next') {
            const found = findServer(path.join(dir, entry.name))
            if (found) return found
        }
    }
    return null
}

const server = findServer(standalone)
if (!server) {
    console.error(`No server.js under ${standalone} — the standalone build looks incomplete.`)
    process.exit(1)
}
const serverDir = path.dirname(server)

cpSync(path.join(root, '.next', 'static'), path.join(serverDir, '.next', 'static'), { recursive: true })
if (existsSync(path.join(root, 'public'))) {
    cpSync(path.join(root, 'public'), path.join(serverDir, 'public'), { recursive: true })
}

// Was a literal 3100 — the STARTER's dev port, so `pnpm start:demo` collided with `pnpm dev:starter`
// and docs/runbooks/deploy.md documented the collision as the way to check health. `start:demo` serves
// the showcase's standalone build, so it belongs on the showcase's port; any other app passes PORT.
const port = process.env.PORT ?? String(portFor('showcase'))

// PIN THE WORLD TO THE APP, not to the build output.
//
// The fake adapters resolve `.data` relative to cwd, and this child's cwd is `serverDir` — somewhere
// down inside `.next/standalone/…`. Left alone it writes its world THERE, which is invisible from the
// app directory: `rm -rf .data` looks like it reset everything and resets nothing, so state leaks
// between runs. That cost two e2e failures that looked like product bugs (a continuity test seeing a
// person it had already switched, a held-job test seeing a previous run's job) before the cause was
// found. An explicit APP_DATA_DIR still wins, which is how the shard runner gives each shard its own.
const dataDir = process.env.APP_DATA_DIR ?? path.join(root, '.data')

console.log(`serving standalone build on http://localhost:${port} (world: ${dataDir})`)
const child = spawn('node', [server], {
    stdio: 'inherit',
    env: { ...process.env, PORT: port, HOSTNAME: '127.0.0.1', APP_DATA_DIR: dataDir },
    cwd: serverDir,
})
child.on('error', (error) => {
    console.error(`Could not start the standalone server: ${error.message}`)
    process.exit(1)
})
child.on('exit', (code) => process.exit(code ?? 0))
