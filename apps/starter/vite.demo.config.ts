import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * Builds the hash-routed static demo shell (src/demo-static) that runs from file://.
 * ALWAYS single-file: Chrome blocks external type="module" scripts on the file:// origin (CORS),
 * but inline module scripts run fine — so everything is inlined into one index.html.
 *
 * The aliases are the app's own: `@app-config` points at THIS app's seam, which is what makes the
 * framework bundle resolve against the starter's registrations rather than any other app's.
 */
export default defineConfig({
    root: path.resolve(__dirname, 'src/demo-static'),
    base: './',
    plugins: [react(), viteSingleFile()],
    resolve: {
        alias: {
            '@app-config': path.resolve(__dirname, 'src/app-config'),
            keel: path.resolve(__dirname, '../../packages/keel/src'),
            '@': path.resolve(__dirname, 'src'),
        },
    },
    build: {
        outDir: path.resolve(__dirname, 'dist-demo'),
        emptyOutDir: true,
    },
})
