import { defineConfig, devices } from '@playwright/test'

/** Drives the built static shell straight from file:// — no server involved. */
export default defineConfig({
    testDir: './tests/demo-static',
    fullyParallel: true,
    expect: { timeout: 10_000 },
    reporter: process.env.CI ? 'github' : 'list',
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
