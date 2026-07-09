# General Review Pass 2: Carrier Save Fix + User Roles UX Cleanup

**Scope:** `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`, related tests  
**Reference:** `agent-tools/grok-impl-summary-081946cf.md`  
**Related prior issues:** `agent-tools/grok-review-3c36845c-general-2.md` (concurrent saves, bootstrap roles)  
**Date:** 2026-07-07

---

## Fix Verification (impl summary)

| Area | Status | Evidence |
|------|--------|----------|
| Bootstrap carrier save with empty `form.user_roles` | **Fixed** | `ensureBootstrapOwnerAdminRoles` on mount (`page.tsx:330–334`), in `handleSaveCarrierInfo` (`page.tsx:815–818`), in `buildCarrierOnlyApiSavePayload` for non-owner bootstrap (`member-profile.ts:153–156`), and on server (`team-member-profiles-api.ts:217`) |
| `validateBootstrapCarrierSaveRoles` no longer blocks implicit bootstrap | **Fixed** | Helper calls `ensureBootstrapOwnerAdminRoles` internally (`member-profile.ts:195`); tests assert empty-role forms pass (`member-profile.test.ts:729–744`) |
| `organization_id` on all carrier-only API paths | **Fixed** | `buildCarrierOnlyApiSavePayload` resolves via `prepareMemberProfileSave` for bootstrap and existing org (`member-profile.ts:158–165`); tests cover null profile, empty roles, and existing org (`member-profile.test.ts:828–885`) |
| `shouldBootstrapOrganization` for primary owner without org | **Fixed** | `existing?.is_primary_owner === true` short-circuits to true (`member-profile.ts:591`); exercised via `prepareMemberProfileSave` bootstrap test |
| Standalone User Roles section removed on own profile | **Fixed** | `{showUserRolesSection && (` absent from `page.tsx`; roles grid gated to `editingTarget.kind !== 'self'` (`page.tsx:1475–1489`) |
| Owner / Admin badge on landing | **Fixed** | `shouldShowOwnerAdminBadge` + `showOwnerAdminBadge` render in carrier card (`page.tsx:1123`, `1227–1235`); hidden during bootstrap/edit |
| Bootstrap copy updated | **Fixed** | “You are setting up as Owner / Admin…” (`page.tsx:1223–1224`); old “User Roles section below” copy removed |
| Concurrent carrier/profile saves | **Fixed** (prior issue #1) | `isSaving` / `carrierSaveInFlight` gate both handlers and controls (`page.tsx:821`, `896`, `1151–1152`, `1272`, `1281`, `1330`, `1606`) |
| API error surfacing on carrier save failure | **Fixed** | `result.error?.trim() \|\| 'Failed to save carrier information.'` (`page.tsx:867`) |

**Tests:** `npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts lib/team-member-profiles-api.test.ts lib/profile-persistence.test.ts` — **146/146 passed**

---

## Findings

### 1
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:1475–1489`, `lib/member-profile.ts:427–430`
- **Description:** Removing the standalone self-service User Roles section eliminates the only UI path for primary owners to assign supplementary roles to themselves (e.g. **Driver**, **Permit Clerk**). `canSelfEditRoles` still returns true for primary owners, and `toggleRole` remains wired, but the checkbox grid is shown only when `editingTarget.kind !== 'self'`. Primary owners retain full field edit access via `hasFullProfileEditAccess`, so this is not a permissions bug, but roster role badges for an owner who also drives will not reflect supplementary roles without admin/DB intervention.
- **Suggestion:** Document as an accepted UX tradeoff in onboarding copy or team docs, or add a compact “Also assign myself roles” affordance inside the member edit card for primary owners only if supplementary self-roles are product-required.
- **Status:** open (accepted tradeoff unless product says otherwise)

### 2
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:1475`, `lib/member-profile.ts:281–283`
- **Description:** `shouldShowUserRolesSection` is unit-tested and referenced in `profile-ui.test.ts`, but `page.tsx` inlines `editingTarget.kind !== 'self'` instead of calling the helper. A future change to visibility rules could update one site and miss the other.
- **Suggestion:** Replace the inline guard with `shouldShowUserRolesSection(editingTarget)` for a single source of truth.
- **Status:** open

### 3
- **Severity:** nit
- **File:line:** `lib/member-profile.ts:190–201`, `app/profile/page.tsx:823–826`
- **Description:** `validateBootstrapCarrierSaveRoles` always calls `ensureBootstrapOwnerAdminRoles` before checking `hasOwnerAdminRole`, and every caller also pre-applies `ensureBootstrapOwnerAdminRoles`. The `ok: false` branch (and its UI/error message “Please try saving again”) is effectively unreachable in normal flows.
- **Suggestion:** Either remove the dead branch and rely on `ensureBootstrapOwnerAdminRoles` as the sole bootstrap gate, or add a comment/tests documenting it as defense-in-depth for direct API callers that bypass the helper.
- **Status:** open

### 4
- **Severity:** nit
- **File:line:** `lib/member-profile.ts:301–334`, `lib/member-profile.test.ts:415–503`
- **Description:** `isUserRolesReadOnlyOnProfile` and `getUserRolesSectionHelperText` (and their constants `USER_ROLES_HELPER_*`) are no longer referenced by `page.tsx` after the self-section removal. Tests still maintain them, adding surface area without runtime consumers.
- **Suggestion:** Delete unused helpers/constants/tests, or rewire team-member `UserRolesCheckboxGrid` helper text through `getUserRolesSectionHelperText` if the copy should stay centralized.
- **Status:** open

### 5
- **Severity:** nit
- **File:line:** `lib/member-profile.ts:153–156`, `lib/member-profile.ts:586–594`
- **Description:** `buildCarrierOnlyApiSavePayload` skips `ensureBootstrapOwnerAdminRoles` when `existing.is_primary_owner === true` (even without `organization_id`), while `shouldBootstrapOrganization` and the server path both treat that case as bootstrap. Correctness holds because `handleSaveCarrierInfo` and the server inject roles first, but the API builder is asymmetric and would emit empty `user_roles` if called without pre-injection.
- **Suggestion:** Apply `ensureBootstrapOwnerAdminRoles` whenever `!existing?.organization_id` (drop the `!is_primary_owner` exclusion) for defensive consistency.
- **Status:** open

### 6
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:1238–1245`
- **Description:** **Edit Carrier Info** and **Collapse** buttons are not disabled during `carrierSaveInFlight`. During an in-flight save the expanded form inputs are disabled, but the user can still toggle expand/collapse, producing a confusing read-only expanded state.
- **Suggestion:** Add `disabled={carrierSaveInFlight}` (or hide) on carrier summary action buttons.
- **Status:** open

---

## Prior Related Issues (3c36845c-general-2)

| # | Issue | Status in this changeset |
|---|-------|--------------------------|
| 1 | Concurrent carrier + profile saves | **Fixed** — global `isSaving` / `carrierSaveInFlight` |
| 2 | Bootstrap carrier save without persisted roles | **Fixed** — implicit `ensureBootstrapOwnerAdminRoles` on client + server |
| 3 | Team-member dropdown stale value during load | **N/A** — roster uses table **Edit** buttons; no team-member `<select>` remains |

---

## Summary

| Severity | Count |
|----------|-------|
| bug | 0 |
| suggestion | 1 |
| nit | 5 |
| **Total open** | **6** |

**Pass-2 verdict:** The reported bootstrap carrier-save failure and User Roles UX cleanup are **correctly implemented and well-tested**. No blocking bugs found. Remaining items are maintainability nits (orphaned helpers, dead validation branch, inline vs helper guard) and one intentional product tradeoff (primary owners can no longer self-assign supplementary roles). **Approve for merge**; address nits in a follow-up cleanup if desired.