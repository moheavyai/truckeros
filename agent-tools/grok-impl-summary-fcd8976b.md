# Carrier Information Save Fix — Implementation Summary

## Problem
Carrier Information save on the Profile page could fail or behave incorrectly due to:
- Missing explicit `organization_id` in client carrier save payloads
- Server rejecting bootstrap `carrier_only` saves when no profile row existed yet
- Save button and carrier inputs disabled by `canWriteProfile` / global `isSaving` during unrelated saves

## Changes

### 1. `lib/member-profile.ts`
- Added **`buildCarrierOnlyApiSavePayload(form, existing)`** — wraps `buildCarrierOnlySavePayload` and explicitly sets `organization_id` from `existing.organization_id` when present.
- Bootstrap (no profile) omits `organization_id`; `prepareMemberProfileSave` still generates one when Owner/Admin is selected.

### 2. `lib/team-member-profiles-api.ts`
- **Fixed bootstrap permission**: `carrier_only` is now allowed when `actorProfile` is null (first visit). Only blocked when an existing non–primary-owner profile attempts carrier save.
- **Server debug logging** (`[carrier-save]` prefix):
  - Before upsert: `actorOrgId`, `payloadOrgId`, `company_name`, `save_scope`
  - After upsert: `savedOrgId`, `company_name`
- `ensureOrganizationBootstrap` unchanged — still upserts org `name` from saved profile `company_name` after every self-save.

### 3. `app/profile/page.tsx`
- **`handleSaveCarrierInfo`**:
  - Snapshots form before await: `const formSnapshot = { ...form }`
  - Uses `buildCarrierOnlyApiSavePayload(formSnapshot, ownProfile)`
  - Client `[carrier-save]` logs before/after API (keys, `organization_id`, `company_name`, `save_scope`, response)
- **Button**: `disabled={savingCarrier}` only (not `isSaving`)
- **Carrier inputs**: `disabled={savingCarrier}` only (not `!canWriteProfile || isSaving`)
- **`showSaveCarrierInfoButton`**: removed `canWriteProfile` gate; shown for primary owner or bootstrap when carrier form is visible

### 4. Tests
Added/updated tests in:
- `lib/member-profile.test.ts` — org preservation, company_name flow, `buildCarrierOnlyApiSavePayload`
- `lib/team-member-profiles-api.test.ts` — integration-style carrier payload + bootstrap org generation
- `lib/profile-persistence.test.ts` — carrier save payload with org id on rename
- `app/profile/profile-ui.test.ts` — `savingCarrier`-only disables, logging, form snapshot, no `canWriteProfile` on save button guard

**All 108 tests pass** across the four suites.

## How to verify manually
1. Open Profile as primary owner with existing org.
2. Edit company name in Carrier Information → Save Carrier Info.
3. Filter console for `[carrier-save]` — confirm `organization_id` is present in client payload and matches server `savedOrgId`.
4. Confirm org name updates in organizations table (via `ensureOrganizationBootstrap`).

## Bootstrap flow
1. First visit (no profile): select Owner/Admin, fill carrier fields, Save Carrier Info.
2. Server allows `carrier_only` with null actor profile.
3. `prepareMemberProfileSave` generates `organization_id` + `is_primary_owner`.
4. `ensureOrganizationBootstrap` creates org + membership.

---

## Review fix pass (grok-review-fcd8976b — all 7 issues)

| # | Fix |
|---|-----|
| 1 | `validateBootstrapCarrierSaveRoles` — blocks bootstrap save without Owner/Admin with clear error; carrier card stays visible |
| 2 | `shouldShowMemberEditCard(..., ownProfile)` — shows member edit card when `shouldShowBootstrapProfilePrompt` is true after carrier save |
| 3 | Form snapshot moved to first line of `handleSaveCarrierInfo` (before any await/state) |
| 4 | `carrierSaveInFlight = savingCarrier \|\| savingProfile` — disables carrier inputs/button during profile save |
| 5 | `logCarrierSaveDebug` / `logCarrierSaveWarn` — dev-only (`NODE_ENV === 'development'`) |
| 6 | `canActorSaveCarrierOnlyScope` exported + unit tests (null allowed, non-primary-owner blocked) |
| 7 | `CarrierOnlyApiSavePayload` type — fixes TS access to `organization_id` in client logs |

**115 tests pass** across the four profile suites after review fixes.

---

## Review fix pass 2 (grok-review-fcd8976b — all 9 issues)

| # | Fix |
|---|-----|
| 1 | Server-side `validateBootstrapCarrierSaveRoles` in `saveTeamMemberProfileForUser` before `carrier_only` upsert when `actorProfile` is null |
| 2 | Same gate throws `roleCheck.message` — defense-in-depth mirror of client bootstrap validation |
| 3 | `buildCarrierOnlyApiSavePayload` resolves `organization_id` via `prepareMemberProfileSave` when existing org is known |
| 4 | Client `after` log adds `payloadOrgId`, `savedOrgId`, and `orgMatch` for cross-check |
| 5 | `formSnapshot` deep-clones `user_roles: [...form.user_roles]` |
| 6 | `roleCheck.ok === false` discriminated-union narrowing fixes TS2339 on `roleCheck.message` |
| 7 | JSDoc on `buildCarrierOnlyApiSavePayload` documents body `organization_id` is logging-only |
| 8 | `profile-ui.test.ts` + `team-member-profiles-api.test.ts` assert bootstrap role strings and server gate wiring |
| 9 | Comment in `isFieldDisabled` documents intentional global `isSaving` asymmetry vs carrier card |

**117 tests pass** across the four profile suites (`member-profile` 62, `team-member-profiles-api` 12, `profile-persistence` 11, `profile-ui` 32).