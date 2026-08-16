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

    // Fresh Owner-Operator account should land on the redesigned empty state
    // with Tractors | Trailers | Rigs tabs (or equivalent guidance).
    const body = page.locator('body');
    await expect(body).toContainText(/Equipment|Tractor|Trailer|Rig/i);

    // Prefer explicit tab labels when present
    const tractors = page.getByRole('tab', { name: /Tractors?/i });
    const trailers = page.getByRole('tab', { name: /Trailers?/i });
    const rigs = page.getByRole('tab', { name: /Rigs?/i });

    const tabCount =
      (await tractors.count()) + (await trailers.count()) + (await rigs.count());

    if (tabCount > 0) {
      // At least one of the expected tabs is visible
      await expect(tractors.or(trailers).or(rigs).first()).toBeVisible();
    } else {
      // Fallback: page still clearly talks about equipment
      await expect(body).toContainText(/add|create|tractor|trailer|rig/i);
    }
  });

  test('Permit Test page renders core route surface', async ({ page }) => {
    await page.goto('/permit-test');

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/MoHeavy/i).first()).toBeVisible({ timeout: 15_000 });

    const body = page.locator('body');

    // Core permit-test vocabulary — do not require a live OR-Tools response
    await expect(body).toContainText(/Permit|Route|Origin|Destination|Corridor|Load/i);

    // Prefer visible origin/destination style fields when present
    const originish = page.getByPlaceholder(/origin|from|start/i).or(
      page.getByLabel(/origin|from|start/i)
    );
    const destish = page.getByPlaceholder(/destination|to|end/i).or(
      page.getByLabel(/destination|to|end/i)
    );

    // Soft check — if the labels exist, they should be visible; if not, the
    // body-level assertion above is still enough for smoke.
    if ((await originish.count()) > 0) {
      await expect(originish.first()).toBeVisible();
    }
    if ((await destish.count()) > 0) {
      await expect(destish.first()).toBeVisible();
    }
  });

  test('Portal Assist route is reachable while authenticated', async ({ page }) => {
    // Direct navigation — even if empty, should not bounce to login
    await page.goto('/portal-assist');

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/MoHeavy/i).first()).toBeVisible({ timeout: 15_000 });

    const body = page.locator('body');
    // Page may show empty state or require a prior permit — either is fine for smoke
    await expect(body).toContainText(/Portal|Assist|Permit|Copy|Checklist|Filing/i);
  });
});
