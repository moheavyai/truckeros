# Code Review: Dev Account Switcher — Session Persistence Fix (`verifyOtp` + `hashed_token` + reload)

**Reviewer:** Grok (general pass 2)  
**Scope:** `lib/dev-account-switch.ts`, `lib/dev-account-switch.test.ts`, `app/api/dev/switch-user/route.ts`, `app/api/dev/switch-user/route.test.ts`, `components/DevAccountSwitcher.tsx`, `app/profile/profile-ui.test.ts`  
**Summary ref:** `agent-tools/grok-impl-summary-173775a0.md`

---

## Overview

The fix correctly targets the root cause: redirecting to Supabase `action_link` bypassed `@supabase/ssr` cookie persistence, so the banner/`localStorage` could diverge from the real session after refresh. Moving token exchange to the browser via `completeDevAccountSwitch()` → `verifyOtp()` → `getSession()` → `window.location.reload()` is the right pattern for this app (no `/auth/callback`, `createBrowserClient` with cookie storage).

Server gates are unchanged and appropriate: dev-only flag, bearer auth, org allowlist, admin `generateLink`. Unit tests for the new helper and API response shape pass (63/63 in scoped run).

Remaining gaps are mostly **live Supabase verification**, **test depth beyond mocks**, and **persona `localStorage` hygiene** on logout.

---

## Fix Verification Matrix

| Goal | Status | Notes |
|------|--------|-------|
| Stop external `action_link` redirect | ✅ Pass | `DevAccountSwitcher.tsx` uses `completeDevAccountSwitch` + `reload()`; no `window.location.href` to Supabase |
| Return `hashed_token` from API | ✅ Pass | `route.ts:115-125` |
| Persist session via `@supabase/ssr` | ⚠️ Unverified in CI | Logic is sound (`verifyOtp` → `_saveSession` → cookie storage); no live/integration test |
| Banner prefers live session email | ✅ Pass | `viewingAs = normalizedCurrentEmail \|\| storedPersona \|\| DEV_BASE_OWNER_EMAIL` (`DevAccountSwitcher.tsx:174`) |
| Clear persona on owner switch | ✅ Pass | `removeItem` in `handleSwitch` and `useEffect` when session is owner (`:52-55`, `:222-223`) |

---

## Findings

### 1
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `lib/dev-account-switch.ts:25-29` |
| **Description** | `completeDevAccountSwitch` calls `verifyOtp({ email, token: hashedToken, type: 'magiclink' })`, passing admin `generateLink` output as `token`. Supabase JS docs and `GoTrueClient` examples recommend `{ token_hash: tokenHash, type: 'email' \| 'magiclink' }` for link/hash verification (no email). Scoped tests mock `verifyOtp` and never hit GoTrue, so a parameter-shape mismatch would not be caught in CI. |
| **Suggestion** | Confirm against a live dev project (manual steps in impl summary). If verification fails in any environment, switch to `verifyOtp({ token_hash: token, type: 'magiclink' })` and drop the email field. Add a live test or document the verified parameter shape in a code comment. |
| **Status** | open |

### 2
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `lib/dev-account-switch.ts` / `components/DevAccountSwitcher.tsx` |
| **Description** | The core persistence fix has **no live or integration test** against real Supabase + `@supabase/ssr` cookies. All coverage is mocked (`dev-account-switch.test.ts`) or source-string presence (`profile-ui.test.ts:692-694`). A regression in cookie write, `flowType: "pkce"`, or reload timing would not fail CI. |
| **Suggestion** | Add a gated live test (same pattern as `lib/team-member-profiles-api.live.test.ts`) that: calls `generateLink` → `completeDevAccountSwitch` → asserts `getSession()` email → simulates reload by creating a fresh client and re-reading session. |
| **Status** | open |

### 3
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `lib/dev-account-switch.ts:25-37` |
| **Description** | After successful `verifyOtp`, the helper discards the returned `data.session` and re-fetches via `getSession()`. `verifyOtp` already awaits `_saveSession` before returning (`@supabase/auth-js` `GoTrueClient.ts`), so the extra round-trip is redundant and could mask a storage adapter bug (verify succeeds, `getSession` stale). |
| **Suggestion** | Prefer `const { data, error } = await verifyOtp(...)` and validate `data.session` first; fall back to `getSession()` only if session is null. |
| **Status** | open |

### 4
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `components/DevAccountSwitcher.tsx:221-229` |
| **Description** | `localStorage` persona is updated **before** `window.location.reload()`. If reload is blocked (browser extension, navigation guard) or fails, UI state/`storedPersona` can claim the target email while the Supabase session remains the prior user — the original bug class in a narrower form. |
| **Suggestion** | Set persona after confirmed reload (e.g. rely on post-reload `useEffect` keyed off `normalizedCurrentEmail`), or only write `localStorage` when `completeDevAccountSwitch` returns success **and** schedule reload in `finally` after a microtask so session cookies are flushed first. |
| **Status** | open |

### 5
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `components/AppHeader.tsx:85-88` / `components/DevAccountSwitcher.tsx:49-59` |
| **Description** | `dev-test-persona-email` is cleared when the live session email is the owner (`useEffect`) or when switching to owner (`handleSwitch`), but **not on `signOut`**. After logout → login as a different user without using the switcher, a stale persona can still appear in `buildDevSwitcherOptions` and the `viewingAs` fallback when `currentEmail` is briefly unset. |
| **Suggestion** | Clear `DEV_TEST_PERSONA_STORAGE_KEY` in `handleLogout` (and/or login success) when dev switcher is enabled. |
| **Status** | open |

### 6
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `app/api/dev/switch-user/route.ts:120-126` |
| **Description** | Response still includes `redirect_to`, but the client no longer uses it. `generateLink` still computes `redirectTo` server-side (`route.ts:103-107`) solely for Supabase link metadata. Harmless but adds noise and may confuse future readers expecting a redirect. |
| **Suggestion** | Remove `redirect_to` from the JSON payload (keep `redirectTo` in `generateLink` options if Supabase requires it), or document why it remains. |
| **Status** | open |

### 7
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `app/api/dev/switch-user/route.test.ts` |
| **Description** | No test for `generateLink` succeeding but returning no `properties.hashed_token` (`route.ts:115-118` → generic 500). This is a realistic SDK/version drift scenario distinct from `generateLink` error. |
| **Suggestion** | Add a test: `generateLink` returns `{ data: { properties: {} }, error: null }` → expect 500 and `Failed to switch user` without leaking internals. |
| **Status** | open |

### 8
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `lib/dev-account-switch.test.ts` |
| **Description** | New `completeDevAccountSwitch` tests cover success, `verifyOtp` error, and email mismatch, but not the early guard `Missing sign-in credentials` (`dev-account-switch.ts:21-23`) or the no-session-after-verify path (`:39-44`). |
| **Suggestion** | Add two unit tests for empty email/token and `getSession()` returning null session after successful `verifyOtp`. |
| **Status** | open |

### 9
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `app/profile/profile-ui.test.ts:692-694` / `components/DevAccountSwitcher.tsx:179-234` |
| **Description** | UI coverage for the new flow is still **source-text `toContain`** only. No test asserts call order: `fetch` → `completeDevAccountSwitch` → `localStorage` update → `reload`, or error handling when `hashed_token` is missing (`DevAccountSwitcher.tsx:211-214`). |
| **Suggestion** | Extract `handleSwitch` logic into a testable module (or RTL test with mocked `fetch` / `completeDevAccountSwitch` / `location.reload`) to lock the persistence sequence. |
| **Status** | open |

### 10
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `app/api/dev/switch-user/route.ts:120-125` / `components/DevAccountSwitcher.tsx:211` |
| **Description** | `hashed_token` is a single-use auth credential returned in JSON (replacing `action_link`). Dev-only, but any XSS, compromised extension, or shared-machine network tab capture can steal it before `verifyOtp` consumes it. Risk profile is similar to the prior redirect approach, slightly worse for log aggregation. |
| **Suggestion** | Accept for local dev; avoid enabling `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER` on shared/staging hosts. Optionally shorten token lifetime via Supabase settings or add a dev-only response header warning. |
| **Status** | open |

### 11
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `lib/dev-account-switch.ts:154-162` / `app/api/dev/switch-user/route.ts:96-100` |
| **Description** | Pre-existing: `isDevSwitchEmailAllowed` owner fast-path + `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER=true` allows any authenticated dev user to obtain a magic-link token for `DEV_BASE_OWNER_EMAIL`. Not introduced by this fix, but the new flow makes token consumption faster (no external redirect), slightly lowering the window for interception. |
| **Suggestion** | Restrict owner bypass to `isDevEnvironment()` only (not the public env override), or document the risk beside `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER`. |
| **Status** | open |

### 12
| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File:Line** | `components/DevAccountSwitcher.tsx:174` |
| **Description** | `viewingAs` still falls back to `storedPersona` when `normalizedCurrentEmail` is falsy (e.g. header `user` not yet loaded). The impl summary claims persona is secondary to live session; that holds once `user` is set, but there is a brief load window where stale persona can display. |
| **Suggestion** | While `currentEmail` is loading, show a neutral label (e.g. “Test mode”) or hide persona until session email is known. |
| **Status** | open |

---

## Positive Notes

- **Correct architectural choice:** Client-side `verifyOtp` aligns with how `signInWithPassword` already persists sessions via `createBrowserClient` cookie storage.
- **Defense in depth:** Email normalization + post-verify session email check prevents silent wrong-user switches.
- **API hardening retained:** Malformed JSON → 400, allowlist → 403, non-localhost without `NEXT_PUBLIC_APP_URL` → 500 without calling `generateLink`.
- **`viewingAs` fix:** Preferring `normalizedCurrentEmail` over `storedPersona` directly addresses the refresh desync called out in prior reviews.
- **In-flight guard:** `if (switchingEmail) return` at `handleSwitch` entry reduces duplicate switch requests.

---

## Test Run (Reviewer)

```text
npx vitest run lib/dev-account-switch.test.ts app/api/dev/switch-user/route.test.ts app/profile/profile-ui.test.ts
→ 3 files, 63 tests passed
```

---

## Manual Verification (from impl summary)

1. Switch to team member → reload → banner/header/session email align.  
2. F5 → persistence holds; `localStorage['dev-test-persona-email']` matches.  
3. Switch back to owner → persona cleared.  
4. Round-trip owner ↔ team member with refresh at each step.  
5. Optional console `getSession()` check after each step.

---

## Summary

The persistence fix is **architecturally sound** and **appropriately scoped**. Ship confidence depends on **manual/live Supabase verification** of `verifyOtp` + cookie persistence; automated tests validate wiring but not end-to-end session durability. Address open items around live tests, `localStorage`/logout hygiene, and `verifyOtp` parameter alignment before treating the fix as fully hardened.