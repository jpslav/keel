import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * Builds the hash-routed static demo shell (src/demo-static) that runs from file://.
 * ALWAYS single-file: Chrome blocks external type="module" scripts on the file:// origin (CORS),
 * but inline module scripts run fine — so everything is inlined into one index.html. Bonus: the
 * demo is one shareable file.
 */
export default defineConfig({
    root: path.resolve(__dirname, 'src/demo-static'),
    base: './',
    plugins: [react(), viteSingleFile()],
    css: {
        postcss: __dirname,
    },
    resolve: {
        alias: {
            '@app-config': path.resolve(__dirname, 'src/app-config'),
            keel: path.resolve(__dirname, '../../packages/keel/src'),
            '@': path.resolve(__dirname, 'src'),
            '@app/seed': path.resolve(__dirname, '../../packages/seed/src/index.ts'),
        },
    },
    build: {
        outDir: path.resolve(__dirname, 'dist-demo'),
        emptyOutDir: true,
    },
})
