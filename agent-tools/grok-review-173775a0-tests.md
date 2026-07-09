# Test Coverage Review: Dev Switcher Session Persistence (`verifyOtp` / reload / refresh)

**Scope:** `agent-tools/grok-impl-summary-173775a0.md`  
**Implementation:** `lib/dev-account-switch.ts`, `lib/dev-account-switch.test.ts`, `app/api/dev/switch-user/route.ts`, `app/api/dev/switch-user/route.test.ts`, `components/DevAccountSwitcher.tsx`, `app/profile/profile-ui.test.ts`  
**Date:** 2026-07-08  
**Status:** open (review only — no fixes applied)

---

## Problem Under Test

The original bug: after dev account switch, **banner / `localStorage` showed the target persona but Supabase session reverted on refresh** because `action_link` redirect did not reliably persist cookies via `@supabase/ssr`.

The fix: server returns `hashed_token` → client `verifyOtp` → cookies saved → `getSession()` confirmation → `localStorage` update → `window.location.reload()`.

**Critical acceptance criteria for this change:**

| Criterion | What must be true |
|-----------|-------------------|
| verifyOtp flow | Client exchanges `hashed_token` with correct email/type; errors surface without reload |
| reload | Full page reload only after successful session + persona write |
| refresh persistence | After F5, session email and banner/`localStorage` stay aligned with switched account |

---

## Test Run (targeted suite)

```bash
npx vitest run lib/dev-account-switch.test.ts app/api/dev/switch-user/route.test.ts app/profile/profile-ui.test.ts
```

**Reported result (impl summary):** **63/63 passing**

| File | Tests | Session-persistence relevance |
|------|-------|-------------------------------|
| `lib/dev-account-switch.test.ts` | 13 | 3 tests target `completeDevAccountSwitch` / `verifyOtp` |
| `app/api/dev/switch-user/route.test.ts` | 11 | 1 primary `hashed_token` happy-path test; mocks org/allowlist |
| `app/profile/profile-ui.test.ts` | 39 | 1 dev-switcher test; 3 new `toContain` assertions for persistence wiring |

**Spot-check in full suite:** `Profile page UI > wires DevAccountSwitcher in AppHeader for dev account switching` passes (`terminals/36.txt:93`). Other `profile-ui` failures are unrelated to dev switcher.

---

## Coverage Assessment

### Well covered (behavioral)

| Area | Evidence | Persistence relevance |
|------|----------|----------------------|
| `verifyOtp` happy path | `lib/dev-account-switch.test.ts:49-73` — asserts `{ email, token, type: 'magiclink' }` and `getSession()` called | ✅ Core exchange |
| `verifyOtp` error propagation | `lib/dev-account-switch.test.ts:75-88` | ✅ No false success |
| Post-verify email mismatch guard | `lib/dev-account-switch.test.ts:90-106` | ✅ Prevents persona/session drift before reload |
| API returns `hashed_token` | `app/api/dev/switch-user/route.test.ts:170-216` | ✅ Server contract for client flow |
| No `action_link` in app source | Grep across `**/*.{ts,tsx}` — zero matches | ✅ Regression guard (static) |
| Owner fast-path through POST | `route.test.ts:218-261` | Indirect (switch-back persistence path) |
| Roster-only actor through POST | `route.test.ts:263-346` | Indirect |
| Dropped `getAuthenticatedMemberProfile` gate | `route.test.ts:44-52` | Indirect |

### Source-grep only (limited behavioral value)

| Area | Evidence | Persistence relevance |
|------|----------|----------------------|
| `completeDevAccountSwitch` wired in UI | `profile-ui.test.ts:692` | Wiring only |
| Reads `hashed_token` from API response | `profile-ui.test.ts:693` | Wiring only |
| Calls `window.location.reload()` | `profile-ui.test.ts:694` | **Does not prove reload timing or success-only guard** |
| `localStorage.removeItem` on owner switch | `profile-ui.test.ts:688` | Partial — **no `setItem` assertion for team switch** |
| In-flight guard | `profile-ui.test.ts:691` | String presence only |

Per `profile-ui.test.ts:1-6`, runtime UI behavior (reload, cookie survival, refresh) is explicitly out of scope until RTL or a browser harness exists.

### Not covered at all

| Area | Implementation | Risk |
|------|----------------|------|
| **Cookie/session survival across refresh** | `verifyOtp` → `@supabase/ssr` `_saveSession` | **Primary bug fix is unverified in CI** |
| End-to-end switch orchestration | `DevAccountSwitcher.tsx:179-234` | fetch → token → verify → storage → reload order untested |
| `reload()` only on success | `DevAccountSwitcher.tsx:229` vs `:230-233` catch | Failed switch could theoretically reload if regressed |
| `localStorage.setItem` for team member | `DevAccountSwitcher.tsx:225` | Refresh banner depends on this + session |
| Mount-time persona sync | `DevAccountSwitcher.tsx:49-59` | Owner session clears stale persona — aids refresh consistency |
| `viewingAs` session-first display | `DevAccountSwitcher.tsx:174` | Fix claims session preferred over stale `localStorage` — **untested** |
| Missing `hashed_token` from `generateLink` | `route.ts:115-118` | 500 path untested |
| `completeDevAccountSwitch` empty credentials | `dev-account-switch.ts:21-23` | Untested |
| No session after successful `verifyOtp` | `dev-account-switch.ts:39-44` | Untested |
| Success payload includes `session` | `dev-account-switch.ts:54` | Untested |
| 503 without service role | `route.ts:54-58` | Untested |
| Negative: response must not include `action_link` | `route.ts:120-126` | Not asserted in route tests |

---

## Open Issues

### 1. Refresh persistence (core fix) has no automated test

| Field | Value |
|-------|-------|
| **Severity** | **bug** |
| **File:line** | `lib/dev-account-switch.ts:25-29`, `components/DevAccountSwitcher.tsx:229` |
| **Description** | The regression was **session reverting after F5** while `dev-test-persona-email` stayed set. Unit tests mock `verifyOtp`/`getSession` and never exercise `@supabase/ssr` cookie writes or a simulated reload. No test asserts “after refresh, `getSession().user.email` matches switched target.” Manual steps 2 and 4 in the impl summary are the only verification. |
| **Suggestion** | Add a gated integration test (Playwright or vitest + real Supabase dev project) that: switch → reload → assert session email + `localStorage`; or mock `createBrowserClient` cookie adapter and assert `_saveSession` is invoked post-`verifyOtp`. |
| **Status** | open |

---

### 2. `handleSwitch` orchestration (verifyOtp → localStorage → reload) is untested

| Field | Value |
|-------|-------|
| **Severity** | **bug** |
| **File:line** | `components/DevAccountSwitcher.tsx:198-229` |
| **Description** | Persistence depends on **ordering**: API success → `hashed_token` present → `completeDevAccountSwitch` success → `localStorage` write → `reload()`. Tests assert the strings exist in source but not that: (a) `reload` is skipped when `completeDevAccountSwitch` fails, (b) `reload` is skipped when `hashed_token` is missing (`:212-214`), (c) `setItem` runs before reload for non-owner targets. A refactor that reloads before `verifyOtp` or on API-only success would pass CI. |
| **Suggestion** | Extract `handleSwitch` body to a testable async function (e.g. `runDevAccountSwitch`) accepting injected `fetch`, `completeDevAccountSwitch`, `reload`, and `localStorage`; add behavioral tests for success and each failure gate. |
| **Status** | open |

---

### 3. `completeDevAccountSwitch` missing edge-case branches

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:line** | `lib/dev-account-switch.ts:21-23`, `:39-44`, `:54` |
| **Description** | Three `completeDevAccountSwitch` tests cover happy path, `verifyOtp` error, and email mismatch. Untested: empty email/token (`Missing sign-in credentials`), `verifyOtp` succeeds but `getSession` returns null (`Switch succeeded but no active session…`), and success return includes `session` object (callers rely on `{ success: true, session }`). |
| **Suggestion** | Add three unit tests with mocked auth client; assert exact error strings and that `getSession` is not called after `verifyOtp` error. |
| **Status** | open |

---

### 4. No regression guard that API/UI dropped `action_link` redirect

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:line** | `app/api/dev/switch-user/route.test.ts:170-216`, `app/profile/profile-ui.test.ts:669-695` |
| **Description** | Static grep shows no `action_link` / `window.location.href` in TS source, but **no test fails if reintroduced**. Route test asserts `body.data.hashed_token` but not `expect(body.data.action_link).toBeUndefined()`. UI test does not assert absence of `action_link` or `location.href`. |
| **Suggestion** | In route happy-path test: `expect(body.data).not.toHaveProperty('action_link')`. In `profile-ui` test: `expect(switcherSource).not.toContain('action_link')` and `not.toMatch(/location\.href\s*=/))`. |
| **Status** | open |

---

### 5. `localStorage.setItem` on team-member switch not asserted

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:line** | `components/DevAccountSwitcher.tsx:225`, `app/profile/profile-ui.test.ts:688` |
| **Description** | Refresh persistence uses `dev-test-persona-email` for banner fallback when session is momentarily unavailable. `profile-ui` asserts `removeItem` on owner switch but **not** `setItem(DEV_TEST_PERSONA_STORAGE_KEY, normalizedTarget)` for team targets. Removing `setItem` would break manual step 2 (`localStorage` check after refresh) while reload/verifyOtp tests still pass. |
| **Suggestion** | `expect(switcherSource).toContain('setItem(DEV_TEST_PERSONA_STORAGE_KEY')` in the dev-switcher source test, or behavioral test in extracted handler (#2). |
| **Status** | open |

---

### 6. Mount-time owner session clears stale persona — untested

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:line** | `components/DevAccountSwitcher.tsx:49-59` |
| **Description** | `useEffect` removes `DEV_TEST_PERSONA_STORAGE_KEY` when `normalizedCurrentEmail === DEV_BASE_OWNER_EMAIL`. This directly addresses refresh-time desync (stale banner after owner session restored). No test references this block. |
| **Suggestion** | Source assertion: `expect(switcherSource).toContain('normalizedCurrentEmail === DEV_BASE_OWNER_EMAIL')` near `removeItem`; or RTL test simulating owner session + stale `localStorage`. |
| **Status** | open |

---

### 7. `viewingAs` session-first logic untested

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:line** | `components/DevAccountSwitcher.tsx:174` |
| **Description** | Impl summary states `viewingAs` was simplified to prefer live session email (`normalizedCurrentEmail || storedPersona`). This is central to **refresh persistence UX** (session should win over stale `localStorage`). No unit or source test locks this precedence; a revert to `storedPersona || normalizedCurrentEmail` would not fail CI. |
| **Suggestion** | Assert source contains `normalizedCurrentEmail || storedPersona` (not reversed), or unit-test a extracted `resolveViewingAs(sessionEmail, storedPersona)` helper. |
| **Status** | open |

---

### 8. API 500 when `generateLink` omits `hashed_token`

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:line** | `app/api/dev/switch-user/route.ts:115-118`, `route.test.ts:390-431` |
| **Description** | Route throws when `data.properties.hashed_token` is falsy after successful `generateLink`. Existing 500 test covers `generateLink` **error** object, not **success with missing token**. Client would hit `Missing sign-in token` (`DevAccountSwitcher.tsx:212-214`) — untested end-to-end. |
| **Suggestion** | Mock `generateLink` returning `{ data: { properties: {} }, error: null }`; assert 500 and `generateLink` called. |
| **Status** | open |

---

### 9. `buildDevSwitcherOptions` still has no unit tests

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File:line** | `components/DevAccountSwitcher.tsx:17-37` |
| **Description** | Options include `storedPersona` when it matches session or roster (`:27-33`), affecting dropdown state after partial reload. Pure logic with no direct tests. |
| **Suggestion** | Export to `lib/dev-account-switch.ts` and test owner-first ordering, stored persona inclusion, deduplication. |
| **Status** | open |

---

### 10. No test that `reload` replaces external redirect

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File:line** | `components/DevAccountSwitcher.tsx:229`, `profile-ui.test.ts:694` |
| **Description** | Fix explicitly replaces Supabase redirect with in-app reload. Test only checks `reload()` is present, not that navigation/redirect patterns are absent or that reload is the **only** post-success navigation. |
| **Suggestion** | `expect(switcherSource).not.toContain('window.location.href')` and `not.toContain('redirect')` in success path (allow `redirect_to` only in API response handling if any). |
| **Status** | open |

---

## Closed Issues (from prior dev-switcher test review)

These were open in `grok-review-f6017827-tests.md` and are **addressed** by the current suite:

| Prior issue | Resolution |
|-------------|------------|
| Owner fast-path at API when allowlist omits owner | `route.test.ts:218-261` |
| Roster-only actor through switch-user route | `route.test.ts:263-346` |
| No guard that `getAuthenticatedMemberProfile` was dropped | `route.test.ts:44-52` |
| `member_profiles` row with null `organization_id` | `dev-account-switch.test.ts:204-217` |
| `isDevSwitchEmailAllowed` negative case | `dev-account-switch.test.ts:114-118` |
| Shallow dev-switcher `toContain` checks | Expanded in `profile-ui.test.ts:684-694` (still source-grep) |

---

## Summary by Severity

| Severity | Open |
|----------|------|
| bug | 2 |
| suggestion | 6 |
| nit | 2 |
| **Total open** | **10** |

---

## Verdict

**Conditional approve for unit-layer changes; not approve for persistence guarantee.**

The `verifyOtp` **contract** is reasonably tested in isolation (`completeDevAccountSwitch` + API `hashed_token` response). Source assertions confirm the UI **wires** the new flow and calls `reload()`.

**Gaps that matter most for this specific fix:**

1. **Refresh persistence (#1)** — the original failure mode has **zero automated coverage**. CI cannot detect a regression where cookies fail to persist across reload.
2. **Switch orchestration (#2)** — reload/localStorage ordering relative to `verifyOtp` success is unverified behaviorally.
3. **Regression guards (#4, #5, #7)** — easy `toContain` / `not.toContain` additions would lock the new design against `action_link` and stale-persona banner regressions.

**Manual verification remains mandatory** for impl summary steps 1–4 (switch → reload → refresh → round-trip) until an integration or extracted-handler test exists.

---

## Recommended Manual Smoke (unchanged from impl summary)

1. Switch to team member → page reloads (no external Supabase URL).
2. F5 → banner, header, and `getSession().user.email` match team email; `localStorage['dev-test-persona-email']` set.
3. Switch back to owner → reload → owner everywhere; `localStorage` key removed.
4. Round-trip again to confirm session and UI stay aligned after each refresh.