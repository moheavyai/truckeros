# Dev Account Switcher — Session Persistence Fix

## Problem

Selecting a different email in the dev account switcher called `POST /api/dev/switch-user`, then redirected the browser to Supabase's `action_link`. This app has **no auth callback route** and relies on `@supabase/ssr` `createBrowserClient` for cookie-based sessions. The external magic-link redirect did not reliably exchange tokens into a persisted browser session — after refresh the banner/localStorage could show the target persona while the Supabase session reverted to the original user.

## Design Decision

**Client-side `verifyOtp` with `hashed_token`** instead of `window.location.href = action_link`.

1. Server continues to use `supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', ... })` (same security gates: dev-only, bearer auth, allowlist).
2. Server returns `hashed_token` from `data.properties.hashed_token` (not `action_link`).
3. Client calls `completeDevAccountSwitch()` → `supabase.auth.verifyOtp({ email, token: hashed_token, type: 'magiclink' })`.
4. `@supabase/ssr` saves the new session to cookies via `_saveSession`.
5. Client confirms session with `getSession()` and email match, updates `localStorage` persona, then `window.location.reload()` so all page state reflects the new user.

This avoids needing a new `/auth/callback` route and matches how `signInWithPassword` already persists sessions in this app.

## Files Changed

| File | Change |
|------|--------|
| `lib/dev-account-switch.ts` | Added `completeDevAccountSwitch()` and `DevAccountSwitchResult` type |
| `lib/dev-account-switch.test.ts` | Added 3 tests for verifyOtp success, error, and email mismatch |
| `app/api/dev/switch-user/route.ts` | Return `hashed_token` instead of `action_link` |
| `app/api/dev/switch-user/route.test.ts` | Updated mocks/assertions for `hashed_token` |
| `components/DevAccountSwitcher.tsx` | Use `completeDevAccountSwitch`, reload instead of redirect; simplified `viewingAs` to prefer live session email |
| `app/profile/profile-ui.test.ts` | Assert `completeDevAccountSwitch`, `hashed_token`, `window.location.reload()` |

## Test Results

```text
npx vitest run lib/dev-account-switch.test.ts app/api/dev/switch-user/route.test.ts app/profile/profile-ui.test.ts
→ 3 files, 63 tests passed

npx vitest run lib/dev-account-switch.test.ts app/api/dev/switch-user/route.test.ts app/api/admin/migrate/route.test.ts lib/team-member-profiles-api.test.ts lib/migrations.test.ts app/profile/profile-ui.test.ts
→ 6 files, 139 tests passed (no regressions)
```

## Manual Verification Steps

Prerequisites: dev server running, `SUPABASE_SERVICE_ROLE_KEY` set, signed in as owner.

1. **Switch to team member**
   - Open `/profile` (or any page with the amber dev banner).
   - In **Switch account**, pick a team email other than `andrehampton1@outlook.com`.
   - Page should reload (no external Supabase redirect).
   - Banner shows **Test mode: viewing as** the selected email.
   - Header email matches the selected account.

2. **Confirm persistence after refresh**
   - Press F5 / browser refresh.
   - Banner and header still show the switched email (not owner).
   - `localStorage` key `dev-test-persona-email` equals the team email.

3. **Switch back to owner**
   - Click **Switch back to owner** or select `andrehampton1@outlook.com (owner)`.
   - Page reloads; banner shows owner email.
   - `dev-test-persona-email` removed from `localStorage`.

4. **Round-trip**
   - Switch to team member again → refresh → switch back to owner → refresh.
   - Each step keeps session and UI in sync.

5. **Session check (optional)**
   - In browser devtools console: `const { data } = await (await import('@/lib/supabase/client')).createClient().auth.getSession(); data.session.user.email`
   - Should match the account shown in the banner after each switch and refresh.