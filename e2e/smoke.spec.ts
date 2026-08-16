import { test, expect } from '@playwright/test';

/**
 * Critical-path smoke tests for MoHeavy AI.
 * Tagged @smoke so CI can run only this suite quickly.
 *
 * Public tests run without auth.
 * Authenticated tests reuse storageState from auth.setup.ts.
 *
 * The dedicated test account (playwright@moheavyai.com) is a fresh
 * Owner-Operator style user — expect empty equipment state and
 * normal post-login app chrome.
 */

test.describe('Public surface @smoke', () => {
  test('landing page loads and shows core brand + CTAs', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('MoHeavy AI').first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Operating System\s*for Truckers/i })
    ).toBeVisible();

    await expect(page.getByRole('link', { name: 'Log In' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get Started' })).toBeVisible();
  });

  test('login page loads in sign-in mode with form fields', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login');

    await expect(page.getByText('MoHeavy AI').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});

test.describe('Authenticated critical path @smoke', () => {
  test('after login we are inside the app (not on /login)', async ({ page }) => {
    await page.goto('/');

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/MoHeavy/i).first()).toBeVisible();
  });

  test('Equipment page shows empty-state tabs or guidance', async ({ page }) => {
    await page.goto('/equipment');

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/MoHeavy/i).first()).toBeVisible({ timeout: 15_000 });

    const body = page.locator('body');
    await expect(body).toContainText(/Equipment|Tractor|Trailer|Rig/i);

    // Tab buttons are plain <button>s, not role=tab
    await expect(page.getByRole('button', { name: 'Tractors' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trailers' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rigs' })).toBeVisible();
  });

  test('can create and delete a tractor profile', async ({ page }) => {
    // Unique name so we do not collide with leftover data
    const profileName = `PW Tractor ${Date.now()}`;

    // Auto-accept the browser confirm() used by deleteTractor
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto('/equipment');
    await expect(page.getByText(/MoHeavy/i).first()).toBeVisible({ timeout: 15_000 });

    // Ensure we are on Tractors tab
    await page.getByRole('button', { name: 'Tractors' }).click();

    // Open new tractor editor
    await page.getByRole('button', { name: /New Tractor Profile/i }).click();

    // Profile Name is the first required field in the editor
    // Labels are tiny; the input is bound to profile_name
    const nameInput = page.locator('input').filter({ has: page.locator('..') }).first();
    // More reliable: find the input near "Profile Name"
    const profileNameInput = page
      .locator('label', { hasText: /Profile Name/i })
      .locator('..')
      .locator('input')
      .first();

    await expect(profileNameInput).toBeVisible({ timeout: 10_000 });
    await profileNameInput.fill(profileName);

    // Save
    await page.getByRole('button', { name: 'Save Tractor' }).click();

    // After save the editor closes and the card should appear
    await expect(page.getByText(profileName).first()).toBeVisible({
      timeout: 20_000,
    });

    // Clean up — Delete sits on the card
    const card = page.locator('div').filter({ hasText: profileName }).first();
    await card.getByRole('button', { name: 'Delete' }).click();

    // Profile should disappear
    await expect(page.getByText(profileName)).toHaveCount(0, { timeout: 15_000 });
  });

  test('Permit Test page renders core route surface', async ({ page }) => {
    await page.goto('/permit-test');

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/MoHeavy/i).first()).toBeVisible({ timeout: 15_000 });

    const body = page.locator('body');
    await expect(body).toContainText(/Permit|Route|Origin|Destination|Corridor|Load/i);
  });

  test('Portal Assist route is reachable while authenticated', async ({ page }) => {
    await page.goto('/portal-assist');

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/MoHeavy/i).first()).toBeVisible({ timeout: 15_000 });

    const body = page.locator('body');
    await expect(body).toContainText(/Portal|Assist|Permit|Copy|Checklist|Filing/i);
  });
});
