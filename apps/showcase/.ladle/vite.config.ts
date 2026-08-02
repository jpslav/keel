import path from 'node:path'
import { defineConfig } from 'vite'

/**
 * Merged into Ladle's own Vite config (see ./config.mjs). It exists for the ALIASES: framework code
 * reaches app content through the `@app-config/*` seam and app code through `@/*`, and both are
 * tsconfig paths plus per-build Vite aliases (see ../vite.demo.config.ts) — never packages on disk.
 * Ladle builds its own Vite config, so it has to be told, exactly like the static demo is.
 *
 * `fs.allow` covers the second half of the same story: the stories glob reaches above this app's root
 * into packages/keel, and Vite must be allowed to read there.
 */
export default defineConfig({
    resolve: {
        alias: {
            '@app-config': path.resolve(import.meta.dirname, '../src/app-config'),
            '@': path.resolve(import.meta.dirname, '../src'),
        },
    },
    server: {
        fs: { allow: [path.resolve(import.meta.dirname, '../../..')] },
    },
})
