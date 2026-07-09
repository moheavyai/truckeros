# Code Review: Dev Account Switcher — Session Persistence Fix — General Pass 3

**Review ID:** 173775a0  
**Scope:** All files in `agent-tools/grok-impl-summary-173775a0.md`  
**Reference:** `agent-tools/grok-impl-summary-173775a0.md`  
**Prior reviews:** `grok-review-f6017827-general.md`, `grok-review-f6017827-general-2.md`, `grok-review-f6017827-general-3.md` (session-persistence gap predates this effort)  
**Focus:** Third-pass verification that the account switcher persists a real Supabase session after dropdown change and page refresh  
**Status:** Review only — no code changes made

---

## Verification Summary

| Area | Result | Notes |
|------|--------|-------|
| `action_link` redirect removed | ✅ Pass | No `action_link` or `window.location.href` in `components/`; switch ends with `window.location.reload()` (`DevAccountSwitcher.tsx:229`) |
| Server returns `hashed_token` | ✅ Pass | `route.ts:115–124` returns `data.properties.hashed_token`, not `action_link` |
| Client `verifyOtp` exchange | ✅ Pass | `completeDevAccountSwitch()` calls `verifyOtp({ email, token, type: 'magiclink' })` (`dev-account-switch.ts:25–29`) |
| Session confirmed before reload | ✅ Pass | Post-`verifyOtp` `getSession()` + email match (`dev-account-switch.ts:35–52`); errors surface to UI (`DevAccountSwitcher.tsx:216–218`) |
| `localStorage` persona sync | ✅ Pass | Set on team switch, cleared on owner switch, before reload (`DevAccountSwitcher.tsx:221–227`) |
| `viewingAs` prefers live session | ✅ Pass | `normalizedCurrentEmail \|\| storedPersona` (`DevAccountSwitcher.tsx:174`) — fixes prior pass-3 bug where `storedPersona` won |
| Owner session clears stale persona key | ✅ Pass | `useEffect` removes `DEV_TEST_PERSONA_STORAGE_KEY` when session is owner (`DevAccountSwitcher.tsx:52–56`) |
| `@supabase/ssr` browser client | ✅ Pass | `createBrowserClient` in `lib/supabase/client.ts`; same persistence path as `signInWithPassword` (`login/page.tsx:61–73`) |
| Unit / source tests | ✅ Pass | 63 tests passing (re-run 2026-07-08): `dev-account-switch.test.ts` (13), `route.test.ts` (11), `profile-ui.test.ts` (39) |
| Cookie persistence after F5 (E2E) | ⚠️ Unverified | No browser, Playwright, or live Supabase test proves cookies survive reload |
| Sign-out clears persona `localStorage` | ❌ Gap | `AppHeader.handleLogout` (`AppHeader.tsx:85–88`) does not clear `dev-test-persona-email` |

**Pass 3 conclusion:** The implementation correctly replaces the broken magic-link redirect with an in-app `verifyOtp` + reload flow aligned with this app’s cookie-based `@supabase/ssr` auth. Prior `viewingAs`/session desync bugs are addressed. Remaining gaps are test depth (no E2E proof of persistence), minor `localStorage` hygiene on sign-out, and dev-only credential exposure in the API JSON response.

---

## Issues

### 1

- **Severity:** suggestion
- **File:line:** `lib/dev-account-switch.test.ts`, `app/profile/profile-ui.test.ts`, `components/DevAccountSwitcher.tsx:216–229`
- **Description:** The core regression — session reverting to the original user after refresh — is not proven by automated tests. Coverage is limited to mocked `verifyOtp`/`getSession` (`dev-account-switch.test.ts:49–106`) and source-string assertions (`profile-ui.test.ts:692–694`). No test exercises `@supabase/ssr` cookie read/write or a full reload cycle.
- **Suggestion:** Add a Playwright (or manual checklist in CI docs) that: switches to a team email, asserts header/banner email, refreshes, and runs `getSession()` in the console to confirm `user.email` matches. Optionally add a live dev test behind `SUPABASE_SERVICE_ROLE_KEY` similar to `*.live.test.ts` patterns elsewhere in the repo.
- **Status:** open

### 2

- **Severity:** suggestion
- **File:line:** `lib/dev-account-switch.ts:39–44`, `lib/dev-account-switch.test.ts`
- **Description:** `completeDevAccountSwitch` returns a distinct error when `verifyOtp` succeeds but `getSession()` has no user (`'Switch succeeded but no active session was found'`). This is the failure mode that motivated the original bug fix, but there is no unit test for it.
- **Suggestion:** Add a test where `verifyOtp` resolves without error and `getSession` returns `{ session: null }`; assert `success: false` and the specific message.
- **Status:** open

### 3

- **Severity:** suggestion
- **File:line:** `app/api/dev/switch-user/route.ts:115–118`, `app/api/dev/switch-user/route.test.ts`
- **Description:** When `generateLink` succeeds but `data.properties?.hashed_token` is missing, the route throws `'Failed to generate sign-in link'` (generic 500). Tests cover `generateLink` error (`route.test.ts:390–431`) but not the empty-`hashed_token` success path.
- **Suggestion:** Add a test with `generateLink` returning `{ data: { properties: {} }, error: null }` and assert 500 + generic error body.
- **Status:** open

### 4

- **Severity:** suggestion
- **File:line:** `components/DevAccountSwitcher.tsx:49–59`, `components/DevAccountSwitcher.tsx:174`, `components/AppHeader.tsx:85–88`
- **Description:** `dev-test-persona-email` is cleared when the live session is the owner (`DevAccountSwitcher.tsx:52–56`) or after an explicit owner switch (`221–223`), but not on `signOut`. After logout, stale persona data can remain in `localStorage`. `viewingAs` prefers session email when present, so the banner self-corrects once auth loads; however, `storedPersona` can still seed dropdown options via `buildDevSwitcherOptions` (`DevAccountSwitcher.tsx:27–33`) until the next owner session clears the key.
- **Suggestion:** Clear `DEV_TEST_PERSONA_STORAGE_KEY` in `handleLogout` (or a shared auth listener). Optionally clear when `storedPersona !== normalizedCurrentEmail` and both are non-empty.
- **Status:** open

### 5

- **Severity:** suggestion
- **File:line:** `components/DevAccountSwitcher.tsx:174`, `components/AppHeader.tsx:102`
- **Description:** On initial page load, `AppHeader` passes `user?.email` which is `undefined` until each page’s `getSession()` effect completes (e.g. `profile/page.tsx:468–472`). During that window, `viewingAs` falls back to `storedPersona` (`DevAccountSwitcher.tsx:174`), which can flash a stale team email in the amber banner before the real session email arrives — especially if a prior switch left `localStorage` set but the user later signed in normally as owner.
- **Suggestion:** When `normalizedCurrentEmail` is falsy and `storedPersona` is set, show a neutral label (e.g. “loading session…”) instead of the stored persona; or defer banner text until `currentEmail` is known.
- **Status:** open

### 6

- **Severity:** suggestion
- **File:line:** `app/api/dev/switch-user/route.ts:120–126`, `components/DevAccountSwitcher.tsx:211`
- **Description:** `hashed_token` is a single-use authentication credential returned in the JSON body and passed to `verifyOtp`. Replacing `action_link` avoids URL/log leakage and external redirects, but the token is still exposed to any XSS, compromised extension, or devtools/network inspection on shared machines.
- **Suggestion:** Acceptable for dev-only tooling; document the risk beside the switcher. Consider shortening token lifetime via Supabase auth settings if available, and ensure `isDevAccountSwitcherEnabled()` is never true in production deploys.
- **Status:** open

### 7

- **Severity:** suggestion
- **File:line:** `lib/dev-account-switch.ts:25–37`, `app/login/page.tsx:71–73`
- **Description:** `completeDevAccountSwitch` discards the session returned by `verifyOtp` and immediately calls `getSession()`. This mirrors the login page pattern and is likely fine with `@supabase/ssr`, but if cookie persistence lags, `getSession()` could theoretically return the pre-switch session and fail the email-mismatch guard even though `verifyOtp` succeeded.
- **Suggestion:** Prefer `verifyOtp`’s returned `data.session` when present; fall back to `getSession()` only if needed. Add a short retry or `onAuthStateChange` wait if flakiness is observed in manual QA.
- **Status:** open

### 8

- **Severity:** suggestion
- **File:line:** `app/api/dev/switch-user/route.ts:125`, `components/DevAccountSwitcher.tsx`
- **Description:** API still returns `redirect_to` in the success payload (`route.ts:125`) but the client no longer uses it after removing the magic-link redirect. Dead field adds noise for API consumers.
- **Suggestion:** Remove `redirect_to` from the response or keep it only for debugging/logging behind a comment.
- **Status:** open

### 9

- **Severity:** suggestion
- **File:line:** `components/DevAccountSwitcher.tsx:67–156` vs `lib/dev-account-switch.ts:67–152`
- **Description:** Org-resolution and roster-email loading logic remains duplicated between the client dropdown loader and server allowlist helpers (carried forward from prior reviews). Unrelated to session persistence but increases drift risk when RLS or schema changes.
- **Suggestion:** Expose dev-only `GET /api/dev/switch-allowlist` for dropdown options, or extract shared query helpers used by both paths.
- **Status:** open

---

## Prior Issue Reconciliation

| Prior issue (f6017827 pass 3) | This effort | Result |
|-------------------------------|-------------|--------|
| `viewingAs` prefers stale `storedPersona` over session | `viewingAs = normalizedCurrentEmail \|\| storedPersona` + owner-session `localStorage` cleanup | ✅ **Resolved** |
| Session vs banner desync after refresh (root bug) | `verifyOtp` + cookie persistence + reload | ✅ **Addressed in code**; E2E proof still missing (issue #1) |
| Owner bypass on `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER` staging hosts | `isDevBaseOwnerSwitchAllowed()` gated to `isDevEnvironment()` only (`dev-mode.ts:30–32`, `dev-account-switch.ts:158`) | ✅ **Resolved** (pre-existing in scope files) |
| Client/server allowlist divergence | Unchanged | Still open (issue #9) |

---

## Positive Observations

1. **Correct architectural fix:** Client-side `verifyOtp` with admin `hashed_token` is the standard Supabase impersonation pattern for apps without an `/auth/callback` route; it matches how `signInWithPassword` already persists sessions via `createBrowserClient`.
2. **Defense in depth:** Email normalization, `verifyOtp` error surfacing, post-exchange session email check, and reload ensure UI state is rebuilt from cookies rather than optimistic redirect.
3. **Atomic persona write:** `localStorage` is updated only after `completeDevAccountSwitch` succeeds, avoiding the pre-redirect desync called out in earlier reviews.
4. **Test hygiene:** `route.test.ts` assertions use `hashed_token`; no remaining `action_link` references in production code.
5. **Owner fast-path hardening:** `isDevBaseOwnerSwitchAllowed` restricts unconditional owner switching to `NODE_ENV !== 'production'`, reducing staging footgun severity noted in security reviews.

---

## Manual Verification Checklist (recommended before closing)

Prerequisites: dev server, `SUPABASE_SERVICE_ROLE_KEY`, signed in as owner.

1. Switch to a team email → page reloads in-app (no Supabase redirect) → banner and header show team email.
2. F5 refresh → banner, header, and `getSession().user.email` still show team email.
3. `localStorage['dev-test-persona-email']` equals team email.
4. Switch back to owner → reload → persona key removed; session email is owner.
5. Round-trip repeat → each step keeps session, banner, and `localStorage` aligned.

Console check after each step:

```js
const { data } = await (await import('@/lib/supabase/client')).createClient().auth.getSession()
data.session?.user?.email
```

---

## Summary

The session-persistence fix is **sound and complete at the code level**. The broken `action_link` redirect is fully replaced by `hashed_token` + `verifyOtp` + full reload, with session-first banner logic and owner-session `localStorage` cleanup addressing prior UX bugs. **No blocking bugs** were found in this pass. Highest-value follow-ups: E2E or live proof of cookie survival across refresh (issue #1), test for the no-session-after-`verifyOtp` path (issue #2), and sign-out `localStorage` cleanup (issue #4).