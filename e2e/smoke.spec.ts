import { test, expect } from '@playwright/test';

/**
 * Critical-path smoke tests for MoHeavy AI.
 * Tagged @smoke so CI can run only this suite quickly.
 *
 * Public tests run without auth.
 * Authenticated tests reuse storageState from auth.setup.ts.
 */

test.describe('Public surface @smoke', () => {
  // These do not need the authenticated storageState.
  // They still run inside the chromium project (which has storageState),
  // but they start from public URLs so the session is irrelevant.

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
    // Clear storage so we see the real login form
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

    // Should not be bounced back to login
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/MoHeavy/i).first()).toBeVisible();
  });

  test('can open Equipment page while authenticated', async ({ page }) => {
    await page.goto('/equipment');

    // Should stay authenticated and render the equipment surface
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/MoHeavy/i).first()).toBeVisible({ timeout: 15_000 });

    // Soft signal that we are on the right page (tabs or heading)
    // Exact copy may evolve; we mainly care that it does not 500 / redirect to login
    const body = page.locator('body');
    await expect(body).toContainText(/Equipment|Tractor|Trailer|Rig/i);
  });

  test('can open Permit Test page while authenticated', async ({ page }) => {
    await page.goto('/permit-test');

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/MoHeavy/i).first()).toBeVisible({ timeout: 15_000 });

    // Permit-test is a large surface; just assert it rendered without crashing
    const body = page.locator('body');
    await expect(body).toContainText(/Permit|Route|Origin|Destination|Corridor/i);
  });
});
