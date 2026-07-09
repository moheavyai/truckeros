# Code Review: Carrier Information Save Bootstrap Fix — General Pass 3

**Scope:** `prepareMemberProfileSave` bootstrap path, subsequent `company_name` update, and the client/server carrier-save pipeline  
**Reference:** `agent-tools/grok-impl-summary-5bcd107e.md`  
**Files:** `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`, related tests, `supabase/migrations/020_member_profiles_privileged_columns.sql`

---

## Verification Summary

| Focus area | Status | Evidence |
|------------|--------|----------|
| **First-save bootstrap (`prepareMemberProfileSave`)** | **Fixed** | Null `existing` + Owner/Admin in form → `shouldBootstrapOrganization` → generated `organization_id` + `is_primary_owner: true` (`lib/member-profile.ts:503–531`). Covered by `prepareMemberProfileSave` tests (first Owner/Admin save, partial profile without org). |
| **Second-save `company_name` rename** | **Fixed** | `buildCarrierOnlySavePayload` merges form carrier fields; `memberProfileToUpsertPayload` → `profileFieldsToPayload` trims `company_name`; existing-org branch preserves `organization_id` and primary flag (`lib/member-profile.ts:113–126`, `512–525`). Tests: `flows company_name changes…`, `profile-persistence.test.ts`, `team-member-profiles-api.test.ts` integration. |
| **UI gates (bootstrap + rename)** | **Fixed** | `canSaveCarrierInfo` replaces `isPrimaryOwner`-only guard in `handleSaveCarrierInfo` (`page.tsx:766`). `shouldShowCarrierInformationCard` shows card when form has Owner/Admin (`member-profile.ts:241–250`). `canManageCarrier` drives edit/save buttons (`page.tsx:1060–1092`). |
| **Server permission for pending Owner/Admin** | **Fixed** | `canActorSaveCarrierOnlyScope` allows Owner/Admin in DB profile before primary flag (`team-member-profiles-api.ts:127–131`). Test: `allows Owner / Admin role holders…before primary owner flag is set`. |
| **Tests** | **Passing** | **125/125** across `member-profile.test.ts` (67), `team-member-profiles-api.test.ts` (15), `profile-persistence.test.ts` (11), `profile-ui.test.ts` (32). |

---

## End-to-End Flow (Bootstrap → Rename)

### 1. First visit — bootstrap carrier save

```
User selects Owner/Admin in member card
  → shouldShowCarrierInformationCard(..., form) = true
  → handleSaveCarrierInfo
      → validateBootstrapCarrierSaveRoles(form, null) — requires Owner/Admin
      → buildCarrierOnlyApiSavePayload — omits client organization_id
  → saveTeamMemberProfileForUser (actorProfile = null)
      → canActorSaveCarrierOnlyScope(null) = true
      → selfSaveFormForActor → buildCarrierOnlySavePayload — includes form user_roles
      → prepareMemberProfileSave — generates organization_id + is_primary_owner
      → upsert INSERT (allowed by migration 020 bootstrap rule)
      → ensureOrganizationBootstrap — creates organizations row with name = company_name
```

### 2. Second visit — primary owner renames `company_name`

```
ownProfile has organization_id + is_primary_owner
  → canSaveCarrierInfo = true
  → buildCarrierOnlySavePayload — company_name from form, roles from DB snapshot
  → prepareMemberProfileSave — preserves organization_id, is_primary_owner unchanged
  → upsert UPDATE — migration 023 allows primary-owner carrier field writes
  → ensureOrganizationBootstrap — upserts organizations.name from saved company_name
  → mergeCarrierFieldsOntoProfile + setFormState — UI reflects rename
```

### 3. `company_name` payload path (shared)

| Layer | Function | `company_name` source |
|-------|----------|----------------------|
| Client merge | `buildCarrierOnlySavePayload` | Form carrier fields |
| Client API body | `buildCarrierOnlyApiSavePayload` | Same (delegates to above) |
| Server scope | `selfSaveFormForActor` → `applySelfSaveScope('carrier_only')` | Same merge |
| Upsert prep | `prepareMemberProfileSave` → `memberProfileToUpsertPayload` | `trimOrNull(form.company_name)` |
| Org sync | `ensureOrganizationBootstrap` | `profile.company_name` post-upsert |

---

## Open Issues

### 1
- **Severity:** bug
- **File:line:** `lib/member-profile.ts:520–524`, `supabase/migrations/020_member_profiles_privileged_columns.sql:60–61`
- **Description:** `prepareMemberProfileSave` promotes `is_primary_owner` to `true` when an existing profile has `organization_id` and the form (or existing row) includes Owner/Admin. The DB trigger `enforce_member_profile_privileged_columns` **raises on any self-service `is_primary_owner` change** during UPDATE. The unit test `sets is_primary_owner when existing profile has org but flag was false…` validates payload shape only; a real upsert for this edge case would fail at the database.
- **Suggestion:** Either (a) remove the promotion branch and document that primary ownership is set only on INSERT bootstrap, (b) add a migration exception for false→true promotion when `organization_id` is already set and actor has Owner/Admin, or (c) route promotion through a service-role/admin path. Align tests with the chosen DB contract.
- **Status:** open

### 2
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:160–167`, `lib/team-member-profiles-api.ts:127–131`
- **Description:** `canSaveCarrierInfo` returns `true` for any profile with `organization_id`, but `canActorSaveCarrierOnlyScope` requires `is_primary_owner` or Owner/Admin in the **DB** `actorProfile.user_roles`. A non–primary-owner Driver with `organization_id` passes the UI permission helper but would be rejected server-side. Mitigated today because `shouldShowCarrierInformationCard` hides the card for plain Drivers, but `canManageCarrier` semantics over-promise relative to the server gate.
- **Suggestion:** Narrow `canSaveCarrierInfo` to mirror `canActorSaveCarrierOnlyScope` (check DB roles, not only `organization_id`), or add a shared `canActorManageCarrier(profile, form)` used by both client handler and server.
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `lib/team-member-profiles-api.ts:199–200`, `lib/team-member-profiles-api.ts:205–209`
- **Description:** `validateBootstrapCarrierSaveRoles` runs only when `actorProfile` is null. An actor with an existing row (no `organization_id`, Driver in DB) who selects Owner/Admin in the form and saves carrier hits `canActorSaveCarrierOnlyScope` first and receives `Forbidden – only primary owners can save carrier-only updates` instead of the guided bootstrap message. Misleading for the “Save Profile first as Driver, then try carrier bootstrap” ordering.
- **Suggestion:** Run `validateBootstrapCarrierSaveRoles` whenever `saveScope === 'carrier_only'` and bootstrap is still possible (`!actorProfile?.organization_id`), before the `canActorSaveCarrierOnlyScope` check; or extend `canActorSaveCarrierOnlyScope` to accept Owner/Admin from `formForSave` when org is not yet assigned.
- **Status:** open

### 4
- **Severity:** nit
- **File:line:** `lib/team-member-profiles-api.ts:200`
- **Description:** Error string still says `only primary owners` after `canActorSaveCarrierOnlyScope` was expanded to include Owner/Admin role holders.
- **Suggestion:** Update to `Forbidden – only primary owners or Owner / Admin accounts can save carrier-only updates`.
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `lib/team-member-profiles-api.ts:50–82`, `lib/team-member-profiles-api.test.ts`
- **Description:** No test asserts that `ensureOrganizationBootstrap` syncs `organizations.name` when `company_name` changes on a subsequent carrier save. `prepareMemberProfileSave` and upsert payload tests cover the member_profiles row; org-table rename is unverified.
- **Suggestion:** Add a mocked Supabase test for `saveTeamMemberProfileForUser` carrier_only success path verifying `organizations` upsert receives the renamed `company_name`.
- **Status:** open

### 6
- **Severity:** suggestion
- **File:line:** `lib/team-member-profiles-api.test.ts:161–235`
- **Description:** `saveTeamMemberProfileForUser` has rejection tests (viewer, non-primary driver) but no mocked success test for bootstrap INSERT or primary-owner `company_name` UPDATE. Permission and payload regressions in the async orchestration layer are only indirectly covered via extracted helpers.
- **Suggestion:** Add success-path mocks: (1) `actorProfile = null`, Owner/Admin form → upsert called with generated org; (2) primary owner existing org → upsert called with renamed `company_name` and unchanged `organization_id`.
- **Status:** open

### 7
- **Severity:** nit
- **File:line:** `app/profile/profile-ui.test.ts:414–415`
- **Description:** UI tests assert `canSaveCarrierInfo` in the handler but do not assert `canManageCarrier` wiring for `showEditCarrierButton` / `showSaveCarrierInfoButton`, or `shouldShowCarrierInformationCard(..., form)` for Owner/Admin-before-save visibility (covered in `member-profile.test.ts` only).
- **Suggestion:** Add `expect(source).toContain('canManageCarrier')` and `expect(source).toMatch(/shouldShowCarrierInformationCard\([\s\S]*form/)`.
- **Status:** open

---

## Summary by Severity

| Severity | Count |
|----------|-------|
| bug | 1 |
| suggestion | 4 |
| nit | 2 |
| **Total open** | **7** |

---

## Focus-Area Verdict

| Area | Verdict |
|------|---------|
| **`prepareMemberProfileSave` bootstrap** | **Resolved for the primary onboarding path** (null profile → INSERT with new org + primary owner). Owner/Admin-in-form with an **existing non-org row** or **is_primary_owner promotion on UPDATE** remains fragile at the server/DB layer. |
| **Subsequent `company_name` update** | **Resolved** for established primary owners with `organization_id`. Payload merge, org preservation, UI refresh, and unit/integration tests align. Org-table name sync relies on `ensureOrganizationBootstrap` without direct test coverage. |
| **Client/server consistency** | **Mostly resolved** for the documented happy path. Residual gaps: `canSaveCarrierInfo` vs `canActorSaveCarrierOnlyScope`, bootstrap role validation scope, and DB-immutable `is_primary_owner` vs application promotion logic. |

**No open bugs block the documented happy path** (first carrier save with null profile + Owner/Admin, then primary-owner `company_name` rename). One bug affects the **org-without-primary-flag promotion** edge case described in the impl summary; remaining items are consistency, messaging, and test-depth improvements.

---

## Notes

- Manual verification: after second save, confirm `[carrier-save] client after.savedCompanyName` matches the edited value and `orgMatch: true` when `organization_id` was already established.
- Prior pass items from `grok-review-fcd8976b-general-3.md` (dev-gated logging, `orgMatch` in client after log, `carrierSaveInFlight` disable) appear **addressed** in current `page.tsx` / `member-profile.ts`.