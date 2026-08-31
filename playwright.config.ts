/**
 * Playwright E2E configuration.
 *
 * Runs the bundled multi-tab demo (examples/demo) against the local demo
 * Centrifugo WebSocket server (scripts/serve-examples.mjs). The demo page
 * imports the built library from dist/, so run `pnpm build` first — the
 * `pnpm test:e2e` script does this automatically.
 *
 * Uses the system Google Chrome (`channel: 'chrome'`) instead of a downloaded
 * Playwright browser. Override with `--channel=chromium` (after
 * `pnpm exec playwright install chromium`) when Chrome is unavailable, e.g. in
 * CI.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome'
  },
  webServer: {
    command: 'node scripts/serve-examples.mjs',
    url: 'http://localhost:4173/examples/demo/',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  }
});
