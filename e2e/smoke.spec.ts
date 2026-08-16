import { test, expect, type Page } from '@playwright/test';

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

async function fillProfileName(page: Page, name: string) {
  const profileNameInput = page
    .locator('label', { hasText: /Profile Name/i })
    .locator('..')
    .locator('input')
    .first();
  await expect(profileNameInput).toBeVisible({ timeout: 10_000 });
  await profileNameInput.fill(name);
}

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

    await expect(page.getByRole('button', { name: 'Tractors' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trailers' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rigs' })).toBeVisible();
  });

  test('can create and delete a tractor profile', async ({ page }) => {
    const profileName = `PW Tractor ${Date.now()}`;

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto('/equipment');
    await expect(page.getByText(/MoHeavy/i).first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Tractors' }).click();
    await page.getByRole('button', { name: /New Tractor Profile/i }).click();
    await fillProfileName(page, profileName);
    await page.getByRole('button', { name: 'Save Tractor' }).click();

    await expect(page.getByText(profileName).first()).toBeVisible({
      timeout: 20_000,
    });

    const card = page.locator('div').filter({ hasText: profileName }).first();
    await card.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(profileName)).toHaveCount(0, { timeout: 15_000 });
  });

  test('can build a rig and see SuccessToast', async ({ page }) => {
    const stamp = Date.now();
    const tractorName = `PW Rig Tractor ${stamp}`;
    const trailerName = `PW Rig Trailer ${stamp}`;
    const rigName = `PW Rig ${stamp}`;

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto('/equipment');
    await expect(page.getByText(/MoHeavy/i).first()).toBeVisible({ timeout: 15_000 });

    // --- Tractor ---
    await page.getByRole('button', { name: 'Tractors' }).click();
    await page.getByRole('button', { name: /New Tractor Profile/i }).click();
    await fillProfileName(page, tractorName);
    await page.getByRole('button', { name: 'Save Tractor' }).click();
    await expect(page.getByText(tractorName).first()).toBeVisible({ timeout: 20_000 });

    // --- Trailer ---
    await page.getByRole('button', { name: 'Trailers' }).click();
    await page.getByRole('button', { name: /New Trailer Profile/i }).click();
    await fillProfileName(page, trailerName);
    await page.getByRole('button', { name: 'Save Trailer' }).click();
    await expect(page.getByText(trailerName).first()).toBeVisible({ timeout: 20_000 });

    // --- Rig builder ---
    await page.getByRole('button', { name: 'Rigs' }).click();

    // Builder may already be open for empty fleet; otherwise open it
    const buildNew = page.getByRole('button', { name: /Build New Rig|Build first rig/i });
    if (await buildNew.count()) {
      await buildNew.first().click();
    }

    await expect(page.getByText(/Build a Combination/i)).toBeVisible({ timeout: 10_000 });

    // Select tractor
    const tractorSelect = page.locator('select').filter({ hasText: /Select tractor/i }).first();
    // Fallback: first select on the builder card
    const selects = page.locator('select');
    await selects.nth(0).selectOption({ label: new RegExp(tractorName) });

    // Add trailer via second select
    await selects.nth(1).selectOption({ label: new RegExp(trailerName) });

    // Rig name
    const rigNameInput = page.getByPlaceholder(/e\.g\. KW T680|Rig Name|Flatbed/i);
    if (await rigNameInput.count()) {
      await rigNameInput.first().fill(rigName);
    } else {
      // Fallback: input near "Rig Name"
      await page
        .locator('label', { hasText: /Rig Name/i })
        .locator('..')
        .locator('input')
        .first()
        .fill(rigName);
    }

    // Save
    await page.getByRole('button', { name: /Save Rig Configuration/i }).click();

    // SuccessToast uses role="status"
    const toast = page.getByRole('status');
    await expect(toast).toBeVisible({ timeout: 20_000 });
    await expect(toast).toContainText(/Saved|ready for analysis|Updated/i);

    // Rig card should appear
    await expect(page.getByText(rigName).first()).toBeVisible({ timeout: 15_000 });

    // --- Cleanup (rig, then trailer, then tractor) ---
    const rigCard = page.locator('div').filter({ hasText: rigName }).first();
    await rigCard.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(rigName)).toHaveCount(0, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Trailers' }).click();
    const trailerCard = page.locator('div').filter({ hasText: trailerName }).first();
    await trailerCard.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(trailerName)).toHaveCount(0, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Tractors' }).click();
    const tractorCard = page.locator('div').filter({ hasText: tractorName }).first();
    await tractorCard.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(tractorName)).toHaveCount(0, { timeout: 15_000 });
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
