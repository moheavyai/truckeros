# Code Review: Dev Account Switcher — Session Persistence Fix

**Review ID:** 173775a0  
**Scope:** `lib/dev-account-switch.ts`, `lib/dev-account-switch.test.ts`, `app/api/dev/switch-user/route.ts`, `app/api/dev/switch-user/route.test.ts`, `components/DevAccountSwitcher.tsx`, `app/profile/profile-ui.test.ts`  
**Reference:** `agent-tools/grok-impl-summary-173775a0.md`  
**Focus:** `verifyOtp` / `hashed_token` flow, session persistence after refresh, security regressions, reload vs redirect  
**Tests re-run:** `npx vitest run lib/dev-account-switch.test.ts app/api/dev/switch-user/route.test.ts app/profile/profile-ui.test.ts` → **63 passed** (2026-07-08)

---

## Executive Summary

The fix correctly identifies the root cause: redirecting to Supabase `action_link` bypassed `@supabase/ssr` cookie persistence in an app with no `/auth/callback` route. Replacing that with server-returned `hashed_token` → client `completeDevAccountSwitch()` → `window.location.reload()` is the right architectural direction and aligns with how `signInWithPassword` already persists sessions via `createBrowserClient`.

**What works well**

- `action_link` / external redirect fully removed from the switcher path.
- Server still gates on dev flag, Bearer auth, org allowlist, and `SUPABASE_SERVICE_ROLE_KEY`.
- Client confirms session email before updating `localStorage` and reloading.
- `viewingAs` now prefers live session email over `localStorage`, fixing the banner/session desync that motivated the change.
- Owner session triggers `localStorage` cleanup via `useEffect` (`DevAccountSwitcher.tsx:52–56`).
- Route error handling sanitizes most failures to generic messages; host-header open-redirect risk is partially hardened (non-localhost rejected when `NEXT_PUBLIC_APP_URL` is unset).

**Residual risk**

- The primary regression (session survives F5) is **not proven in CI** — all `verifyOtp` paths are mocked.
- `verifyOtp` parameter shape may not match Supabase’s documented `token_hash` contract (see issue #1).
- Dev-only credential exposure (`hashed_token` in JSON) persists; auth boundary is unchanged from the prior implementation.

**Verdict:** Sound design and correct reload-vs-redirect choice. **No blocking security regressions** in default production config. Merge is reasonable after live manual verification of issue #1; highest-value follow-ups are E2E/live persistence proof and `token_hash` API alignment.

---

## Verification Matrix

| Check | Result | Evidence |
|-------|--------|----------|
| `action_link` removed | ✅ | No matches in `components/`; API returns `hashed_token` only (`route.ts:115–124`) |
| `verifyOtp` wired | ✅ | `completeDevAccountSwitch` (`dev-account-switch.ts:25–29`) called from `DevAccountSwitcher.tsx:216` |
| Session validated before reload | ✅ | `getSession()` + email match (`dev-account-switch.ts:35–52`); failure skips reload (`DevAccountSwitcher.tsx:216–232`) |
| `localStorage` ordering | ✅ | Persona written only after successful exchange, before reload (`DevAccountSwitcher.tsx:221–229`) |
| Reload vs redirect | ✅ | `window.location.reload()` rebuilds all page state from persisted cookies; avoids PKCE/callback gap |
| `viewingAs` session-first | ✅ | `normalizedCurrentEmail \|\| storedPersona` (`DevAccountSwitcher.tsx:174`) |
| Security gates unchanged | ✅ | 404 when disabled, 401/403/503 guards intact (`route.ts:45–100`) |
| Host-header hardening | ✅ Improved | `appBaseUrl` rejects non-localhost without `NEXT_PUBLIC_APP_URL` (`route.ts:27–34`, test at `route.test.ts:348–388`) |
| Error leakage | ✅ Improved | `generateLink` failures → generic 500 (`route.ts:139–141`) |
| Cookie persistence after F5 | ⚠️ Unverified | No integration/E2E test |

---

## Issues

### 1

- **Severity:** bug
- **File:line:** `lib/dev-account-switch.ts:25-29`, `lib/dev-account-switch.test.ts:67-71`
- **Description:** `completeDevAccountSwitch` passes admin `generateLink` output as `verifyOtp({ email, token: hashedToken, type: 'magiclink' })`. Supabase JS docs and community examples for `properties.hashed_token` use `verifyOtp({ token_hash, type: 'magiclink' })` without an email field — `token` is documented for user-supplied OTP (`email_otp`), not link hashes. Unit tests mock `verifyOtp` and never hit GoTrue, so a parameter-shape mismatch would pass CI while failing manual switching.
- **Suggestion:** Verify against a live dev Supabase project (impl summary manual steps 1–4). If verification fails, switch to `verifyOtp({ token_hash: token, type: 'magiclink' })` and update tests to assert `token_hash`. Document the verified shape in a code comment.
- **Status:** open

### 2

- **Severity:** suggestion
- **File:line:** `lib/dev-account-switch.test.ts:49-106`, `app/profile/profile-ui.test.ts:692-694`, `components/DevAccountSwitcher.tsx:216-229`
- **Description:** The core regression — Supabase session reverting to the original user after refresh while `dev-test-persona-email` stayed set — is not proven by automated tests. Coverage is mocked `verifyOtp`/`getSession` plus source-string assertions. No test exercises `@supabase/ssr` cookie writes, a simulated reload, or post-F5 `getSession().user.email`.
- **Suggestion:** Add a Playwright or gated `*.live.test.ts` flow: switch → reload → assert banner/header email and `localStorage`; optionally assert `getSession()` in console matches. Until then, treat impl summary manual steps 2 and 4 as mandatory pre-merge QA.
- **Status:** open

### 3

- **Severity:** suggestion
- **File:line:** `lib/dev-account-switch.ts:25-37`, `lib/dev-account-switch.ts:39-44`
- **Description:** On success, `verifyOtp`'s returned `data.session` is discarded; the helper immediately polls `getSession()`. `verifyOtp` already awaits `_saveSession` in `@supabase/auth-js`, so the extra round-trip is redundant. In slow storage environments, `getSession()` could theoretically return the pre-switch session and fail the email-mismatch guard even when `verifyOtp` succeeded — the exact failure mode this fix addresses.
- **Suggestion:** Prefer `const { data, error } = await verifyOtp(...)` and validate `data.session` first; fall back to `getSession()` only if session is null. Mirror the defensive pattern in `login/page.tsx:71-73` but use the inline session when available.
- **Status:** open

### 4

- **Severity:** suggestion
- **File:line:** `lib/dev-account-switch.ts:39-44`, `lib/dev-account-switch.test.ts`
- **Description:** `completeDevAccountSwitch` has a distinct error path when `verifyOtp` succeeds but `getSession()` returns no user (`'Switch succeeded but no active session was found'`). This is the failure mode that motivated the original bug, but there is no unit test covering it.
- **Suggestion:** Add a test: `verifyOtp` resolves without error, `getSession` returns `{ session: null }`; assert `success: false` and the exact error string.
- **Status:** open

### 5

- **Severity:** suggestion
- **File:line:** `components/DevAccountSwitcher.tsx:216-232`, `app/profile/profile-ui.test.ts:692-694`
- **Description:** `handleSwitch` orchestration (API success → `hashed_token` present → `completeDevAccountSwitch` success → `localStorage` write → `reload()`) is verified only by source-string presence, not behavior. A refactor that reloads on API-only success, writes `localStorage` before `verifyOtp`, or reloads before session confirmation would pass CI.
- **Suggestion:** Add a component-level test (or extracted `handleSwitch` helper test) that mocks `fetch`, `completeDevAccountSwitch`, and `window.location.reload` to assert call order and that `reload`/`setItem` are skipped on failure paths.
- **Status:** open

### 6

- **Severity:** suggestion
- **File:line:** `app/api/dev/switch-user/route.ts:120-126`, `components/DevAccountSwitcher.tsx:211`
- **Description:** `hashed_token` is a single-use authentication credential returned in the JSON response body. Replacing `action_link` removes URL/query-string leakage and external redirects, but the token remains exposed to DevTools, network tabs, XSS, or compromised extensions on shared dev machines. The `verifyOtp` change does **not** widen the impersonation boundary (same gates as before); it changes consumption site from browser navigation to in-app exchange.
- **Suggestion:** Keep switcher disabled on shared/staging hosts (`NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER` unset in production). Prohibit response-body logging on `/api/dev/*`. Longer term, consider server-side `verifyOtp` with Set-Cookie response if dev ergonomics allow.
- **Status:** open

### 7

- **Severity:** suggestion
- **File:line:** `lib/dev-account-switch.ts:82-85`, `lib/dev-account-switch.ts:154-161`, `app/api/dev/switch-user/route.ts:96-100`
- **Description:** Carried forward from prior reviews (not introduced by this change): when the switcher is enabled, any valid JWT holder can obtain a `hashed_token` for `DEV_BASE_OWNER_EMAIL` via `isDevSwitchEmailAllowed` owner fast-path, regardless of org role. Unreachable in default production (`isDevAccountSwitcherEnabled()` false).
- **Suggestion:** Do not enable `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER` on network-accessible staging. If needed, gate owner-target behind actor role checks or server-only break-glass header.
- **Status:** open

### 8

- **Severity:** suggestion
- **File:line:** `components/DevAccountSwitcher.tsx:49-59`, `components/AppHeader.tsx:85-88`
- **Description:** `dev-test-persona-email` is cleared when the live session is owner or after explicit owner switch, but not on `signOut`. Stale persona can remain in `localStorage` and seed dropdown options via `buildDevSwitcherOptions` (`DevAccountSwitcher.tsx:27-33`) until the next owner session.
- **Suggestion:** Clear `DEV_TEST_PERSONA_STORAGE_KEY` in `AppHeader.handleLogout` or a shared `onAuthStateChange` listener.
- **Status:** open

### 9

- **Severity:** suggestion
- **File:line:** `components/DevAccountSwitcher.tsx:174`, `components/AppHeader.tsx:102`
- **Description:** `AppHeader` passes `user?.email` which is `undefined` until each page's `getSession()` effect completes. During that window, `viewingAs` falls back to `storedPersona`, which can flash a stale team email in the amber banner before the real session email arrives.
- **Suggestion:** When `normalizedCurrentEmail` is falsy and `storedPersona` is set, show a neutral loading label or defer banner text until `currentEmail` is known.
- **Status:** open

### 10

- **Severity:** suggestion
- **File:line:** `app/api/dev/switch-user/route.ts:115-118`, `app/api/dev/switch-user/route.test.ts`
- **Description:** When `generateLink` succeeds but `data.properties?.hashed_token` is missing, the route throws and returns generic 500. Tests cover `generateLink` error but not the empty-`hashed_token` success path.
- **Suggestion:** Add test: `generateLink` returns `{ data: { properties: {} }, error: null }`; assert 500 and generic error body.
- **Status:** open

### 11

- **Severity:** suggestion
- **File:line:** `lib/dev-account-switch.ts:21-23`, `lib/dev-account-switch.test.ts`
- **Description:** Early guard `Missing sign-in credentials` for empty email/token is untested.
- **Suggestion:** Add unit tests for empty/whitespace email and empty `hashedToken`; assert `getSession` is not called.
- **Status:** open

### 12

- **Severity:** nit
- **File:line:** `app/api/dev/switch-user/route.ts:125`, `components/DevAccountSwitcher.tsx:211`
- **Description:** API response includes `redirect_to` but the client no longer uses it (reload-only flow). Dead field adds minor response surface.
- **Suggestion:** Remove `redirect_to` from the JSON response or document it as informational for debugging only.
- **Status:** open

### 13

- **Severity:** nit
- **File:line:** `lib/dev-account-switch.ts:31-32`, `components/DevAccountSwitcher.tsx:270`
- **Description:** `verifyOtp` and session-mismatch errors are returned verbatim to the dev banner UI. Acceptable for dev tooling; minor information exposure about token validity.
- **Suggestion:** Map known failures to generic user-facing messages; keep details in `console.error` during development.
- **Status:** open

### 14

- **Severity:** nit
- **File:line:** `app/profile/profile-ui.test.ts:692-694`
- **Description:** Source assertions confirm `completeDevAccountSwitch`, `hashed_token`, and `reload()` exist but do not assert `setItem(DEV_TEST_PERSONA_STORAGE_KEY, ...)` for team-target switches. Removing `setItem` would break manual step 2 (`localStorage` check after refresh) while other tests still pass.
- **Suggestion:** Add `expect(switcherSource).toContain('setItem(DEV_TEST_PERSONA_STORAGE_KEY')` to the dev-switcher wiring test.
- **Status:** open

---

## Security Regression Assessment

| Prior concern | This change |
|---------------|-------------|
| Dev switcher reachable in production | **No regression** — still 404 when `isDevAccountSwitcherEnabled()` false |
| Unauthenticated / forged JWT | **No regression** — Bearer + `getUser()` unchanged |
| Cross-org allowlist escalation | **No regression** — org resolved from actor client before admin reads |
| Host-header `redirectTo` injection | **Improved** — non-localhost blocked without `NEXT_PUBLIC_APP_URL` |
| Supabase error strings in 500 body | **Improved** — generic `'Failed to switch user'` for most failures |
| One-time credential in API response | **Equivalent** — `hashed_token` replaces `action_link`; still dev-only break-glass |
| Owner fast-path impersonation | **Unchanged** — pre-existing; not widened by `verifyOtp` |

**Default production exploitable issues:** 0 (switcher disabled).

---

## Reload vs Redirect

| Approach | Assessment |
|----------|------------|
| **Previous:** `window.location.href = action_link` | Navigated to Supabase verify URL; PKCE/cookie exchange unreliable without `/auth/callback`; session often did not persist in `@supabase/ssr` cookies |
| **Current:** `verifyOtp` in-browser → `reload()` | Keeps token exchange inside `createBrowserClient` cookie adapter (same path as login); full page reload ensures server components and client hooks re-read cookies — correct for this app |

`reload()` is preferable to `router.push()` here because it forces a clean server/client boundary rehydration after cookie mutation.

---

## Severity Counts

| Severity | Open |
|----------|------|
| bug | 1 |
| suggestion | 10 |
| nit | 3 |
| **Total** | **14** |

---

## Recommended Pre-Merge Checklist

1. Run impl summary manual steps 1–4 on a live dev Supabase project (confirms issue #1 and core persistence).
2. After switch + F5, run: `const { data } = await (await import('@/lib/supabase/client')).createClient().auth.getSession(); data.session?.user?.email` — must match banner.
3. Confirm `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER` is unset in production deploy config.
4. If issue #1 fails live QA, fix `token_hash` parameter shape before merge.