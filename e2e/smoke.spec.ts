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

  test('login page loads in sign-in mode with form fields', async ({ page }) => {
    await page.goto('/login');

    // Brand + title
    await expect(page.getByText('MoHeavy AI').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    // Core form controls
    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    // Mode switchers present
    await expect(page.getByRole('button', { name: /Forgot password/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Create one/i })).toBeVisible();
  });

  test('Get Started deep-links into signup mode', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Get Started' }).click();

    await expect(page).toHaveURL(/\/login/);

    // Signup surface
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByPlaceholder(/Password/)).toBeVisible();
    await expect(page.getByPlaceholder('Confirm password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  });

  test('can switch from sign-in to signup and back via UI', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({
      timeout: 15_000,
    });

    // → Signup
    await page.getByRole('button', { name: /Create one/i }).click();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page.getByPlaceholder('Confirm password')).toBeVisible();

    // → Back to sign-in
    await page.getByRole('button', { name: /Sign in/i }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('forgot-password mode is reachable and shows email field', async ({ page }) => {
    await page.goto('/login');

    await page.getByRole('button', { name: /Forgot password/i }).click();

    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Back to/i })).toBeVisible();
  });
});
