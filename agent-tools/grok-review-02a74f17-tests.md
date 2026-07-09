# Test Coverage Review: Forced Carrier Owner — Carrier Save

**Scope:** `agent-tools/grok-impl-summary-02a74f17.md`  
**Implementation:** `lib/forced-carrier-owner.ts`, `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`  
**Tests reviewed:** `lib/forced-carrier-owner.test.ts`, `lib/team-member-profiles-api.test.ts`, `lib/member-profile.test.ts`, `app/profile/profile-ui.test.ts`  
**Date:** 2026-07-07

---

## Test Run (verified)

```bash
npx vitest run lib/forced-carrier-owner.test.ts lib/team-member-profiles-api.test.ts lib/member-profile.test.ts app/profile/profile-ui.test.ts
```

**Result:** **148/148 passing**

| File | Tests | Forced-owner-specific |
|------|-------|------------------------|
| `lib/forced-carrier-owner.test.ts` | 4 | 4 (dedicated suite) |
| `lib/team-member-profiles-api.test.ts` | 17 | 2 (1 runtime + 1 source-inspection block) |
| `lib/member-profile.test.ts` | 92 | 0 (no `actorEmail` / forced-email cases) |
| `app/profile/profile-ui.test.ts` | 35 | 0 runtime; ~6 source-regex assertions |

---

## Requirement Path Coverage Matrix

| Requirement path | Unit (pure helpers) | Mocked API integration | UI / E2E |
|------------------|---------------------|------------------------|----------|
| **No org bootstrap** — assign `organization_id`, `is_primary_owner: true`, create org tables | ✅ `prepareMemberProfileSave` + `buildCarrierOnlyApiSavePayload` in `forced-carrier-owner.test.ts` | ❌ `saveTeamMemberProfileForUser` always uses profile with `org-1`; `ensureOrganizationBootstrap` never asserted | ❌ source inspection only |
| **Existing org rename** — preserve `organization_id`, promote `is_primary_owner`, update `company_name` | ✅ `forced-carrier-owner.test.ts` | ⚠️ upsert payload asserted; org-table rename via `ensureOrganizationBootstrap` not asserted | ❌ source inspection only |
| **Viewer bypass** — `carrier_only` succeeds despite `Viewer` role / `canWriteTeamData` false | ✅ `canSaveCarrierInfo`, `canActorSaveCarrierOnlyScope`, `validateBootstrapCarrierSaveRoles` in `forced-carrier-owner.test.ts` | ❌ viewer rejection test does not cover forced-owner exception | ⚠️ regex on `handleSaveCarrierInfo`; no render/interaction test |

**Verdict:** Core payload logic is unit-tested in the dedicated suite. End-to-end server and UI paths rely heavily on source inspection; two of three requirement paths lack mocked integration coverage.

---

## What Is Well Covered

| Area | Evidence |
|------|----------|
| Email allowlist normalization | `isForcedCarrierOwner` — exact, case-insensitive, trim, false for other/undefined |
| Permission helper bypass | `canSaveCarrierInfo`, `canActorSaveCarrierOnlyScope`, `validateBootstrapCarrierSaveRoles` return allow for forced email |
| Payload promotion (existing org) | `prepareMemberProfileSave` sets `is_primary_owner: true`, preserves `organization_id`, merges `Owner / Admin` roles |
| Payload bootstrap (no org) | UUID `organization_id` generated; `buildCarrierOnlyApiSavePayload` aligns with `prepareMemberProfileSave` |
| API happy path (driver → owner rename) | `saveTeamMemberProfileForUser` mocked test: upsert called with `is_primary_owner: true`, updated `company_name` |
| Client handler wiring (static) | `profile-ui.test.ts` asserts `!forcedCarrierOwner &&` guards on `canWriteTeamData` and `roleCheck.ok` |
| Server branch wiring (static) | `team-member-profiles-api.test.ts` regex asserts `forcedCarrierOwner` branch before `validateBootstrapCarrierSaveRoles` |
| Non-forced regression guard | `member-profile.test.ts` still tests standard bootstrap/rename paths without forced email (92 tests) |

---

## Open Issues

### 1. Viewer bypass not exercised on server save path

| Field | Value |
|-------|-------|
| **Severity** | bug |
| **Status** | open |
| **Requirement** | Save always succeeds for logged-in forced owner (viewer bypass) |
| **Gap** | `team-member-profiles-api.test.ts` has `rejects viewer self-save before upsert` for `member_only`, but no complementary test for forced email + `Viewer` role + `saveScope: 'carrier_only'`. |
| **Risk** | Removing or inverting `!(forcedCarrierOwner && saveScope === 'carrier_only')` in `saveTeamMemberProfileForUser` would not fail CI; production would block Andre on a Viewer-profile row. |
| **Suggested test** | Mock `getUser` with `FORCED_CARRIER_OWNER_EMAIL`, profile `user_roles: ['Viewer']`, `saveScope: 'carrier_only'` → expect upsert called, no `Forbidden – viewer` throw. |

---

### 2. No-org bootstrap not exercised through `saveTeamMemberProfileForUser`

| Field | Value |
|-------|-------|
| **Severity** | bug |
| **Status** | open |
| **Requirement** | Create organization if missing |
| **Gap** | Bootstrap is tested only via pure `prepareMemberProfileSave` / `buildCarrierOnlyApiSavePayload`. The single forced-owner API test uses a profile that already has `organization_id: 'org-1'`. |
| **Risk** | Regressions in `selfSaveFormForActor(..., 'carrier_only')`, the `forcedCarrierOwner` server branch, or post-upsert bootstrap would not be caught. Distinct code path: `saveScope === 'carrier_only' && forcedCarrierOwner` skips `validateBootstrapCarrierSaveRoles` entirely (differs from generic bootstrap). |
| **Suggested test** | Mock profile without `organization_id` (or `maybeSingle` → null), forced email, `carrier_only` → assert upsert payload has new UUID `organization_id`, `is_primary_owner: true`. |

---

### 3. `ensureOrganizationBootstrap` side effects never asserted

| Field | Value |
|-------|-------|
| **Severity** | bug |
| **Status** | open |
| **Requirement** | Create/update `organizations` + `organization_memberships` after carrier save |
| **Gap** | No test in any file asserts `supabase.from('organizations').upsert` or `organization_memberships` upsert. `mockFrom` returns a no-op upsert for non-`member_profiles` tables but nothing inspects call args. |
| **Risk** | Org row and primary membership creation/sync (including org `name` from `company_name` on rename) can regress with all 148 tests still green. |
| **Suggested test** | Extend forced-owner API test: after upsert, assert `mockFrom` called with `'organizations'` and `'organization_memberships'`, payload `name` matches `company_name`, `is_primary_owner: true` on membership. |

---

### 4. `member-profile.test.ts` omits all forced-owner `actorEmail` paths

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Status** | open |
| **Requirement** | Helpers used by both client and server must honor forced email |
| **Gap** | 92 tests in `member-profile.test.ts`; zero pass `actorEmail` or `FORCED_CARRIER_OWNER_EMAIL`. Notably untested there: |
| | • `shouldBootstrapOrganization(..., forcedEmail)` when profile lacks org but roles are only `Driver` |
| | • `shouldShowCarrierInformationCard(..., actorEmail: forcedEmail)` when `isPrimaryOwnerAccount` and `isProfileBootstrap` are false |
| | • `buildCarrierOnlyApiSavePayload(form, existing, forcedEmail)` role injection for org-linked non-owner profile |
| **Risk** | Forced-owner logic is siloed in `forced-carrier-owner.test.ts`; refactors to `member-profile.ts` signatures could drop `actorEmail` threading without breaking the general 92-test suite. |
| **Suggested test** | Add a `describe('forced carrier owner helpers')` block in `member-profile.test.ts` or expand `forced-carrier-owner.test.ts` to cover `shouldBootstrapOrganization` and `shouldShowCarrierInformationCard`. |

---

### 5. `shouldShowCarrierInformationCard` forced-owner UI gate not source-inspected

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Status** | open |
| **Requirement** | UI always shows carrier card for forced owner |
| **Gap** | `page.tsx` passes `primaryOwner \|\| forcedCarrierOwner` and `isProfileBootstrap \|\| forcedCarrierOwner` plus `actorEmail` into `shouldShowCarrierInformationCard`. `profile-ui.test.ts` never asserts `showCarrierCard`, `forcedCarrierOwner`, or `shouldShowCarrierInformationCard(..., actorEmail)`. |
| **Risk** | Removing `forcedCarrierOwner` from the `showCarrierCard` call site would not fail profile-ui tests (only save-handler regex tests would remain). |
| **Suggested test** | Source slice: `const showCarrierCard = shouldShowCarrierInformationCard` block contains `forcedCarrierOwner` and `actorEmail`. |

---

### 6. Bootstrap skip for forced owner verified by regex, not runtime

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Status** | open |
| **Requirement** | Remove bootstrap checks for forced user (server) |
| **Gap** | `describe('saveTeamMemberProfileForUser bootstrap gate')` uses `readFileSync` + regex on `team-member-profiles-api.ts`. No test proves that a forced owner with `user_roles: ['Driver']`, no org, and no `Owner / Admin` in form still succeeds through the API. |
| **Risk** | Source-inspection tests break on harmless refactors (rename, reorder) without catching logic bugs. A mistaken merge that runs `validateBootstrapCarrierSaveRoles` for forced owners would only fail if someone also edits the regex. |
| **Suggested test** | Runtime mocked test: forced email, null/`organization_id`-less profile, form with only `Driver` role → save succeeds (contrasts with non-forced rejection). |

---

### 7. Source-inspection UI tests do not verify runtime behavior

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Status** | open |
| **Requirement** | Client bypasses viewer/bootstrap failures for forced owner |
| **Gap** | `profile-ui.test.ts` documents and accepts static inspection (no RTL). Forced-owner coverage is limited to regex on `handleSaveCarrierInfo` and mount `useEffect`. No test confirms carrier card visibility, save button enabled state, or successful POST for forced email. |
| **Risk** | Accepted project limitation, but forced-owner is a privileged bypass — runtime gaps are higher impact than generic layout tests. |
| **Suggested test** | Future RTL harness: render with `user.email = FORCED_CARRIER_OWNER_EMAIL`, `ownProfile.user_roles = ['Viewer']`, assert Save Carrier Info enabled and handler not early-returning. |

---

### 8. Negative control: non-forced driver still blocked (API) — covered; forced viewer member_only — untested

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **Status** | open |
| **Requirement** | Bypass applies only to `carrier_only` (not all save scopes) |
| **Gap** | No test confirms forced owner with `Viewer` role is still rejected for `member_only` / `full` saves. Implementation uses `forcedCarrierOwner && saveScope === 'carrier_only'` — scope narrowing is implicit. |
| **Risk** | Low; over-permissive change would be a security issue but unlikely given existing viewer test pattern. |
| **Suggested test** | Forced email + Viewer profile + `member_only` → still throws viewer forbidden. |

---

### 9. Email edge cases: empty string not tested

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **Status** | open |
| **Requirement** | Case-insensitive allowlist match |
| **Gap** | `isForcedCarrierOwner` tests cover exact, variant case, `undefined`, and other email. `''` and `null` not asserted (implementation: `actorEmail?.trim()` → `''` !== allowlist, so likely safe). |
| **Risk** | Minimal. |
| **Suggested test** | `expect(isForcedCarrierOwner('')).toBe(false)` and `expect(isForcedCarrierOwner(null)).toBe(false)`. |

---

### 10. Implementation summary overstates test completeness

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **Status** | open |
| **Requirement** | Accurate test-gap tracking |
| **Gap** | `grok-impl-summary-02a74f17.md` states "Gaps found: None" while server org bootstrap, viewer bypass, and `ensureOrganizationBootstrap` lack runtime tests. |
| **Risk** | Reviewers may skip manual smoke steps believing CI fully covers the three requirement paths. |
| **Suggested action** | Update summary test-gap section to reference this review. |

---

## Source-Inspection vs Runtime Gap Summary

| Layer | Runtime tests | Source-inspection only |
|-------|---------------|------------------------|
| `lib/forced-carrier-owner.test.ts` | ✅ 4 pure unit tests | — |
| `lib/member-profile.test.ts` | ✅ 92 general tests | Forced `actorEmail` paths untested |
| `lib/team-member-profiles-api.test.ts` | 1 forced-owner upsert test; viewer/driver rejection tests | Bootstrap gate block (2 tests) — `readFileSync` regex |
| `app/profile/profile-ui.test.ts` | 0 | Forced-owner guards in `handleSaveCarrierInfo`, mount effect, API source cross-checks |

**Pattern:** Permission helpers and payload builders have solid unit coverage. **Server orchestration** (viewer exception, org table sync, no-org bootstrap branch) and **UI visibility** rely on static string matching or manual verification.

---

## Summary by Severity

| Severity | Open |
|----------|------|
| bug | 3 |
| suggestion | 4 |
| nit | 3 |
| **Total open** | **10** |

---

## Verdict

**Do not treat 148/148 as full requirement-path coverage.** The dedicated `forced-carrier-owner.test.ts` suite validates the pure-function contract well, and one mocked API test covers the existing-org rename upsert. Critical gaps remain:

1. **Viewer bypass** — not proven on `saveTeamMemberProfileForUser`.
2. **No-org bootstrap** — not proven through the API layer.
3. **`ensureOrganizationBootstrap`** — org/membership upserts never asserted.

Recommended manual smoke (until integration tests added):

1. Log in as `andrehampton1@outlook.com` with a `Viewer`-role profile row → Save Carrier Info succeeds.
2. Same account with no `organization_id` → first carrier save creates org; `organizations.name` matches `company_name`.
3. Subsequent rename → `organizations.name` updates after save (dev console `[carrier-save]` logs optional).

---

## Files Referenced

| Path | Role in review |
|------|----------------|
| `lib/forced-carrier-owner.test.ts` | Primary forced-owner unit coverage |
| `lib/team-member-profiles-api.test.ts` | Partial API mock + source inspection |
| `lib/member-profile.test.ts` | General carrier tests; no forced email |
| `app/profile/profile-ui.test.ts` | Source-only UI wiring |
| `lib/team-member-profiles-api.ts` | `ensureOrganizationBootstrap`, viewer gate, forced branch |
| `lib/member-profile.ts` | `prepareMemberProfileSave`, `shouldBootstrapOrganization`, `shouldShowCarrierInformationCard` |
| `app/profile/page.tsx` | Client bypass guards, `showCarrierCard` composition |