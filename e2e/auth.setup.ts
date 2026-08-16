import { test as setup, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const authFile = path.join(__dirname, '../playwright/.auth/user.json');

/**
 * Global auth setup for MoHeavy smoke tests.
 * Logs in once with the dedicated test account and saves storageState.
 * Subsequent tests reuse the authenticated session.
 */
setup('authenticate', async ({ page }) => {
  const email = process.env.PLAYWRIGHT_TEST_EMAIL;
  const password = process.env.PLAYWRIGHT_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Missing PLAYWRIGHT_TEST_EMAIL or PLAYWRIGHT_TEST_PASSWORD. ' +
        'Set them as environment variables (or GitHub Secrets in CI).'
    );
  }

  // Ensure the auth directory exists
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  await page.goto('/login');

  // Wait for the sign-in form
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // After successful login we should leave /login
  // (destination may be dashboard, profile/onboarding, or equipment depending on state)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 30_000,
  });

  // Sanity: we should see MoHeavy chrome somewhere in the app
  await expect(page.getByText(/MoHeavy/i).first()).toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: authFile });
});
