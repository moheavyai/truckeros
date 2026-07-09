# Test Coverage Re-Review: Forced Carrier Owner — Fix Round 1

**Scope:** `agent-tools/grok-impl-summary-02a74f17.md`  
**Prior review:** `agent-tools/grok-review-02a74f17-tests.md`  
**Implementation:** `lib/forced-carrier-owner.ts`, `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`  
**Tests reviewed:** `lib/forced-carrier-owner.test.ts`, `lib/team-member-profiles-api.test.ts`, `lib/member-profile.test.ts`, `app/profile/profile-ui.test.ts`  
**Date:** 2026-07-07

---

## Test Run (verified)

```bash
npx vitest run lib/forced-carrier-owner.test.ts lib/team-member-profiles-api.test.ts lib/member-profile.test.ts app/profile/profile-ui.test.ts
```

**Result:** **150/150 passing** (was 148/148 before fix round 1)

| File | Tests | Δ | Forced-owner-specific |
|------|-------|---|------------------------|
| `lib/forced-carrier-owner.test.ts` | 4 | — | 4 (pure helpers + supabase mock for import safety) |
| `lib/team-member-profiles-api.test.ts` | 19 | **+2** | 4 runtime + 1 source-inspection block |
| `lib/member-profile.test.ts` | 92 | — | 0 |
| `app/profile/profile-ui.test.ts` | 35 | — | ~8 source-regex assertions |

---

## Fix Round 1 — Verification Matrix

| Target | Verdict | Evidence |
|--------|---------|----------|
| **Admin upsert path** | ✅ **Covered** | `allows forced carrier owner to update company name via carrier_only save` asserts `mockAdminUpsert` called once, `mockUpsert` not called; upsert payload has `is_primary_owner: true`, promoted `user_roles`. Bootstrap-gate source block regex-matches `saveScope === 'carrier_only' && forcedCarrierOwner && hasAdminAccess && supabaseAdmin`. |
| **Viewer bypass (server)** | ✅ **Covered** | New test `allows forced carrier owner Viewer to save carrier_only via admin upsert`: profile `user_roles: ['Viewer']`, `is_primary_owner: false`, `saveScope: 'carrier_only'` → no `Forbidden – viewer` throw; `mockAdminUpsert` called. Unit helpers still covered in `forced-carrier-owner.test.ts`. |
| **Null profile bootstrap (API)** | ⚠️ **Partially covered** | New test `bootstraps organization for forced carrier owner with null actorProfile`: `maybeSingle` → `null`, forced email → save succeeds; payload has UUID `organization_id`, `is_primary_owner: true`, `company_name`; `mockOrgUpsert` called once. Does **not** assert `organizations` vs `organization_memberships` table calls or upsert payloads. |
| **showEditCarrierButton** | ✅ **Covered** | `profile-ui.test.ts` slices `showEditCarrierButton` guard; asserts `forcedCarrierOwner` present and `/(canWriteProfile \|\| forcedCarrierOwner)/`. Matches `page.tsx:1166-1171`. |

**Bottom line:** The four fix-round targets are addressed in CI. Admin upsert, viewer bypass, and edit-button guard have solid runtime or source proof. Null-profile bootstrap is proven through the API save path but org-table side effects remain weakly asserted.

---

## Resolved Since Prior Review (not listed below)

| Prior issue | Resolution |
|-------------|------------|
| #1 Viewer bypass not on server save path | Closed — runtime test at `team-member-profiles-api.test.ts:332-373` |
| #2 No-org bootstrap not through API | Closed — runtime test at `team-member-profiles-api.test.ts:375-416` |
| #6 Bootstrap skip only regex | Closed — null-profile runtime test proves forced owner with empty roles succeeds without `validateBootstrapCarrierSaveRoles` rejection |
| Admin upsert for existing-org rename | Closed — existing forced-owner test now asserts `mockAdminUpsert` path |
| `showEditCarrierButton` blocks Viewer forced owner | Closed — source assertion + implementation fix |
| `handleSave` forced-owner bypass | Closed — `profile-ui.test.ts:478-479` regex on `(!forcedCarrierOwner && !canWriteTeamData(ownProfile))` |

---

## Open Issues

### 1. `ensureOrganizationBootstrap` org/membership upserts not payload-asserted

| Field | Value |
|-------|-------|
| **Severity** | bug |
| **Status** | open |
| **Requirement** | After carrier save, create/update `organizations` + `organization_memberships` |
| **Gap** | Null-bootstrap API test only asserts `expect(supabaseMocks.mockOrgUpsert).toHaveBeenCalled()`. `mockFrom` routes **all** non-`member_profiles` tables to the same `mockOrgUpsert`; test does not assert `mockFrom` called with `'organizations'` and `'organization_memberships'`, nor `name` / `is_primary_owner` on membership payload. |
| **Risk** | Regressions in org name sync on rename or primary membership creation can pass 150/150. |
| **Suggested test** | Spy `mockFrom` calls; after forced-owner bootstrap save, expect both table names; assert org `name === company_name`, membership `is_primary_owner: true`. |

---

### 2. Admin upsert fallback (`hasAdminAccess === false`) has no runtime test

| Field | Value |
|-------|-------|
| **Severity** | bug |
| **Status** | open |
| **Requirement** | Graceful fallback to authed upsert when service role unavailable |
| **Gap** | API tests mock `hasAdminAccess: true` exclusively (`team-member-profiles-api.test.ts:48-52`). `forced-carrier-owner.test.ts` sets `hasAdminAccess: false` but only imports pure helpers — never calls `saveTeamMemberProfileForUser`. No test proves forced `carrier_only` uses `mockUpsert` (not `mockAdminUpsert`) when admin client is absent. |
| **Risk** | Misconfigured prod env (no `SUPABASE_SERVICE_ROLE_KEY`) reverts to authed path and may hit DB triggers (#2/#3 from general review); CI would not distinguish admin vs fallback behavior. |
| **Suggested test** | `vi.doMock('@/lib/supabase', { hasAdminAccess: false, supabaseAdmin: null })` + forced-owner `carrier_only` → `mockUpsert` called, `mockAdminUpsert` not called. |

---

### 3. Forced-owner Viewer API test omits promotion payload assertions

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Status** | open |
| **Requirement** | Viewer bypass promotes to primary owner with Owner / Admin roles |
| **Gap** | Viewer bypass test (`team-member-profiles-api.test.ts:332-373`) asserts admin upsert called and `result.data.company_name` only. Unlike the existing-org rename test, it does not inspect `upsertPayload.is_primary_owner` or `upsertPayload.user_roles`. |
| **Risk** | Promotion regression on Viewer path could slip if mock response masks payload bugs. |
| **Suggested test** | Add `expect(upsertPayload.is_primary_owner).toBe(true)` and role promotion assertion to viewer test. |

---

### 4. `member-profile.test.ts` still has zero forced-email cases

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Status** | open |
| **Requirement** | Shared helpers honor `actorEmail` threading |
| **Gap** | 92 tests; none pass `FORCED_CARRIER_OWNER_EMAIL`. Untested in this file: `shouldBootstrapOrganization`, `shouldShowCarrierInformationCard`, `buildCarrierOnlyApiSavePayload` with forced email. Logic is siloed in `forced-carrier-owner.test.ts`. |
| **Risk** | Refactors to `member-profile.ts` signatures could drop `actorEmail` without breaking the general suite. |
| **Suggested test** | Add `describe('forced carrier owner helpers')` block or cross-import cases from dedicated suite. |

---

### 5. `showCarrierCard` / `shouldShowCarrierInformationCard` forced-owner wiring not tested

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Status** | open |
| **Requirement** | UI always shows carrier card for forced owner |
| **Gap** | `page.tsx:1136-1141` passes `primaryOwner \|\| forcedCarrierOwner` and `isProfileBootstrap \|\| forcedCarrierOwner` into `shouldShowCarrierInformationCard`. `profile-ui.test.ts` has no assertion on `showCarrierCard`, `shouldShowCarrierInformationCard`, or those OR expressions. |
| **Risk** | Removing `forcedCarrierOwner` from card visibility call site would not fail profile-ui tests (edit-button guard is covered; card visibility is not). |
| **Suggested test** | Source slice: `const showCarrierCard = shouldShowCarrierInformationCard` block contains `forcedCarrierOwner` in both boolean args. |

---

### 6. Source-inspection UI tests still lack runtime behavior

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Status** | open |
| **Requirement** | Client bypasses viewer/bootstrap failures for forced owner |
| **Gap** | Forced-owner UI coverage remains regex-only: handler guards, `showEditCarrierButton`, `handleSave`. No RTL render confirms Edit Carrier Info visible for Viewer + forced email, or save button enabled state. |
| **Risk** | Accepted project pattern, but privileged bypass has higher manual-smoke dependency. |
| **Suggested test** | Future RTL: `user.email = FORCED_CARRIER_OWNER_EMAIL`, `ownProfile.user_roles = ['Viewer']` → Edit button rendered. |

---

### 7. Negative control: forced owner + Viewer + `member_only` still untested

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **Status** | open |
| **Requirement** | Bypass scoped to `carrier_only` only |
| **Gap** | No test confirms forced email with Viewer profile still throws for `member_only` / `full`. Implementation gates on `forcedCarrierOwner && saveScope === 'carrier_only'` (`team-member-profiles-api.ts:216`). |
| **Risk** | Low; over-permissive scope widening would be a security regression. |
| **Suggested test** | Forced email + Viewer profile + `saveScope: 'member_only'` → `Forbidden – viewer accounts cannot edit profiles`. |

---

### 8. Email edge cases: empty string and `null` not tested

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **Status** | open |
| **Requirement** | Allowlist match is case-insensitive and trim-safe |
| **Gap** | `isForcedCarrierOwner` tests cover exact, variant case, `undefined`, other email. `''` and `null` not asserted. |
| **Risk** | Minimal (`actorEmail?.trim()` → `''` !== allowlist). |
| **Suggested test** | `expect(isForcedCarrierOwner('')).toBe(false)`; `expect(isForcedCarrierOwner(null)).toBe(false)`. |

---

## Summary by Severity

| Severity | Open |
|----------|------|
| bug | 2 |
| suggestion | 4 |
| nit | 2 |
| **Total open** | **8** |

(Down from 10 open in prior review; 3 prior bugs closed, 1 new bug surfaced for admin fallback.)

---

## Verdict

**Fix round 1 materially improves requirement-path coverage.** The four explicit verification targets are met in CI:

1. **Admin upsert** — runtime + source inspection ✅  
2. **Viewer bypass** — server runtime test ✅  
3. **Null profile bootstrap** — API runtime test ⚠️ (org side effects weak)  
4. **showEditCarrierButton** — source inspection ✅  

**Do not treat 150/150 as exhaustive integration coverage.** Remaining gaps cluster around org-table bootstrap assertions, admin-client fallback behavior, and UI card visibility. Recommended manual smoke until issues #1–#2 are addressed:

1. Forced owner with Viewer role → Edit Carrier Info visible; Save Carrier Info succeeds.  
2. Forced owner with no profile row → first save creates org; `organizations.name` matches `company_name`.  
3. Env without service role key → confirm whether save still succeeds or fails at DB trigger (documents fallback risk).

---

## Files Referenced

| Path | Role |
|------|------|
| `lib/team-member-profiles-api.test.ts` | +2 runtime tests; admin mock; org upsert stub |
| `app/profile/profile-ui.test.ts` | `showEditCarrierButton` + `handleSave` forced-owner guards |
| `lib/forced-carrier-owner.test.ts` | Pure helper bypass + payload promotion |
| `lib/member-profile.test.ts` | General carrier tests; no forced email |
| `lib/team-member-profiles-api.ts` | Admin upsert branch, viewer gate, `ensureOrganizationBootstrap` |
| `app/profile/page.tsx` | `showEditCarrierButton`, `showCarrierCard` composition |