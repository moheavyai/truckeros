# Merged Review: Carrier Save Fix + User Roles UX Cleanup (081946cf)

**Date:** 2026-07-07  
**Reference:** `agent-tools/grok-impl-summary-081946cf.md`  
**Tests:** `npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts lib/team-member-profiles-api.test.ts lib/profile-persistence.test.ts` → **154/154 passed**

---

## Verdict

**Approved — 0 open issues.** Carrier save bootstrap path is fixed; User Roles UX cleanup is complete with follow-up polish applied.

---

## Fix Verification

| Area | Status |
|------|--------|
| Bootstrap carrier save with hidden/empty `user_roles` | **Fixed** — `ensureBootstrapOwnerAdminRoles` at mount, client save, payload builder (all `!organization_id` paths), and server |
| `organization_id` on all carrier-only paths | **Fixed** — `buildCarrierOnlyApiSavePayload` + `prepareMemberProfileSave` |
| Primary owner without org edge case | **Fixed** — `shouldBootstrapOrganization` + payload builder no longer skips role injection for `is_primary_owner` |
| Standalone User Roles on own profile | **Removed** — `shouldShowUserRolesSection` gates team-member edit card only |
| Owner / Admin landing badge | **Fixed** — compact badge in carrier card |
| Non–Owner/Admin role visibility on landing | **Fixed** — `shouldShowAssignedRoleBadges` + read-only badges under page header |
| Member edit card subtitle | **Fixed** — `getMemberEditCardSubtitle` omits "roles" for self edits |
| Silent `canSaveCarrierInfo` denial | **Fixed** — surfaces `CARRIER_SAVE_FORBIDDEN_MESSAGE` |
| Edit/Collapse during carrier save | **Fixed** — `disabled={carrierSaveInFlight}` |
| Bootstrap `orgMatch` logging | **Fixed** — `null` when `wasProfileBootstrap` (expected server UUID mismatch) |

---

## Review Issues — Resolution

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Non–Owner/Admin users lack role indicator on landing | **Closed** — `shouldShowAssignedRoleBadges` + `getLandingAssignedRoles` |
| 2 | Member edit subtitle mentions roles for self | **Closed** — `getMemberEditCardSubtitle` |
| 3 | Orphaned role UX helpers | **Closed** — `shouldShowUserRolesSection` wired in page; `getTeamMemberRolesHelperText` used for team grid |
| 4 | Silent return on `!canSaveCarrierInfo` | **Closed** — error message via `CARRIER_SAVE_FORBIDDEN_MESSAGE` |
| 5 | Dead `validateBootstrapCarrierSaveRoles` message | **Closed** — reworded to invariant-break copy |
| 6 | Missing `shouldBootstrapOrganization` direct test | **Closed** — unit test added |
| 7 | `buildCarrierOnlyApiSavePayload` asymmetric bootstrap | **Closed** — inject roles for all `!organization_id` profiles |
| 8 | Edit/Collapse not disabled during save | **Closed** |
| 9 | Inline `editingTarget.kind !== 'self'` vs helper | **Closed** — uses `showUserRolesSection` |
| 10 | Bootstrap `orgMatch` misleading | **Closed** — `null` on first bootstrap save |
| 11 | Mount effect undocumented | **Closed** — comment added |
| 12 | Primary owner supplementary self-roles | **Accepted tradeoff** — roster Edit path; documented in review |

---

## Summary

| Severity | Open |
|----------|------|
| bug | 0 |
| suggestion | 0 |
| nit | 0 |