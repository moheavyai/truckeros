# Security Review: Dev Account Switcher + `team_member_profiles.permissions` Migration

**Scope:** `app/api/dev/switch-user/route.ts`, `lib/dev-account-switch.ts`, `components/DevAccountSwitcher.tsx`, `lib/dev-mode.ts`, `app/api/admin/migrate/route.ts`, `supabase/migrations/031_team_member_profiles_permissions.sql`  
**Implementation ref:** `agent-tools/grok-impl-summary-f6017827.md`  
**Focus:** Input validation, `/api/dev/switch-user` auth after lighter auth change, admin-client allowlist privilege escalation, sensitive logging, OWASP patterns  
**Date:** 2026-07-08  
**Criteria:** Real exploitable issues only in intended deployment configs

---

## Summary

Effort 4 intentionally relaxes `/api/dev/switch-user` auth so roster-only / team-member sessions can switch back to the hardcoded dev owner. **Default production configuration is not exploitable** (`isDevAccountSwitcherEnabled()` is false when `NODE_ENV === 'production'` and `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER` is unset).

**Admin-client allowlist lookup does not create cross-tenant privilege escalation:** `organizationId` is resolved with the actor’s authed client before `supabaseAdmin` reads roster emails, and admin queries are scoped with `.eq('organization_id', organizationId)`.

When the dev switcher **is** enabled (local dev or explicit flag), any authenticated JWT holder can obtain a magic link for `DEV_BASE_OWNER_EMAIL` and for every email in their resolved org — by design for dev impersonation, but dangerous on shared/staging hosts.

The permissions migration path reuses existing admin auth, CSRF, and production DDL guards; no new exploitable issues found there.

---

## Attack paths verified safe (default production)

| Scenario | Result |
|----------|--------|
| Unauthenticated `POST /api/dev/switch-user` | **Blocked:** 401 without Bearer token (`app/api/dev/switch-user/route.ts:34-37`) |
| Dev switcher call in production build (default env) | **Blocked:** 404 when `isDevAccountSwitcherEnabled()` is false (`app/api/dev/switch-user/route.ts:30-32`, `lib/dev-mode.ts:15-17`) |
| Switch to email outside org allowlist | **Blocked:** 403 via `isDevSwitchEmailAllowed` (`app/api/dev/switch-user/route.ts:78-82`) |
| Admin allowlist fetch reads another org’s roster | **Not observed:** `organizationId` comes from actor-scoped `resolveDevSwitchOrganizationId`; admin reads filter on that id only (`lib/dev-account-switch.ts:10-37`, `:55-64`) |
| Forged Bearer token | **Blocked:** `createAuthedSupabaseClient` + `auth.getUser()` rejects invalid tokens (`app/api/dev/switch-user/route.ts:47-55`) |
| `POST /api/admin/migrate` without admin session | **Blocked:** `requireAdminUser()` (`app/api/admin/migrate/route.ts:224-227`) |
| Cross-origin CSRF on migrate POST | **Blocked:** `isSameOriginPostRequest` (`app/api/admin/migrate/route.ts:220-222`) |
| Live DDL in production without explicit opt-in | **Blocked:** `MIGRATE_ALLOW_LIVE_IN_PRODUCTION` gate (`app/api/admin/migrate/route.ts:241-255`) |
| Sensitive data in dev-switch server logs | **Not observed:** no `console.*` in dev-switch route or helper |

---

## Admin-client allowlist analysis (privilege escalation)

| Question | Finding |
|----------|---------|
| Cross-org email disclosure via admin client? | **No.** Admin client is only used after `resolveDevSwitchOrganizationId` returns the actor’s org (from `member_profiles` or actor-linked `team_member_profiles`). Queries are `.eq('organization_id', organizationId)`. |
| Within-org impersonation broader than RLS? | **Yes, intentionally.** Admin client returns the full org roster even when authed RLS would under-read; switch targets remain limited to that org plus the hardcoded dev owner. This fixes the team-member switch-back regression, not a cross-tenant bypass. |
| Lighter auth widens callers? | **Yes.** Replacing `getAuthenticatedMemberProfile` with JWT-only auth allows any valid session (including users without a `member_profiles` row) to call the endpoint when the switcher is enabled. Combined with the owner fast-path, that expands who can request an owner magic link in dev environments. |

---

## Open issues

### 1. Dev switcher enabled on shared hosts allows any authenticated user to obtain owner magic link

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File** | `lib/dev-account-switch.ts:82-85`, `app/api/dev/switch-user/route.ts:78-83` |
| **Description** | `isDevSwitchEmailAllowed` unconditionally permits `DEV_BASE_OWNER_EMAIL` as a switch target. After the lighter-auth change, any holder of a valid JWT (not only org owners / `member_profiles` rows) can `POST` that email and receive `action_link` from `supabaseAdmin.auth.admin.generateLink`. This is the intended “switch back to owner” path for team members, but on any network-accessible deployment where `isDevAccountSwitcherEnabled()` is true (`NODE_ENV !== 'production'` or `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER=true`), a low-privilege org member—or a freshly registered user with no profile—can take over the hardcoded platform owner account. Not reachable when the switcher is disabled (default production). |
| **Suggestion** | Keep switcher disabled on shared/staging/production unless strictly necessary. If staging QA needs it, add server-side actor checks: e.g. allow owner-target only when `actorEmail` is already in the org allowlist and has Owner/Admin role, or gate owner-target behind a separate server secret / break-glass header. Consider server-only enablement (`isDevEnvironment()` without `NEXT_PUBLIC_*` override). |
| **Status** | open |

### 2. `redirectTo` derived from request Host headers when `NEXT_PUBLIC_APP_URL` is unset

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File** | `app/api/dev/switch-user/route.ts:17-22`, `app/api/dev/switch-user/route.ts:85-89` |
| **Description** | `appBaseUrl()` falls back to `x-forwarded-host` / `host` from the incoming request when `NEXT_PUBLIC_APP_URL` is missing. An authenticated caller who can influence those headers could embed an attacker-controlled origin in the Supabase magic-link `redirectTo`, enabling open-redirect / phishing after sign-in when the dev switcher is enabled. |
| **Suggestion** | Require `NEXT_PUBLIC_APP_URL` for magic-link generation, or validate computed origin against an allowlist before passing to `generateLink`. Reject requests when host does not match configured app URL. |
| **Status** | open |

### 3. Supabase error messages returned verbatim to clients

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File** | `app/api/dev/switch-user/route.ts:107-110` |
| **Description** | The catch block returns `error.message` from Supabase/admin failures in the JSON body (500). This can leak internal auth configuration or user-existence hints to any authenticated caller when the switcher is enabled (OWASP API3:2023 excessive data exposure). |
| **Suggestion** | Log full errors server-side with a correlation id; return a generic client message (mirror `logAndSanitizeError` in `app/api/admin/migrate/route.ts:64-71`). |
| **Status** | open |

### 4. PostgREST filter strings interpolate email values

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File** | `lib/dev-account-switch.ts:29-30`, `components/DevAccountSwitcher.tsx:71-72` |
| **Description** | `resolveDevSwitchOrganizationId` and the client roster fallback build `.or(\`linked_user_id.eq.${id},driver_email.eq.${email}\`)` via string interpolation. Values come from JWT/session today, but malformed `driver_email` roster data or unusual auth emails containing PostgREST metacharacters (commas, `.eq.`) could theoretically alter filter semantics. |
| **Suggestion** | Prefer parameterized filters (`.eq('linked_user_id', userId).or(\`driver_email.eq.${escaped}\`)` with strict email validation) or a SECURITY DEFINER RPC for org resolution. |
| **Status** | open |

### 5. One-time magic link credential returned in API JSON

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File** | `app/api/dev/switch-user/route.ts:99-105`, `components/DevAccountSwitcher.tsx:169-174` |
| **Description** | `action_link` is a single-use authentication credential returned in the response and passed to `window.location.href`. Necessary for the dev UX, but any XSS, compromised browser extension, or proxy/access-log capture on shared dev machines could steal the link before use. |
| **Suggestion** | Document handling constraints for dev environments; ensure no middleware/access logs record response bodies; keep switcher off on shared hosts. |
| **Status** | open |

---

## Permissions migration (`031`) — security notes

| Check | Result |
|-------|--------|
| Auth on `GET/POST /api/admin/migrate` | Unchanged — `requireAdminUser()` + same-origin POST |
| SQL injection via migration `031` | **Not applicable** — static SQL from `getMigration031Sql()` |
| `permissions` column default | Safe default `{"mode":"global"}`; no privilege bypass introduced |
| Schema-check information disclosure | Pre-existing — admin-only GET returns migration SQL snippets |

No additional open issues for the migration path.

---

## Severity counts

| Severity | Open count |
|----------|------------|
| bug (critical/high) | 0 |
| suggestion (medium defense-in-depth) | 3 |
| nit (low/informational) | 2 |
| **Total open exploitable in default production** | **0** |

---

## Deploy note

- **Production:** Leave `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER` unset; endpoint returns 404. Ensure `NEXT_PUBLIC_APP_URL` is set wherever magic links are generated.
- **Dev / staging:** Treat `SUPABASE_SERVICE_ROLE_KEY` + enabled switcher as break-glass: any authenticated user can impersonate the hardcoded owner and all org roster emails. Restrict network access and do not enable the public flag on production-like hosts.