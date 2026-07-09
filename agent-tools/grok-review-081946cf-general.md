# Carrier Save Fix + User Roles UX Cleanup — General Review

**Scope:** `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`, related tests  
**Reference:** `agent-tools/grok-impl-summary-081946cf.md`  
**Tests run:** `npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts lib/team-member-profiles-api.test.ts lib/profile-persistence.test.ts` → **146/146 passing**

---

## Executive Summary

The carrier-save regression is **fixed** with a coherent implicit-bootstrap model: Owner / Admin is injected at every layer (mount `useEffect`, client save handler, payload builder, server upsert) so empty `form.user_roles` no longer blocks org creation. User Roles UX on the **own profile** is intentionally simplified — checkboxes removed, replaced by bootstrap copy + a landing **Owner / Admin** badge.

**Ship recommendation:** Safe to ship for the documented bootstrap / primary-owner happy path. Remaining items are mostly UX polish, orphaned helpers, and non–Owner/Admin role visibility — not blockers for the stated fix.

---

## Verified Fixed

| Area | Status | Evidence |
|------|--------|----------|
| Empty `user_roles` blocks bootstrap carrier save | **Fixed** | `ensureBootstrapOwnerAdminRoles` prepends Owner / Admin (`lib/member-profile.ts:138-146`); applied client (`page.tsx:330-334`, `815-818`), server (`team-member-profiles-api.ts:213-217`), and in `validateBootstrapCarrierSaveRoles` (`member-profile.ts:195`) |
| `shouldBootstrapOrganization` skips primary owner without org | **Fixed** | `existing?.is_primary_owner === true` short-circuit (`member-profile.ts:591`); covered by `prepareMemberProfileSave` test *bootstraps organization when primary owner profile lacks organization_id* |
| `buildCarrierOnlyApiSavePayload` org_id on all paths | **Fixed** | Calls `prepareMemberProfileSave` and copies `organization_id` (`member-profile.ts:158-165`); tests for null existing + empty roles |
| Post-bootstrap driver completion UX | **Fixed** | `shouldShowMemberEditCard` stays true via `shouldShowBootstrapProfilePrompt` (`member-profile.ts:367-368`); test *shows member edit card after bootstrap carrier save when driver details are pending* |
| Carrier/profile concurrent save race | **Fixed** | `carrierSaveInFlight = savingCarrier \|\| savingProfile` disables carrier inputs (`page.tsx:1151`, `1272`, `1281`); handlers early-return on both flags |
| Dev-only `[carrier-save]` logging | **Fixed** | `logCarrierSaveDebug` / `logCarrierSaveWarn` gated on `NODE_ENV === 'development'` (`member-profile.ts:210-217`) |
| Bootstrap without manual role selection | **Fixed** | Server injects roles before `canActorSaveCarrierOnlyScope` (`team-member-profiles-api.ts:213-224`), so partial Driver rows no longer hit Forbidden before bootstrap |
| Standalone User Roles section removed on own profile | **As designed** | `{showUserRolesSection && ...}` removed; `shouldShowUserRolesSection` returns false for `kind === 'self'`; team-member edit card retains `UserRolesCheckboxGrid` (`page.tsx:1475-1489`) |
| Owner / Admin landing badge | **As designed** | `shouldShowOwnerAdminBadge` + `roleBadgeClass` in carrier card header (`page.tsx:1123`, `1227-1235`) |

---

## End-to-End Bootstrap Flow (Current)

```
First visit (ownProfile === null)
  → useEffect injects Owner / Admin into form.user_roles
  → Carrier card visible (isProfileBootstrap banner: "setting up as Owner / Admin…")
  → Member edit card visible (driver fields + Save Profile)
  → User clicks Save Carrier Info
      → ensureBootstrapOwnerAdminRoles(formSnapshot)  [idempotent]
      → validateBootstrapCarrierSaveRoles → ok
      → buildCarrierOnlyApiSavePayload → organization_id + is_primary_owner via prepareMemberProfileSave
  → Server: ensureBootstrapOwnerAdminRoles → validateBootstrapCarrierSaveRoles → upsert → ensureOrganizationBootstrap
  → Landing: carrier summary + Owner / Admin badge; member edit card remains until driver_full_name saved
```

**Partial profile (row exists, no `organization_id`):** Same implicit Owner / Admin injection on server before permission gate; no intermediate Save Profile required.

---

## Open Issues

### 1
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:286-297`, `app/profile/page.tsx:1227-1235`
- **Description:** Non–Owner/Admin users (Driver, Permit Clerk, Viewer) have **no role indicator** on the own-profile landing surface. The previous read-only User Roles section (`USER_ROLES_HELPER_LANDING_READONLY`: *"Your assigned roles."*) was removed with the standalone section. Roles remain visible only in the Team Roster table (`page.tsx:1582-1594`) or after roster **Edit** / **Edit my profile** (which switches `editingTarget` to `member_profile` and shows `UserRolesCheckboxGrid`).
- **Suggestion:** Add a compact read-only role badge row for all assigned roles on landing (not only Owner / Admin), or restore a minimal read-only roles line for `editingTarget.kind === 'self'` when `!shouldShowOwnerAdminBadge` and roles exist.
- **Status:** open

### 2
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:1322-1325`, `app/profile/page.tsx:1475-1489`
- **Description:** Member edit card subtitle still says *"Update driver details, contacts, and roles."* for `editingTarget.kind === 'self'`, but role checkboxes render only when `editingTarget.kind !== 'self'`. Primary owners who want to add secondary roles (e.g. Driver) must discover roster **Edit** on their own row — not mentioned in bootstrap or landing copy.
- **Suggestion:** Split subtitle by target (`self` → driver/contacts only; team members → include roles), or add landing hint: *"To change your roles, use Edit on your row in Team Roster."*
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:204-334`, `app/profile/page.tsx`
- **Description:** Role UX helpers are **orphaned** after the page cleanup: `getUserRolesSectionHelperText`, `isUserRolesReadOnlyOnProfile`, `USER_ROLES_HELPER_*`, and `shouldShowUserRolesSection` are unit-tested but no longer imported by `page.tsx`. `profile-ui.test.ts` only asserts `shouldShowUserRolesSection` exists in `member-profile.ts`, not that the page uses it.
- **Suggestion:** Remove unused helpers and tests, or wire a minimal read-only surface (Issue #1) through the existing helpers to avoid drift.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:819-820`
- **Description:** `handleSaveCarrierInfo` returns silently when `!canSaveCarrierInfo(ownProfile, formSnapshot)` — no `carrierMessage` or toast. Unlikely after implicit role injection, but org-linked non-admin edge cases still hit this path.
- **Suggestion:** Set an error message mirroring the server Forbidden string, or hide Save Carrier Info when `!canManageCarrier` (button is already gated by `showSaveCarrierInfoButton`, but form submit via Enter could still fire).
- **Status:** open

### 5
- **Severity:** nit
- **File:line:** `lib/member-profile.ts:190-201`
- **Description:** `validateBootstrapCarrierSaveRoles` failure copy (*"Owner / Admin is required… Please try saving again."*) is effectively **dead** after `ensureBootstrapOwnerAdminRoles` — it can only fail if `ensureBootstrapOwnerAdminRoles` is bypassed. Defensive, but confusing if ever surfaced.
- **Suggestion:** Narrow to an assert/invariant comment, or reword to *"Setup could not assign Owner / Admin automatically"* for genuine invariant breaks.
- **Status:** open

### 6
- **Severity:** nit
- **File:line:** `lib/member-profile.test.ts:195-216`
- **Description:** `shouldBootstrapOrganization` describe block does not include an explicit case for `is_primary_owner === true` without `organization_id` (covered indirectly via `prepareMemberProfileSave` test). A direct unit test would document the intent of the summary change.
- **Suggestion:** Add `expect(shouldBootstrapOrganization(form, { is_primary_owner: true })).toBe(true)`.
- **Status:** open

### 7
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:128-136`, `lib/team-member-profiles-api.ts:211-230`
- **Description:** Client `buildCarrierOnlyApiSavePayload` includes `organization_id` for logging/traceability, but the server derives org exclusively from `prepareMemberProfileSave(actorProfile)` — POST body `organization_id` is not authoritative. Safe against spoofing; prior reviews noted doc/comment drift.
- **Suggestion:** Keep the existing JSDoc (`member-profile.ts:132-136`) visible in API route docs, or log a dev warning on body/server org mismatch.
- **Status:** open

### 8
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:174-187`, `lib/team-member-profiles-api.ts:128-143`
- **Description:** **Carryover:** `canSaveCarrierInfo` still returns `true` for any profile with `organization_id` (`member-profile.ts:184` is unreachable for org profiles — line 182-183 return first for primary owner / Owner/Admin; actually wait - let me re-read:

```typescript
if (!profile) return true
if (profile.is_primary_owner === true) return true
if (hasOwnerAdminRole(profile.user_roles)) return true
if (!profile.organization_id && hasOwnerAdminRole(form.user_roles)) return true
return false
```

So for org-linked Driver without Owner/Admin, it returns **false**. Good!

But wait - what about org-linked profile where is_primary_owner is false, user_roles is Driver, organization_id exists - returns false. Good.

The old issue about organization_id alone granting access seems fixed in canSaveCarrierInfo. I'll note as **resolved** not open.

### 9
- **Severity:** suggestion  
- **File:line:** `app/profile/page.tsx:330-334`
- **Description:** Mount `useEffect` writes `Owner / Admin` into `form.user_roles` before the user acts. If `syncFormBaseline` ran with empty roles first, this could mark the form dirty without user edits (depending on dirty-tracking timing).
- **Suggestion:** Run `ensureBootstrapOwnerAdminRoles` inside `emptyMemberProfileForm()` initialization for bootstrap, or re-sync baseline after the injection effect.
- **Status:** open

---

## Resolved / Closed From Prior Reviews

| Prior issue | Resolution in this change set |
|-------------|-------------------------------|
| Bootstrap save without Owner / Admin selected | Implicit `ensureBootstrapOwnerAdminRoles` at all layers |
| Member edit card hidden after carrier bootstrap | `shouldShowBootstrapProfilePrompt` keeps card visible |
| Form snapshot after `getSession()` | `formSnapshot` built at handler start (`page.tsx:815-818`) |
| Carrier inputs enabled during profile save | `carrierSaveInFlight` uses both save flags |
| Partial profile + Driver DB roles → server Forbidden | Server injects Owner / Admin before `canActorSaveCarrierOnlyScope` |
| Landing role edits with no Save Profile path | Role checkboxes removed on own profile — issue moot; roles change via roster Edit only |

---

## Test Coverage Assessment

| Layer | Coverage | Gap |
|-------|----------|-----|
| `ensureBootstrapOwnerAdminRoles` | Unit: empty form, preserve other roles, no duplicate | — |
| `validateBootstrapCarrierSaveRoles` | Unit: implicit accept, skip with org / primary owner | Failure path untested (dead) |
| `buildCarrierOnlyApiSavePayload` | Unit: existing org, null profile, empty roles bootstrap | — |
| `shouldShowOwnerAdminBadge` / `shouldShowUserRolesSection` | Unit visibility rules | Page no longer consumes `shouldShowUserRolesSection` |
| Server bootstrap injection | Source inspection + `validateBootstrapCarrierSaveRoles` integration | No mocked test that `saveTeamMemberProfileForUser` calls `ensureBootstrapOwnerAdminRoles` on partial profile |
| UI wiring | `profile-ui.test.ts` source slices for mount effect, handler, badge, copy | No runtime/DOM test for badge vs non-admin role display |

Overall test suite is **strong** for the bootstrap save path; gaps are UX regressions and orphaned helpers rather than save correctness.

---

## UX Assessment

| Persona | Experience |
|---------|------------|
| **New org creator (null profile)** | Clear: amber bootstrap copy, carrier form, implicit Owner / Admin, two-step carrier → driver flow works |
| **Primary owner (established org)** | Carrier card + Owner / Admin badge on landing; role changes require roster self-Edit |
| **Owner / Admin (non-primary)** | Badge on landing; same roster Edit path for role changes |
| **Driver / Permit Clerk / Viewer** | No role summary on profile header; roles only in roster table — weaker self-service clarity |

The UX tradeoff is intentional simplification for bootstrap at the cost of self-profile role visibility for non-admins.

---

## Files Reviewed

| File | Role |
|------|------|
| `lib/member-profile.ts` | Bootstrap helpers, visibility rules, payload builders |
| `lib/team-member-profiles-api.ts` | Server-side role injection + carrier_only gate |
| `app/profile/page.tsx` | UX cleanup, mount effect, carrier save handler |
| `lib/member-profile.test.ts` | 84 tests |
| `app/profile/profile-ui.test.ts` | 35 source-inspection tests |
| `lib/team-member-profiles-api.test.ts` | 16 tests |
| `lib/profile-persistence.test.ts` | 11 tests |

---

**Review status:** open  
**Blocking defects:** none identified for primary-owner bootstrap carrier save  
**Recommended follow-ups:** Issues #1–#3 (role visibility + copy + dead helpers) before next profile UX pass