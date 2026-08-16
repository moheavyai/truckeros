import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for MoHeavy / TruckerOS critical-path smoke tests.
 *
 * BASE URL priority:
 * 1. PLAYWRIGHT_TEST_BASE_URL (set by GitHub Actions for Vercel previews)
 * 2. http://localhost:3000 (local `npm run dev`)
 *
 * Keep the suite small and stable. Prefer user-facing locators
 * (getByRole, getByText, getByLabel) over CSS classes.
 */
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
    // Reasonable timeouts for a Next.js app that may still be warming
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment later for mobile smoke if needed
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
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
