# Security Review: Dev Account Switcher — Session Persistence (`verifyOtp` / `hashed_token`)

**Scope:** `lib/dev-account-switch.ts`, `app/api/dev/switch-user/route.ts`, `components/DevAccountSwitcher.tsx`, `lib/dev-mode.ts`  
**Implementation ref:** `agent-tools/grok-impl-summary-173775a0.md`  
**Focus:** `verifyOtp` session exchange, `hashed_token` exposure, auth gates and impersonation boundaries  
**Date:** 2026-07-08  
**Criteria:** Real exploitable issues only in intended deployment configs; severity = `bug` / `suggestion` / `nit`

---

## Summary

The session-persistence fix replaces `window.location.href = action_link` with a two-step flow: server returns `hashed_token` from `auth.admin.generateLink`, client calls `supabase.auth.verifyOtp({ email, token, type: 'magiclink' })`, then reloads. This correctly aligns with `@supabase/ssr` cookie persistence and fixes the persona/session desync bug.

**Default production is not exploitable:** `isDevAccountSwitcherEnabled()` is `false` when `NODE_ENV === 'production'` and `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER` is unset — the route returns 404.

When the switcher **is** enabled, the endpoint remains a break-glass impersonation primitive: any holder of a valid JWT can obtain a one-time `hashed_token` for allowlisted targets (org roster + dev owner in `NODE_ENV !== 'production'`). The `verifyOtp` change does not widen that auth boundary; it changes **how** the credential is consumed and **where** it is exposed in the browser.

**No `bug`-severity issues** found for default production. Residual risk is concentrated on shared/staging hosts with the switcher enabled and on credential handling in the new client-side exchange path.

---

## `verifyOtp` flow analysis

| Step | Location | Assessment |
|------|----------|------------|
| Server generates magic-link OTP | `route.ts:104-108` via `supabaseAdmin.auth.admin.generateLink` | Correct use of admin API; gated by dev flag, Bearer auth, allowlist, service-role presence |
| Server returns `hashed_token` only | `route.ts:115-126` | `action_link` no longer sent to client — reduces open-redirect surface from consumed URL |
| Client exchanges token | `dev-account-switch.ts:25-29` | `verifyOtp` with `type: 'magiclink'` is the documented pattern for `generateLink` output |
| Session persisted to cookies | `@supabase/ssr` via `createBrowserClient` | Avoids missing `/auth/callback`; matches existing `signInWithPassword` persistence model |
| Post-exchange validation | `dev-account-switch.ts:35-52` | `getSession()` + email match prevents updating `localStorage` on partial/failed exchange |
| Page reload | `DevAccountSwitcher.tsx:229` | Ensures server components re-render under new cookie session |

**Verified safe behaviors**

- `verifyOtp` failure does not write `localStorage` or reload (`DevAccountSwitcher.tsx:216-219`, `231-232`).
- `completeDevAccountSwitch` rejects empty token/email before calling Supabase (`dev-account-switch.ts:21-23`).
- Email normalization is consistent between server allowlist and client `verifyOtp` (`normalizeInviteEmail`).

**Residual `verifyOtp` concerns** (see open issues): errors and mismatch messages are returned verbatim to the UI; `verifyOtp` return payload is ignored in favor of a separate `getSession()` poll (acceptable but timing-sensitive).

---

## `hashed_token` exposure analysis

| Exposure surface | vs. prior `action_link` redirect | Notes |
|------------------|-----------------------------------|-------|
| Browser DevTools Network tab | **Same / worse** | `POST /api/dev/switch-user` JSON body contains `hashed_token` + `email` together |
| Proxy / access-log response bodies | **Same risk** | Single-use credential in HTTP response; depends on infra logging policy |
| Browser history | **Improved** | No navigation to external Supabase URL |
| Referer / third-party redirect | **Improved** | No off-site redirect |
| Application JS heap | **Worse** | Token sits in `result.data.hashed_token` until `verifyOtp` completes — longer XSS interception window |
| Credential binding | **Unchanged** | `(email, hashed_token)` is not bound to requesting user, session, or origin; first successful `verifyOtp` wins |

The `hashed_token` is a **single-use authentication credential**. Paired with the target `email` returned in the same JSON payload, it is sufficient to establish a session as the target user from any caller that can reach Supabase Auth.

---

## Auth analysis

### Server (`POST /api/dev/switch-user`)

| Control | Status | Reference |
|---------|--------|-----------|
| Dev-only gate | ✅ | `isDevAccountSwitcherEnabled()` → 404 in default production |
| Bearer required | ✅ | `extractBearerToken` → 401 |
| JWT validation | ✅ | `createAuthedSupabaseClient` + `auth.getUser()` → 401 |
| Service role required | ✅ | `hasAdminAccess` / `supabaseAdmin` → 503 |
| Target allowlist | ✅ | `isDevSwitchEmailAllowed` + org-scoped `fetchDevSwitchAllowlistEmails` → 403 |
| Cross-tenant roster reads | ✅ Not observed | Admin reads scoped to actor-resolved `organizationId` |
| `redirectTo` host poisoning | ✅ Mitigated | Non-localhost `Host` / `x-forwarded-host` rejected without `NEXT_PUBLIC_APP_URL` (`route.ts:27-34`, test at `route.test.ts:348-388`) |
| Supabase admin error leakage (route) | ✅ Mitigated | `generateLink` failures map to generic 500 (`route.test.ts:390-431`) |

### Lighter auth (intentional)

Replacing `getAuthenticatedMemberProfile` with JWT-only auth expands callers to roster-only / no-`member_profiles` sessions. Combined with org resolution + allowlist, this is required for team-member switch-back and does not bypass cross-org boundaries.

### Owner fast-path

`isDevBaseOwnerSwitchAllowed()` restricts unconditional owner targeting to `NODE_ENV !== 'production'` (`dev-mode.ts:30-32`). When `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER=true` on a **production build**, the switcher can be enabled but owner bypass is off — owner must appear in the org-derived allowlist. This is a meaningful hardening vs. the public flag alone.

### Client auth

- Switch request uses `Authorization: Bearer ${accessToken}` from `getSession()` (`DevAccountSwitcher.tsx:193-203`).
- No cookie-only CSRF path: endpoint requires explicit Bearer header.
- No `isSameOriginPostRequest` check (unlike `/api/admin/migrate`); risk is low because cross-origin sites cannot read the bearer token without XSS.

---

## Attack paths verified safe (default production)

| Scenario | Result |
|----------|--------|
| Unauthenticated `POST /api/dev/switch-user` | **Blocked:** 401 |
| Call in production build (default env) | **Blocked:** 404 |
| Switch to email outside org allowlist | **Blocked:** 403 |
| Forged Bearer token | **Blocked:** `getUser()` failure → 401 |
| Cross-tenant allowlist via admin client | **Not observed:** org id from actor-scoped resolution |
| `hashed_token` usable without email | **Blocked:** `verifyOtp` requires matching `email` parameter |
| Successful exchange with wrong session email | **Blocked:** `completeDevAccountSwitch` mismatch guard |

---

## Open issues

### 1. `hashed_token` + email returned together in API JSON enables off-device session takeover when switcher is enabled

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File** | `app/api/dev/switch-user/route.ts:120-126`, `components/DevAccountSwitcher.tsx:206-216` |
| **Description** | The response bundles `email` and `hashed_token` — a single-use login credential. Any party that captures the JSON (shared DevTools, response-body logging, MITM on non-TLS, malicious browser extension, or XSS) can call `verifyOtp` from another context before the legitimate client does. First successful exchange wins; the token is not bound to the requesting JWT or browser fingerprint. This is dev-only by gate, but strictly worse than server-side exchange because the credential transits application JS and remains valid until consumed. |
| **Suggestion** | Keep switcher disabled on shared networks; prohibit response-body logging on dev APIs. Longer term: perform `verifyOtp` server-side and return only Set-Cookie headers, or bind tokens to the actor session server-side if Supabase supports it. |
| **Status** | open |

### 2. Any authenticated JWT can obtain impersonation tokens for org roster (and owner in non-production) when switcher is enabled

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File** | `lib/dev-account-switch.ts:154-162`, `app/api/dev/switch-user/route.ts:84-101` |
| **Description** | After lighter-auth, any valid session (including roster-only users and actors with `organizationId: null`) can request `hashed_token` for `DEV_BASE_OWNER_EMAIL` when `isDevBaseOwnerSwitchAllowed()` is true (`NODE_ENV !== 'production'`), and for all emails in the actor's resolved org allowlist. This is intentional for dev impersonation but grants full account takeover of the hardcoded owner and all org members on any network-reachable dev/staging host. |
| **Suggestion** | Do not set `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER=true` on shared or production-like hosts. Consider actor role checks (Owner/Admin only), a server-only enable flag, or a break-glass shared secret for owner targeting. |
| **Status** | open |

### 3. `verifyOtp` and session-validation errors returned verbatim to the client UI

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File** | `lib/dev-account-switch.ts:31-32`, `lib/dev-account-switch.ts:48-51`, `components/DevAccountSwitcher.tsx:217-218`, `231` |
| **Description** | `completeDevAccountSwitch` forwards `verifyError.message` (e.g. *"Token has expired or is invalid"*) and constructs session-mismatch messages that include expected/actual emails. `DevAccountSwitcher` displays these via `setError`. Any authenticated dev-switcher caller receives auth-state hints (OWASP API3 excessive data exposure). Route-level Supabase errors are sanitized; client-side exchange errors are not. |
| **Suggestion** | Map known `verifyOtp` failures to generic dev messages; log details server-side or to console only in development. |
| **Status** | open |

### 4. `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER=true` enables org-member impersonation on production builds

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File** | `lib/dev-mode.ts:21-24`, `app/api/dev/switch-user/route.ts:45-47` |
| **Description** | The public env flag enables the endpoint whenever set, including `NODE_ENV=production`. Owner fast-path is disabled in production (`isDevBaseOwnerSwitchAllowed`), but any authenticated user who resolves an org can still obtain `hashed_token` values for roster members. Requires `SUPABASE_SERVICE_ROLE_KEY` on the server — a high-privilege misconfiguration footgun. |
| **Suggestion** | Restrict enablement to `isDevEnvironment()` server-side (ignore public client flag for the API), or require an additional server secret. Document prominently in deploy runbooks. |
| **Status** | open |

### 5. No rate limiting on `generateLink` via switch-user

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File** | `app/api/dev/switch-user/route.ts:104-108` |
| **Description** | Each allowlisted POST invokes `supabaseAdmin.auth.admin.generateLink`. An authenticated caller can spam impersonation token generation (DoS against auth admin API, noise in auth logs, many single-use credentials in flight). Mitigated by dev-only gate and allowlist, but not by per-user throttling. |
| **Suggestion** | Add per-actor rate limiting (e.g. 10/min) when the switcher is enabled. |
| **Status** | open |

### 6. `localStorage` persona is written only after `verifyOtp` but remains a client-side trust signal

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File** | `components/DevAccountSwitcher.tsx:221-227`, `lib/dev-mode.ts:10` |
| **Description** | `dev-test-persona-email` is not an auth mechanism, but the amber banner reads from session with `storedPersona` fallback (`viewingAs = normalizedCurrentEmail \|\| storedPersona \|\| …`). A manual `localStorage` edit could mislabel test mode until the next switch or owner session clears it (`DevAccountSwitcher.tsx:52-55`). No server-side privilege bypass — UI-only confusion. |
| **Suggestion** | Treat banner as cosmetic; derive display solely from `getSession()` if misleading labels are a concern. |
| **Status** | open |

### 7. Unused `redirect_to` field still returned in switch-user response

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File** | `app/api/dev/switch-user/route.ts:120-126` |
| **Description** | Client no longer navigates to `redirect_to`; field is dead data in the JSON response. Low risk, minor unnecessary disclosure of configured app URL. |
| **Suggestion** | Omit `redirect_to` from client payload or use only server-side when calling `generateLink`. |
| **Status** | open |

### 8. `completeDevAccountSwitch` ignores `verifyOtp` return value and polls `getSession()` separately

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File** | `lib/dev-account-switch.ts:25-37` |
| **Description** | On success, `verifyOtp`'s inline session is discarded; a follow-up `getSession()` determines validity. Unlikely exploitable — email mismatch guard catches stale sessions — but introduces a narrow timing window where `_saveSession` may not have completed before the poll in slow environments. |
| **Suggestion** | Prefer the session from `verifyOtp` data when present; fall back to `getSession()` only if null. |
| **Status** | open |

---

## Issues addressed by this change (closed)

| Prior concern | Resolution in session-persistence fix |
|---------------|---------------------------------------|
| Magic-link redirect did not persist `@supabase/ssr` cookies | Client `verifyOtp` + reload |
| Persona/session desync after refresh | Session email preferred; `localStorage` updated only after confirmed exchange |
| `redirectTo` from attacker-controlled Host on shared hosts | Localhost-only fallback without `NEXT_PUBLIC_APP_URL` (`route.ts:27-34`) |
| Supabase `generateLink` error strings in route 500 body | Generic *"Failed to switch user"* for admin failures |
| Stale `localStorage` when signed in as owner | Cleared on mount when session email is owner (`DevAccountSwitcher.tsx:52-55`) |

---

## Severity counts

| Severity | Open count |
|----------|------------|
| bug | 0 |
| suggestion | 5 |
| nit | 3 |
| **Total open exploitable in default production** | **0** |

---

## Deploy notes

- **Production (default):** Leave `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER` unset. Endpoint returns 404; `verifyOtp` path is unreachable.
- **Local dev:** Treat `SUPABASE_SERVICE_ROLE_KEY` + enabled switcher as break-glass. Do not share DevTools/network captures containing `/api/dev/switch-user` responses.
- **Staging / preview:** Set `NEXT_PUBLIC_APP_URL` explicitly. Avoid `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER=true` unless network access is restricted and response-body logging is disabled.
- **Verification:** After switch + hard refresh, `getSession().user.email` must match the banner (`grok-impl-summary-173775a0.md` manual step 5).