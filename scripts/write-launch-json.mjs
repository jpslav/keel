// Generates `.claude/launch.json` for THIS checkout.
//
// The browser-preview pane starts a dev server by name from that file and then waits on the `port`
// it declares. The file is static JSON with no way to read an env var, so a single checked-in
// `"port": 3000` was wrong in every linked worktree the moment ports became per-checkout
// (scripts/ports.mjs): `pnpm dev` would bind the derived port while the pane waited on 3000 and
// timed out. Keeping it tracked and correct is impossible — the right value differs per checkout —
// so the file is generated and gitignored, and this generator is what is tracked instead.
//
// Runs from the root `prepare` script, so a fresh clone and every new worktree get a correct one
// from `pnpm install` without anyone remembering to ask.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { portFor } from './ports.mjs'

const root = process.cwd()
const target = path.join(root, '.claude', 'launch.json')

const config = {
    version: '0.0.1',
    configurations: [
        {
            name: 'app-dev',
            runtimeExecutable: 'pnpm',
            runtimeArgs: ['dev'],
            port: portFor('showcase'),
        },
        {
            name: 'starter-dev',
            runtimeExecutable: 'pnpm',
            runtimeArgs: ['dev:starter'],
            port: portFor('starter'),
        },
    ],
}

const next = `${JSON.stringify(config, null, 4)}\n`

// Only write when the content actually changes: `prepare` runs on every install, and rewriting an
// identical file would churn mtimes and any watcher pointed at it.
let current
try {
    current = readFileSync(target, 'utf8')
} catch {
    // No file yet (fresh clone, new worktree) — fall through and write one.
}

if (current !== next) {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, next)
    console.log(
        `launch.json: app-dev on ${config.configurations[0].port}, starter-dev on ${config.configurations[1].port}`,
    )
}
