import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * Playwright config for MoHeavy / TruckerOS critical-path smoke tests.
 *
 * BASE URL priority:
 * 1. PLAYWRIGHT_TEST_BASE_URL (set by GitHub Actions for Vercel previews / production)
 * 2. http://localhost:3000 (local `npm run dev`)
 *
 * Auth:
 * - e2e/auth.setup.ts runs once, logs in, saves storageState to playwright/.auth/user.json
 * - Authenticated tests reuse that state (no repeated UI login)
 * - Requires PLAYWRIGHT_TEST_EMAIL + PLAYWRIGHT_TEST_PASSWORD (GitHub Secrets in CI)
 */
const authFile = path.join(__dirname, 'playwright/.auth/user.json');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'on-failure' }]],

  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // 1. Login once and save storage state
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    // 2. Authenticated smoke (depends on setup)
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],

  // Only start a local server when no external base URL is provided
  webServer: process.env.PLAYWRIGHT_TEST_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
