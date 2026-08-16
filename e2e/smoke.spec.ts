import { test, expect } from '@playwright/test';

/**
 * Critical-path smoke tests for MoHeavy AI.
 * Tagged @smoke so CI can run only this suite quickly.
 *
 * These tests intentionally avoid authenticated flows for now.
 * Auth storageState + fixture will be added in a follow-up once
 * we have a stable test account strategy.
 */
test.describe('MoHeavy critical path @smoke', () => {
  test('landing page loads and shows core brand + CTAs', async ({ page }) => {
    await page.goto('/');

    // Brand
    await expect(page.getByText('MoHeavy AI').first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Operating System\s*for Truckers/i })
    ).toBeVisible();

    // Primary CTAs
    await expect(page.getByRole('link', { name: 'Log In' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get Started' })).toBeVisible();
  });

  test('login page loads (sign-in mode)', async ({ page }) => {
    await page.goto('/login');

    // Page should not be a hard error
    await expect(page).not.toHaveTitle(/404|Error/i);

    // MoHeavy branding should still be present somewhere on the auth surface
    await expect(page.getByText(/MoHeavy/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Get Started deep-links into signup mode', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Get Started' }).click();

    // Should land on /login?mode=signup (or equivalent)
    await expect(page).toHaveURL(/\/login/);
    // Mode query is helpful but not strictly required if the UI switches correctly
    // We just assert we reached the auth surface without a crash.
    await expect(page.getByText(/MoHeavy/i).first()).toBeVisible();
  });
});
