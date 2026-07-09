/** Base owner account used for dev account switching (override via env in shared dev hosts). */
export const DEV_BASE_OWNER_EMAIL = (
  process.env.DEV_BASE_OWNER_EMAIL ??
  process.env.NEXT_PUBLIC_DEV_BASE_OWNER_EMAIL ??
  'andrehampton1@outlook.com'
)
  .trim()
  .toLowerCase()

export const DEV_TEST_PERSONA_STORAGE_KEY = 'dev-test-persona-email'

/** Server-side: dev APIs and privileged tooling. */
export function isDevEnvironment(): boolean {
  return process.env.NODE_ENV !== 'production'
}

/**
 * Client or server: show dev account switcher and invite testing UI.
 * Set NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER=true to enable outside development builds.
 */
export function isDevAccountSwitcherEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER === 'true') return true
  return isDevEnvironment()
}

/**
 * Owner fast-path bypass is restricted to NODE_ENV !== 'production'.
 * NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER on shared hosts still requires allowlist for owner.
 */
export function isDevBaseOwnerSwitchAllowed(): boolean {
  return isDevEnvironment()
}