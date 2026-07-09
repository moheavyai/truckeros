# Code Review: Forced Carrier Owner (`andrehampton1@outlook.com`)

**Reviewed:** 2026-07-07  
**Scope:** `lib/forced-carrier-owner.ts`, `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`, related tests  
**Implementer summary:** `agent-tools/grok-impl-summary-02a74f17.md`

---

## Executive Summary

Application-layer bypasses for the forced carrier owner are **implemented consistently** across client gates, API permission checks, payload preparation, and server bootstrap branching. `prepareMemberProfileSave()` is the authoritative promotion path and correctly sets `is_primary_owner` and `organization_id` when `actorEmail` matches the allowlist.

**Verdict: Conditionally approved with open issues.** The implementation meets requirements when the account is bootstrapping (no profile / no `organization_id`) or is already `is_primary_owner`. It can **fail in production** when the account is org-linked but not yet primary owner, because DB triggers conflict with the promotion payload, and one UI gate still blocks Viewer-only accounts from editing existing carrier data. Tests pass but are largely mocked and do not exercise database constraints or `ensureOrganizationBootstrap` side effects.

---

## Requirements Traceability

| Requirement | App layer | DB / UI gaps |
|-------------|-----------|--------------|
| `is_primary_owner = true` on every carrier save | ✅ `prepareMemberProfileSave` lines 656–657, 662–664 | ⚠️ Trigger blocks promotion when `organization_id` already set and `is_primary_owner` is false |
| Create organization if missing | ✅ `shouldBootstrapOrganization`, `generateOrganizationId`, `ensureOrganizationBootstrap` | ⚠️ `organization_memberships` INSERT may fail RLS on first bootstrap (chicken-and-egg) |
| Remove bootstrap checks for forced user | ✅ Client + server bypasses verified | — |
| Save always succeeds for logged-in owner | ✅ App gates bypassed | ⚠️ DB triggers + `showEditCarrierButton` can still block |

---

## Verified Correct Paths

### Server (`lib/team-member-profiles-api.ts`)

```
forcedCarrierOwner (L195)
  → viewer bypass for carrier_only (L212–217)
  → dedicated branch: ensureBootstrapOwnerAdminRoles, skip validateBootstrapCarrierSaveRoles (L222–223)
  → canActorSaveCarrierOnlyScope returns true via isForcedCarrierOwner (L134)
  → prepareMemberProfileSave(..., actorEmail) promotes owner (L244)
  → upsert member_profiles (L255–258)
  → ensureOrganizationBootstrap (L273) — unconditional for all self-save scopes
```

### Client (`app/profile/page.tsx`)

```
handleSaveCarrierInfo (L822)
  → isForcedCarrierOwner(actorEmail) (L829)
  → skips canWriteTeamData when forced (L831)
  → canSaveCarrierInfo always true for forced email (L832)
  → skips bootstrap role failure when forced (L838–841)
  → buildCarrierOnlyApiSavePayload(..., actorEmail) (L857)
  → POST save_scope: 'carrier_only' (L860)
```

### Payload authority (`lib/member-profile.ts`)

- `canSaveCarrierInfo` (L185), `validateBootstrapCarrierSaveRoles` (L200), `shouldBootstrapOrganization` (L636), `shouldShowCarrierInformationCard` (L286) all short-circuit for forced email.
- `buildCarrierOnlyApiSavePayload` (L149–169) calls `prepareMemberProfileSave` with `actorEmail`, so promotion cannot be bypassed by stale client state.
- `prepareMemberProfileSave` (L643–667) forces `ensureBootstrapOwnerAdminRoles` and sets `is_primary_owner: true` for forced owner on both existing-org and bootstrap paths.

---

## Issues

### 1

- **Severity:** bug
- **File:Line:** `supabase/migrations/020_member_profiles_privileged_columns.sql:60-62` (conflicts with `lib/member-profile.ts:656-657`, `lib/team-member-profiles-api.ts:255-258`)
- **Description:** `prepareMemberProfileSave` always includes `is_primary_owner: true` in the upsert payload when the forced owner already has an `organization_id` but `is_primary_owner` is still `false` (the exact scenario covered in `lib/forced-carrier-owner.test.ts:26-56` and `lib/team-member-profiles-api.test.ts:253-295`). The PostgreSQL trigger `enforce_member_profile_privileged_columns` raises `Cannot change is_primary_owner on self-update` on that UPDATE. Application logic permits the save; the database rejects it. Mocked unit tests do not surface this.
- **Suggestion:** Either (a) omit `is_primary_owner` from the upsert when the row already has `organization_id` and the actor cannot legally change that column, and rely on a service-role migration/admin step to promote the account; (b) add a DB-side exception for the forced-owner email; or (c) use a service-role client for forced-owner promotion. Align tests with a real trigger/integration fixture, not only mocked Supabase.
- **Status:** open

### 2

- **Severity:** bug
- **File:Line:** `app/profile/page.tsx:1165-1170`
- **Description:** `showEditCarrierButton` requires `canWriteProfile` (`canWriteTeamData(ownProfile)`), which is **not** bypassed for the forced owner. A Viewer-only account (`user_roles: ['Viewer']`, `is_primary_owner: false`) with existing carrier data enters summary mode (`shouldUseCarrierSummaryMode` → true, `shouldShowCarrierForm` → false). The forced owner can pass `handleSaveCarrierInfo` gates but cannot click **Edit Carrier Info** to expand the form. `handleSaveCarrierInfo` bypasses `canWriteTeamData`; the edit toggle does not.
- **Suggestion:** Include `forcedCarrierOwner` in the `showEditCarrierButton` guard (e.g. `(canWriteProfile || forcedCarrierOwner) && canManageCarrier && ...`), mirroring the save-handler bypass at L831.
- **Status:** open

### 3

- **Severity:** bug
- **File:Line:** `supabase/migrations/023_member_profiles_self_service_field_guard.sql:25-57` (relevant when issue #1 prevents promotion)
- **Description:** If `is_primary_owner` cannot be promoted on UPDATE, the self-service field guard still runs with `COALESCE(NEW.is_primary_owner, false) = false` and silently reverts carrier column changes (`company_name`, `usdot_number`, etc.) to `OLD` values. Even a payload that omitted `is_primary_owner` would appear to succeed at the API layer while persisting no carrier changes.
- **Suggestion:** Treat non-primary org-linked forced-owner saves as requiring promotion first, or surface trigger/RLS failures to the client. Add an integration test that asserts `company_name` actually changes in `member_profiles` after save, not only in the mocked upsert payload.
- **Status:** open

### 4

- **Severity:** suggestion
- **File:Line:** `lib/team-member-profiles-api.ts:273`, `lib/team-member-profiles-api.test.ts:253-295`
- **Description:** `ensureOrganizationBootstrap` is invoked after every successful self upsert (including forced-owner `carrier_only`), but no test asserts it runs or that `organizations` / `organization_memberships` rows are created/updated. The forced-owner integration test mocks org table upserts and returns success without verifying call args. On first bootstrap, `organization_memberships` INSERT policy (`021_multi_carrier_foundation.sql:303-306`) requires `auth_user_is_primary_owner_of_org`, which reads from `organization_memberships` — a chicken-and-egg risk before the first membership row exists.
- **Suggestion:** Add a test that captures `supabase.from('organizations').upsert` and `organization_memberships` upsert calls with expected `company_name` and `is_primary_owner: true`. Validate bootstrap against real Supabase or SQL trigger fixtures.
- **Status:** open

### 5

- **Severity:** suggestion
- **File:Line:** `lib/team-member-profiles-api.test.ts:253-295`, `lib/forced-carrier-owner.test.ts:58-83`
- **Description:** Missing `saveTeamMemberProfileForUser` coverage for forced owner with **null** `actorProfile` (first visit, no `member_profiles` row) and for **Viewer-only** actor with existing carrier summary UI. The implementer checklist claims org creation and bootstrap bypass are complete, but the highest-risk paths are untested end-to-end.
- **Suggestion:** Add tests: (1) `mockMaybeSingle` returns `{ data: null }`, forced email, `carrier_only` → payload has new `organization_id`, `is_primary_owner: true`, upsert called; (2) UI/source test that `showEditCarrierButton` respects forced owner.
- **Status:** open

### 6

- **Severity:** suggestion
- **File:Line:** `lib/forced-carrier-owner.ts:2`, `lib/forced-carrier-owner.ts:4-6`
- **Description:** Primary-owner privileges are granted via a hardcoded email string in source. This is opaque in production, difficult to rotate, and invisible to DB RLS/triggers (app-only bypass). Any user who can change their auth email to this address (if the provider allows it) or any deployment that typos the constant loses the bypass silently (`isForcedCarrierOwner(undefined)` → false).
- **Suggestion:** Move to an env var (e.g. `FORCED_CARRIER_OWNER_EMAIL`), document operational procedure, and plan removal once the account is promoted in production. Consider whether DB-level promotion is needed for durability.
- **Status:** open

### 7

- **Severity:** suggestion
- **File:Line:** `app/profile/page.tsx:909-911`
- **Description:** `handleSave` (Save Profile / driver details) still requires `canWriteTeamData(ownProfile)` with **no** forced-owner bypass. After a successful carrier bootstrap, a Viewer-only forced owner sees `shouldShowBootstrapProfilePrompt` but cannot complete driver details without a separate permission path. This may be intentional (carrier-only scope), but it breaks the full onboarding flow for Viewer-shaped rows.
- **Suggestion:** If full bootstrap is required for this account, add a forced-owner bypass for self `member_only`/`full` saves, or document that the account must be pre-promoted to non-Viewer before driver profile completion.
- **Status:** open

### 8

- **Severity:** nit
- **File:Line:** `lib/member-profile.ts:133-137`, `lib/member-profile.ts:162`
- **Description:** Client `buildCarrierOnlyApiSavePayload` calls `prepareMemberProfileSave` with placeholder `userId` `'client-logging'` when `existing` is null. This generates a **different** `organization_id` UUID than the server (which uses the real `userId`). Harmless because `parseMemberProfileForm` ignores body `organization_id`, but debug logs comparing client/server `organization_id` can mislead during bootstrap investigation.
- **Suggestion:** Use a fixed sentinel or skip client-side UUID generation; log only that org will be server-assigned.
- **Status:** open

### 9

- **Severity:** nit
- **File:Line:** `lib/team-member-profiles-api.ts:194`, `lib/forced-carrier-owner.ts:5`
- **Description:** Forced-owner detection depends on `userData.user.email` from `auth.getUser()`. If the JWT/session omits email (some providers, phone-only accounts, or stale sessions), all bypasses silently disable.
- **Suggestion:** Add a dev-only warning in `saveTeamMemberProfileForUser` when the configured forced email's `userId` is known but `email` is null. Confirm Supabase auth for this account always populates email.
- **Status:** open

---

## Gate Audit (Client + Server)

| Gate | Forced owner bypass? | Location |
|------|----------------------|----------|
| `canSaveCarrierInfo` | ✅ Yes | `lib/member-profile.ts:185` |
| `validateBootstrapCarrierSaveRoles` | ✅ Yes (returns `{ ok: true }`) | `lib/member-profile.ts:200` |
| `canActorSaveCarrierOnlyScope` | ✅ Yes | `lib/team-member-profiles-api.ts:134` |
| `canWriteTeamData` (carrier save) | ✅ Client L831; Server L215 | `app/profile/page.tsx`, `lib/team-member-profiles-api.ts` |
| Server bootstrap branch | ✅ Skips `validateBootstrapCarrierSaveRoles` | `lib/team-member-profiles-api.ts:222-223` |
| `shouldShowCarrierInformationCard` | ✅ Always true | `lib/member-profile.ts:286` |
| `showEditCarrierButton` | ❌ No — still requires `canWriteProfile` | `app/profile/page.tsx:1165-1166` |
| `handleSave` (driver profile) | ❌ No — still requires `canWriteTeamData` | `app/profile/page.tsx:911` |
| DB `is_primary_owner` trigger | ❌ No app bypass | `020_member_profiles_privileged_columns.sql:60-62` |
| DB carrier field guard | ❌ Reverts changes when not primary | `023_member_profiles_self_service_field_guard.sql:25-57` |

---

## Test Assessment

| File | Coverage | Gap |
|------|----------|-----|
| `lib/forced-carrier-owner.test.ts` | Email match, payload promotion, org bootstrap UUID | No DB trigger/RLS |
| `lib/team-member-profiles-api.test.ts` | Forced owner carrier_only upsert payload (mocked) | No `ensureOrganizationBootstrap` assertion; no null-profile bootstrap |
| `lib/member-profile.test.ts` | General carrier/bootstrap (92 tests) | No `isForcedCarrierOwner` cases |
| `app/profile/profile-ui.test.ts` | Source inspection for wiring | No `showEditCarrierButton` forced-owner bypass |

Implementer claim of **148/148 passing** is accurate for unit/source tests but does not prove production persistence for org-linked non-primary rows.

---

## Recommended Manual Smoke Test

1. Sign in as `andrehampton1@outlook.com` with a `member_profiles` row that has `organization_id` set and `is_primary_owner = false`.
2. Save carrier info with a new `company_name`.
3. Confirm no DB exception in API logs; confirm `member_profiles.is_primary_owner = true` and `organizations.name` updated.
4. Repeat as Viewer-only with pre-filled carrier data; confirm **Edit Carrier Info** is visible and save round-trips.

---

## Final Verdict

**Conditionally approved — application logic is sound; production durability is not fully proven.**

The forced-owner implementation correctly centralizes promotion in `prepareMemberProfileSave`, bypasses app-layer bootstrap and permission gates on both client and server, and calls `ensureOrganizationBootstrap` after upsert. Open **bugs** remain where UI and database layers can still block saves for Viewer-only or org-linked non-primary accounts, and tests do not catch the `is_primary_owner` trigger conflict. Address issues #1 and #2 before treating the feature as complete for all account states.