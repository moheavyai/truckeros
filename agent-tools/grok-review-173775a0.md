# Merged Review — Account Switcher Persistence (173775a0)

## Priority bugs

### Issue 1 [General] — Severity: bug
- **File**: lib/dev-account-switch.ts:25-29
- **Description**: verifyOtp uses `{ email, token }` but Supabase admin hashed_token expects `{ token_hash, type: 'magiclink' }`.
- **Suggestion**: Fix API shape, update tests, verify manually against live Supabase.
- **Status**: fixed
- **Response**: `completeDevAccountSwitch` now calls `verifyOtp({ token_hash, type: 'magiclink' })`. Tests updated to assert `token_hash` shape and source regression guard added. Live manual switch not run in this session (no dev server); manual steps documented below.

### Issue 2 [Tests] — Severity: bug
- **File**: lib/dev-account-switch.test.ts
- **Description**: No test for verifyOtp OK but getSession empty; no test for missing hashed_token from generateLink.
- **Suggestion**: Add unit tests.
- **Status**: fixed
- **Response**: Added `returns error when verifyOtp succeeds but no session is available` and route test `returns generic 500 when generateLink omits hashed_token`.

### Issue 3 [Tests] — Severity: bug
- **File**: components/DevAccountSwitcher.tsx
- **Description**: fetch→verifyOtp→localStorage→reload orchestration not behaviorally tested; setItem before reload not asserted.
- **Suggestion**: Extract testable handler or add source-slice tests for full flow order.
- **Status**: fixed
- **Response**: Extracted `persistDevTestPersonaEmail()` to `lib/dev-account-switch.ts` with unit tests. Added `profile-ui.test.ts` source-slice asserting `completeDevAccountSwitch` → `persistDevTestPersonaEmail` → `window.location.reload()` order.

## Suggestions (fix all)

### Issue 4 — Severity: suggestion
- **File**: lib/dev-account-switch.ts:25-37
- **Description**: Discards verifyOtp returned session; polls getSession() redundantly.
- **Suggestion**: Use data.session from verifyOtp first.
- **Status**: fixed
- **Response**: Uses `data.session` from verifyOtp first; `getSession()` only called as fallback when verifyOtp returns no session. Test confirms `getSession` not called when verifyOtp returns session.

### Issue 5 — Severity: suggestion
- **File**: components/DevAccountSwitcher.tsx / auth sign-out
- **Description**: dev-test-persona-email not cleared on logout.
- **Suggestion**: Clear on sign-out in AppHeader or auth listener.
- **Status**: fixed
- **Response**: Added `clearDevTestPersonaEmail()`; `AppHeader.handleLogout` clears persona before `signOut()`. Covered by `AppHeader.test.ts` and `profile-ui.test.ts`.

### Issue 6 — Severity: suggestion
- **File**: app/api/dev/switch-user/route.ts
- **Description**: Dead redirect_to in response; unused field.
- **Suggestion**: Remove or use.
- **Status**: fixed
- **Response**: Removed `redirect_to` from JSON response. `redirectTo` still passed to `generateLink` options (Supabase API requirement). Regression test asserts response source lacks `redirect_to`.

### Issue 7 — Severity: suggestion
- **File**: app/api/dev/switch-user/route.test.ts
- **Description**: No test when generateLink omits hashed_token.
- **Suggestion**: Add 500 test.
- **Status**: fixed
- **Response**: Added `returns generic 500 when generateLink omits hashed_token`.

### Issue 8 — Severity: suggestion
- **File**: lib/dev-account-switch.test.ts
- **Description**: No regression guard against action_link/location.href reintroduction.
- **Suggestion**: Assert route and switcher source lack action_link redirect.
- **Status**: fixed
- **Response**: Added source regression tests for `dev-account-switch.ts` (`token_hash`), `route.ts` (no `action_link`), and `DevAccountSwitcher.tsx` (no `action_link` / `location.href = actionLink`).

### Issue 9 — Severity: suggestion
- **File**: lib/dev-account-switch.test.ts
- **Description**: Missing test for empty credentials path.
- **Suggestion**: Add test.
- **Status**: fixed
- **Response**: Added `rejects empty credentials before verifyOtp`.

### Issue 10 — Severity: nit
- **File**: app/profile/profile-ui.test.ts
- **Description**: viewingAs session-first precedence shallow coverage.
- **Suggestion**: Add source assertion for normalizedCurrentEmail || storedPersona.
- **Status**: fixed
- **Response**: Added assertion for `normalizedCurrentEmail || storedPersona || DEV_BASE_OWNER_EMAIL`.

---

## Fix summary (appended)

### Changes made

| File | Change |
|------|--------|
| `lib/dev-account-switch.ts` | `verifyOtp({ token_hash, type: 'magiclink' })`; use verifyOtp session first; added `persistDevTestPersonaEmail`, `clearDevTestPersonaEmail` |
| `lib/dev-account-switch.test.ts` | +9 tests: token_hash, session fallback, empty session, empty credentials, persona persistence, regression guards |
| `app/api/dev/switch-user/route.ts` | Removed dead `redirect_to` from response |
| `app/api/dev/switch-user/route.test.ts` | +1 test for missing `hashed_token` |
| `components/DevAccountSwitcher.tsx` | Uses `persistDevTestPersonaEmail` after successful switch |
| `components/AppHeader.tsx` | `clearDevTestPersonaEmail()` before sign-out |
| `components/AppHeader.test.ts` | +1 test for persona cleanup on logout |
| `app/profile/profile-ui.test.ts` | Flow-order + viewingAs + logout cleanup assertions |

### Test results

```text
npx vitest run lib/dev-account-switch.test.ts app/api/dev/switch-user/route.test.ts app/profile/profile-ui.test.ts components/AppHeader.test.ts
→ 4 files, 78 tests passed
```

### Manual verification (not run — no dev server in session)

1. Sign in as owner → switch to team email → confirm banner/header match switched email.
2. Refresh → session persists as team email.
3. Switch back to `andrehampton1@outlook.com` → refresh → owner session persists.
4. Logout → confirm `localStorage['dev-test-persona-email']` is cleared.