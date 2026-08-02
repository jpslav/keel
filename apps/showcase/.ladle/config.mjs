/**
 * Ladle's default `stories` glob is `src/**` relative to this app, which served the APP's stories
 * only — the framework's screens (`packages/keel/src/components`) and its react-email templates were
 * never discovered, while four places in the docs said they were. The workshop is meant to be the
 * whole component surface (ADR-0005), so the glob spans BOTH halves of the repo.
 *
 * `viteConfig` is what makes them LOAD rather than merely be listed. It is not an extra: without it
 * NO story rendered, this app's own included — the global provider in ./components.tsx pulls
 * `keel/theme`, keel/theme reaches app content through the `@app-config/*` seam, and that seam is a
 * tsconfig path plus a Vite alias, never a package on disk. Ladle's own Vite config knows neither.
 */
import path from 'node:path'

export default {
    stories: ['src/**/*.stories.{js,jsx,ts,tsx}', '../../packages/keel/src/**/*.stories.{js,jsx,ts,tsx}'],
    viteConfig: path.join(import.meta.dirname, 'vite.config.ts'),
}
