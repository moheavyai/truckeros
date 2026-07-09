# Code Review: Carrier Bootstrap Save + User Roles UX — General Pass 3

**Scope:** `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`, related tests  
**Reference:** `agent-tools/grok-impl-summary-081946cf.md`  
**Prior reviews:** `grok-review-fcd8976b-general-3.md`, `grok-review-5bcd107e-general-3.md`  
**Focus:** Implicit bootstrap `Owner / Admin` role injection, User Roles UX removal on own profile, `organization_id` on all carrier-save paths, primary-owner-without-org edge case

---

## Verification Summary

| Focus area | Status | Evidence |
|------------|--------|----------|
| **Bootstrap save without visible role checkboxes** | **Fixed** | `ensureBootstrapOwnerAdminRoles` on mount (`page.tsx:330-334`), in `handleSaveCarrierInfo` (`page.tsx:815-818`), in `buildCarrierOnlyApiSavePayload` (`member-profile.ts:153-156`), and server-side before validation (`team-member-profiles-api.ts:217-218`). Empty `user_roles` bootstrap save now passes validation and bootstraps org. |
| **`validateBootstrapCarrierSaveRoles` gate** | **Fixed** | Applies implicit roles before checking (`member-profile.ts:195-196`). Server mirrors client (`team-member-profiles-api.ts:217-221`). Tests: `validateBootstrapCarrierSaveRoles` (3), `ensureBootstrapOwnerAdminRoles` (2), API source inspection. |
| **`shouldBootstrapOrganization` primary-owner-without-org** | **Fixed** | Returns `true` when `existing?.is_primary_owner === true` even without `organization_id` (`member-profile.ts:591`). Covered by `prepareMemberProfileSave` test `bootstraps organization when primary owner profile lacks organization_id` (`member-profile.test.ts:285-303`). |
| **`organization_id` on all API payload paths** | **Fixed** | `buildCarrierOnlyApiSavePayload` delegates to `prepareMemberProfileSave` for both bootstrap (generated UUID) and existing org (preserved id) (`member-profile.ts:158-165`). Tests: bootstrap with empty roles (`member-profile.test.ts:874-885`), existing org rename (`profile-persistence.test.ts:134-155`). |
| **User Roles UX on own profile** | **Fixed** | Standalone `{showUserRolesSection && ...}` block removed; team edits still use `UserRolesCheckboxGrid` when `editingTarget.kind !== 'self'` (`page.tsx:1475-1489`). Landing badge via `shouldShowOwnerAdminBadge` (`page.tsx:1227-1236`). Bootstrap copy updated (`page.tsx:1221-1225`). |
| **Post-bootstrap driver completion flow** | **Fixed** | `shouldShowMemberEditCard(..., ownProfile)` stays true when `shouldShowBootstrapProfilePrompt` is true (`member-profile.ts:367-368`). Test `shows member edit card after bootstrap carrier save when driver details are pending` (`member-profile.test.ts:1160-1170`). |
| **Carrier / profile save mutual exclusion** | **Fixed** (prior pass) | `carrierSaveInFlight = savingCarrier \|\| savingProfile` disables carrier inputs/button (`page.tsx:1151,1272,1281`). Handler guards unchanged (`page.tsx:821,896`). |
| **Debug logging hygiene** | **Fixed** (prior pass) | `logCarrierSaveDebug` / `logCarrierSaveWarn` dev-only (`member-profile.ts:210-217`). Client `after` log includes `payloadOrgId` + `orgMatch` (`page.tsx:856-864`). |
| **Tests** | **Passing** | **146/146** across `member-profile.test.ts` (84), `team-member-profiles-api.test.ts` (16), `profile-persistence.test.ts` (11), `profile-ui.test.ts` (35). Verified 2026-07-07. |

---

## End-to-End Bootstrap Flow (After Fix)

### 1. First visit — no `member_profiles` row

```
User lands on /profile (ownProfile = null)
  → useEffect: ensureBootstrapOwnerAdminRoles sets form.user_roles = ['Owner / Admin']
  → Carrier card visible (isProfileBootstrap = true)
  → Amber banner: "setting up as Owner / Admin…"
  → User fills carrier fields, clicks Save Carrier Info
      → handleSaveCarrierInfo: ensureBootstrapOwnerAdminRoles on snapshot
      → validateBootstrapCarrierSaveRoles → ok (implicit roles)
      → buildCarrierOnlyApiSavePayload → org UUID + Owner/Admin in payload (logging)
  → Server: ensureBootstrapOwnerAdminRoles → validateBootstrapCarrierSaveRoles
      → canActorSaveCarrierOnlyScope(null) = true
      → prepareMemberProfileSave → organization_id + is_primary_owner
      → upsert INSERT + ensureOrganizationBootstrap
  → Client refresh: ownProfile set, carrier summary mode, member edit card shown
  → showBootstrapProfilePrompt guides driver details + Save Profile
```

### 2. Primary owner with profile row but no `organization_id`

```
existing.is_primary_owner = true, organization_id absent
  → validateBootstrapCarrierSaveRoles skips (is_primary_owner branch)
  → buildCarrierOnlyApiSavePayload skips ensureBootstrapOwnerAdminRoles (is_primary_owner guard)
  → prepareMemberProfileSave: shouldBootstrapOrganization → true via is_primary_owner
  → Org created without requiring Owner/Admin in form roles
```

### 3. Established owner — carrier rename

```
existing.organization_id present
  → buildCarrierOnlyApiSavePayload preserves org via prepareMemberProfileSave existing-org branch
  → buildCarrierOnlySavePayload keeps DB roles (no form role merge when org exists)
  → Server upsert preserves organization_id; ensureOrganizationBootstrap syncs org name
```

---

## Prior Review Issues — Status

| Prior issue (source) | Status |
|----------------------|--------|
| Bootstrap save without Owner/Admin selected (`fcd8976b-general-2` #1) | **Closed** — implicit role injection |
| Member edit card hidden after bootstrap carrier save (`fcd8976b-general-2` #2) | **Closed** — `shouldShowMemberEditCard(..., ownProfile)` |
| Carrier button enabled during profile save (`fcd8976b-general-3` #2) | **Closed** — `carrierSaveInFlight` |
| Unconditional prod `[carrier-save]` logs (`fcd8976b-general-3` #3) | **Closed** — dev-only helpers |
| Client `after` log missing payload org id (`fcd8976b-general-3` #4) | **Closed** — `payloadOrgId` + `orgMatch` |
| `organization_id` in POST body ignored by server (`fcd8976b-general-3` #1) | **Open (by design)** — documented in JSDoc (`member-profile.ts:132-136`); harmless for security |
| `is_primary_owner` promotion on UPDATE (`5bcd107e-general-3` #1) | **Closed** — promotion only on bootstrap path (`member-profile.ts:603-614`) |

---

## Open Issues

### 1
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:281-334`, `app/profile/page.tsx:1475`
- **Description:** After removing the standalone User Roles section on own profile, `shouldShowUserRolesSection`, `isUserRolesReadOnlyOnProfile`, `getUserRolesSectionHelperText`, and `USER_ROLES_HELPER_BOOTSTRAP` are no longer imported or rendered in `page.tsx`. They remain unit-tested in `member-profile.test.ts` but are dead surface-area for the current UI. `page.tsx` inlines `editingTarget.kind !== 'self'` for team-member role checkboxes instead of calling `shouldShowUserRolesSection`.
- **Suggestion:** Remove unused helpers/constants, or wire `page.tsx` to `shouldShowUserRolesSection` for consistency. Update `USER_ROLES_HELPER_BOOTSTRAP` copy to match the carrier-card banner if retained for team flows.
- **Status:** open

### 2
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:195-196`, `lib/member-profile.ts:217-218`
- **Description:** `validateBootstrapCarrierSaveRoles` now always succeeds for bootstrap paths because `ensureBootstrapOwnerAdminRoles` runs immediately before it on both client and server. The error branch (`Owner / Admin is required…`) is effectively unreachable when upstream injection is present — defense-in-depth only.
- **Suggestion:** Keep as-is for safety, or collapse to a single `assertBootstrapCarrierRoles(form, existing)` that documents the implicit-assignment contract. If collapsed, retain one test proving the guard still blocks if `ensureBootstrapOwnerAdminRoles` is bypassed in a future refactor.
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `lib/member-profile.test.ts:195-216`
- **Description:** `shouldBootstrapOrganization` gained an `is_primary_owner === true` branch (`member-profile.ts:591`) but its dedicated `describe` block tests only Owner/Admin-in-form and existing-org cases. The primary-owner-without-org behavior is covered only indirectly via `prepareMemberProfileSave` test at line 285.
- **Suggestion:** Add `expect(shouldBootstrapOrganization(form, { is_primary_owner: true })).toBe(true)` and a negative case with `organization_id` set.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:158-165`, `app/profile/page.tsx:861-863`
- **Description:** On bootstrap INSERT, `buildCarrierOnlyApiSavePayload` generates a client-side `organization_id` via `prepareMemberProfileSave` for logging; the server generates a **different** UUID on upsert. Client `orgMatch` in dev logs will be `false` on first save even when the operation succeeds — can mislead manual smoke testing.
- **Suggestion:** Document in `logCarrierSaveDebug` call site that bootstrap `orgMatch: false` is expected, or omit `orgMatch` when `wasProfileBootstrap` is true. Server `savedOrgId` remains authoritative.
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:330-334`, `lib/member-profile.ts:138-146`
- **Description:** Every new user without a profile row is implicitly assigned `Owner / Admin` on mount. There is no self-service path to onboard as a non-owner Driver on first visit (e.g. invited user completing a personal profile before joining a roster). Product-intentional for carrier founders, but worth documenting if invite-only Driver onboarding is planned later.
- **Suggestion:** Add a code comment on the mount `useEffect` stating that first-visit implicit Owner/Admin is required for org bootstrap; defer invite/Driver-first flows to a separate entry path when implemented.
- **Status:** open

### 6
- **Severity:** nit
- **File:line:** `lib/member-profile.ts:153-156`, `app/profile/page.tsx:815-818`
- **Description:** `ensureBootstrapOwnerAdminRoles` runs twice on the client carrier-save path (handler snapshot + `buildCarrierOnlyApiSavePayload`). Idempotent but redundant.
- **Suggestion:** Optional dedupe: rely on handler injection only and pass `formSnapshot` through without re-injecting in the builder when roles already include Owner/Admin.
- **Status:** open

### 7
- **Severity:** nit
- **File:line:** `lib/team-member-profiles-api.test.ts:253-320`
- **Description:** No mocked `saveTeamMemberProfileForUser` success test for bootstrap INSERT with empty client `user_roles` after server `ensureBootstrapOwnerAdminRoles`. Coverage is strong at pure-helper and source-inspection layers; async orchestration success for the exact regression (hidden roles → save succeeds) is unmocked.
- **Suggestion:** Add one mocked Supabase test: `actorProfile = null`, form with empty `user_roles` + `company_name`, assert upsert payload includes `is_primary_owner: true` and generated `organization_id`.
- **Status:** open

### 8
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:1142-1147`, `app/profile/page.tsx:1148-1149`
- **Description:** **Edit Carrier Info** still requires `canWriteProfile` in addition to `canManageCarrier`, while **Save Carrier Info** visibility uses only `canManageCarrier`. Bootstrap users are unaffected (`canWriteTeamData(null) = true`); the asymmetry mirrors prior review nits and is low risk.
- **Suggestion:** Accept as-is, or align Edit button guard to `canManageCarrier` only for consistency with save visibility.
- **Status:** open

---

## Summary by Severity

| Severity | Count |
|----------|-------|
| bug | 0 |
| suggestion | 5 |
| nit | 3 |
| **Total open** | **8** |

---

## Focus-Area Verdict

| Area | Verdict |
|------|---------|
| **Implicit bootstrap roles** | **Resolved.** Triple injection (mount, client save, server) closes the hidden-roles failure mode. Bootstrap carrier save creates org + primary owner without user selecting checkboxes. |
| **User Roles UX** | **Resolved.** Own-profile role checkboxes removed; compact Owner/Admin badge on landing; team-member editing unchanged. Minor dead-helper cleanup remains. |
| **`organization_id` paths** | **Resolved.** API payload includes org id for bootstrap (generated) and existing org (preserved). Server authority unchanged; body field remains logging-only. |
| **Primary owner without org** | **Resolved.** `shouldBootstrapOrganization` + `prepareMemberProfileSave` handle the edge case; direct unit test for the helper is a small gap. |
| **Onboarding continuity** | **Resolved.** Member edit card and bootstrap prompt appear after carrier save; success copy matches visible UI. |

No open **bugs** remain for the carrier bootstrap fix or User Roles UX cleanup. Remaining items are dead-code hygiene, test depth, logging semantics on bootstrap UUID mismatch, and product-documentation notes.

---

## Notes

- Verified test run: `npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts lib/team-member-profiles-api.test.ts lib/profile-persistence.test.ts` → **146/146 passed**.
- Manual smoke (development): filter console for `[carrier-save]`; on bootstrap first save expect `orgMatch: false` in client `after` log while `savedOrgId` is non-null — server UUID wins.
- No code changes were made in this review pass.