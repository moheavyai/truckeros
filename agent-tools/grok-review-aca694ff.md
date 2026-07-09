# Review Issues — Round 1 (Merged)

### Issue 1 [General] — Severity: bug
- **File**: app/profile/page.tsx:1487-1492, lib/member-profile.ts:345-349
- **Description**: `showCarrierCard` passes `isProfileBootstrap || forcedCarrierOwner` to `shouldShowCarrierInformationCard`. Post-bootstrap `forcedCarrierOwner` stays true, third arg is always true, helper returns false before `isForcedCarrierOwner` runs — forced carrier owner never sees Carrier Information after bootstrap.
- **Suggestion**: Pass only `isProfileBootstrap` as third argument. Add unit test for forced owner + existing profile.
- **Status**: fixed
- **Response**: Changed `showCarrierCard` third argument from `isProfileBootstrap || forcedCarrierOwner` to `isProfileBootstrap` only. Added unit test in `lib/member-profile.test.ts` verifying forced owner with existing profile still sees carrier card via `actorEmail` path.

### Issue 2 [General] — Severity: bug
- **File**: app/profile/page.tsx:513-518
- **Description**: `useEffect` calls `setForm(ensureBootstrapOwnerRoles)` when `!ownProfile` but never syncs `formBaselineRef`. `isFormDirty()` is true before any user edit; `confirmDiscardIfDirty()` can spuriously fire during bootstrap.
- **Suggestion**: Use `setFormState(next, true)` or `syncFormBaseline` after implicit Owner injection.
- **Status**: fixed
- **Response**: Added `formRef` and changed bootstrap role `useEffect` to call `setFormState(ensureBootstrapOwnerRoles(formRef.current), true)` guarded by `loading`. Initial null-profile session load also calls `setFormState` with roles + email prefill so baseline stays in sync.

### Issue 3 [Security] — Severity: bug
- **File**: lib/team-member-profiles-api.ts:280-304, app/profile/page.tsx:1134-1140
- **Description**: `prepareBootstrapFormForSave` runs client-only. Server `ensureBootstrapOwnerRoles`/`validateBootstrapCarrierSaveRoles` only for `carrier_only`. Unified bootstrap uses `save_scope: 'full'` — API clients can submit arbitrary roles (e.g. Admin without Owner) on first save.
- **Suggestion**: Add server-side `normalizeBootstrapSelfRoles()` for bootstrap actors on all save scopes; clamp to Owner or Owner+Driver.
- **Status**: fixed
- **Response**: Added `normalizeBootstrapSelfRoles()` in `lib/member-profile.ts` and applied it server-side for all self-saves when `!actorProfile || !actorProfile.organization_id`, before `validateBootstrapCarrierSaveRoles`. Clamps roles to `['Owner']` or `['Owner','Driver']` and mirrors email.

### Issue 4 [General] — Severity: suggestion
- **File**: app/profile/page.tsx:1558-1562
- **Description**: Generic "Member Profile" page title/subtitle shown during bootstrap conflicts with welcoming unified card.
- **Suggestion**: Soften or hide header when `showOwnerBootstrapSetup` is true.
- **Status**: fixed
- **Response**: Wrapped page header in `{!showOwnerBootstrapSetup && (...)}` so only the welcome card shows during first-time setup.

### Issue 5 [General] — Severity: suggestion
- **File**: app/profile/page.tsx:1235-1237
- **Description**: Post-save scroll to Team Roster runs after bootstrap, hiding welcome success message.
- **Suggestion**: Skip scroll when `wasProfileBootstrap`.
- **Status**: fixed
- **Response**: Wrapped `teamSectionRef.scrollIntoView` in `if (!wasProfileBootstrap)` inside `handleSave`.

### Issue 6 [General] — Severity: suggestion
- **File**: app/profile/page.tsx:1610-1695, lib/team-member-profiles-api.ts:567-587
- **Description**: No required-field validation on Complete Setup; empty company/name can bootstrap org.
- **Suggestion**: Add client + server validation for company name, full name, and email on bootstrap saves.
- **Status**: fixed
- **Response**: Added `validateBootstrapSelfSave()` requiring company name, full name, and email. Called client-side in `handleSave` before save and server-side in `team-member-profiles-api.ts` for `save_scope: 'full'` bootstrap saves.

### Issue 7 [General] — Severity: suggestion
- **File**: app/profile/page.tsx:1097-1101
- **Description**: `handleSaveCarrierInfo` still shows stale two-step bootstrap copy.
- **Suggestion**: Update message for legacy partial-setup path only.
- **Status**: fixed
- **Response**: Updated legacy bootstrap carrier message to: "Carrier information saved. Finish setup from the profile completion prompt below."

### Issue 8 [General] — Severity: suggestion
- **File**: app/profile/page.tsx:1614-1621, lib/member-profile.ts:288-335
- **Description**: Welcome copy duplicated in subtitle helper and inline emerald banner.
- **Suggestion**: Consolidate into one welcoming message source.
- **Status**: fixed
- **Response**: Merged owner welcome text into `getOwnerBootstrapSetupCardSubtitle()` and removed the duplicate emerald banner from the bootstrap card JSX.

### Issue 9 [General-4] — Severity: suggestion
- **File**: app/profile/page.tsx:1134-1140
- **Description**: Bootstrap save omits `validateBootstrapCarrierSaveRoles` that carrier handler uses.
- **Suggestion**: Run validation in bootstrap branch before save.
- **Status**: fixed
- **Response**: Added `validateBootstrapCarrierSaveRoles` call in `handleSave` bootstrap branch after `validateBootstrapSelfSave`, before `setSavingProfile(true)`.

### Issue 10 [General-4] — Severity: suggestion
- **File**: app/profile/page.tsx:1164
- **Description**: `submitRestrictedFieldChangeRequests` uses raw `form` not `formForSave`.
- **Suggestion**: Pass `formForSave` for consistency.
- **Status**: fixed
- **Response**: Changed to `submitRestrictedFieldChangeRequests(accessToken, formForSave)`.

### Issue 11 [General-4] — Severity: suggestion
- **File**: app/profile/page.tsx:447-476
- **Description**: `driver_email` not prefilled from `session.user.email` on first visit.
- **Suggestion**: Prefill before `syncFormBaseline` on null-profile load.
- **Status**: fixed
- **Response**: On null-profile session load, prefill `driver_email` from `session.user.email`, apply `ensureBootstrapOwnerRoles`, and call `setFormState`.

### Issue 12 [General] — Severity: suggestion
- **File**: app/profile/page.tsx:1669-1685
- **Description**: Owner Operator adds Driver role but no hint about CDL fields for later.
- **Suggestion**: Add brief helper text under checkbox about adding CDL after setup.
- **Status**: fixed
- **Response**: Added `getOwnerBootstrapOwnerOperatorHint()` and show it under the checkbox when Owner Operator is selected.

### Issue 13 [Security] — Severity: suggestion
- **File**: lib/team-member-profiles-api.ts:567-589
- **Description**: No server-side max-length/format validation for bootstrap email/phone PII fields.
- **Suggestion**: Add shared validators before bootstrap upsert.
- **Status**: fixed
- **Response**: Added `validateBootstrapEmail`, `validateBootstrapOptionalPhone`, and max-length constants in `validateBootstrapSelfSave`, used server-side via the bootstrap validation path.

### Issue 14 [Tests] — Severity: suggestion
- **File**: lib/member-profile.test.ts
- **Description**: Missing tests: forced owner + existing profile carrier visibility, `prepareBootstrapFormForSave` with Owner+Driver, `applyOwnerOperatorRoles` from empty form, email trim, `getOwnerBootstrapSetupCardSubtitle`, bootstrap save_scope full contract.
- **Suggestion**: Add tests listed in tests review.
- **Status**: fixed
- **Response**: Added tests for forced owner carrier visibility, `normalizeBootstrapSelfRoles`, `applyOwnerOperatorRoles` from empty form, `validateBootstrapSelfSave` email trim, subtitle/CDL hint helpers.

### Issue 15 [Tests] — Severity: suggestion
- **File**: app/profile/profile-ui.test.ts
- **Description**: Bootstrap slice missing assertions for `BOOTSTRAP_CARRIER_FIELDS`, `checked={ownerOperatorSelected}`, `onSubmit={handleSave}`, `save_scope: 'full'`, forcedCarrierOwner call-site fix.
- **Suggestion**: Extend source-inspection tests per tests review.
- **Status**: fixed
- **Response**: Extended bootstrap UI tests with assertions for carrier fields slice, owner operator checkbox, handleSave submit, full save scope, forcedCarrierOwner call-site fix, hidden header, and validation helpers.

### Issue 16 [Tests] — Severity: suggestion
- **File**: lib/team-permissions.test.ts
- **Description**: No test for Owner+Driver permission merge via `resolveEffectivePermissions`.
- **Suggestion**: Add union assertion for `['Owner','Driver']`.
- **Status**: fixed
- **Response**: Added test verifying Owner+Driver merges to full write on equipment, profiles, permit_agent, portal_agent, and file_upload.

### Issue 17 [General] — Severity: nit
- **File**: app/profile/page.tsx:1633-1641
- **Description**: Bootstrap inputs use `disabled={isSaving}` instead of `isFieldDisabled` used elsewhere.
- **Suggestion**: Align disabled logic or document rationale.
- **Status**: fixed
- **Response**: Changed bootstrap contact and carrier inputs to `disabled={isFieldDisabled(key)}` for consistency with the rest of the profile form.

### Issue 18 [Security] — Severity: nit
- **File**: lib/member-profile.ts:314-322
- **Description**: Email mirror client-only; server should mirror for bootstrap when carrier_email blank.
- **Suggestion**: Mirror in server bootstrap normalization.
- **Status**: fixed
- **Response**: `normalizeBootstrapSelfRoles` calls `prepareBootstrapFormForSave` which mirrors `driver_email` to `carrier_email` when blank; `validateBootstrapSelfSave` also enforces this on trimmed values.

---

## Implementation Summary (Review Round 1 Fixes)

### Files Changed
| File | Changes |
|------|---------|
| `lib/member-profile.ts` | Added `normalizeBootstrapSelfRoles`, `validateBootstrapSelfSave`, email/phone validators, CDL hint helper; consolidated subtitle copy |
| `lib/team-member-profiles-api.ts` | Server bootstrap normalization + validation for all save scopes when no org |
| `app/profile/page.tsx` | Fixed carrier card visibility bug, form baseline sync, client validation, header hide, scroll skip, email prefill, consolidated copy, CDL hint, `isFieldDisabled` alignment |
| `lib/member-profile.test.ts` | +4 test cases for new helpers and forced-owner visibility |
| `app/profile/profile-ui.test.ts` | Updated/extended bootstrap source-inspection assertions |
| `lib/team-permissions.test.ts` | Added Owner+Driver permission merge test |
| `lib/team-member-profiles-api.test.ts` | Updated bootstrap full-save tests with required fields; updated source gate assertions |

### Key Fixes
1. **Bug #1**: Forced carrier owner can see Carrier Information card post-bootstrap (`isProfileBootstrap` only as third arg).
2. **Bug #2**: Bootstrap role injection syncs `formBaselineRef` via `setFormState`.
3. **Bug #3**: Server clamps bootstrap roles to Owner or Owner+Driver on all bootstrap save scopes.
4. **Validation**: Required company name, full name, email; optional phone max-length; email format check — client and server.
5. **UX**: Hidden generic header during bootstrap, no post-bootstrap scroll, consolidated welcome copy, CDL hint for Owner Operator, session email prefill.

### Test Results
```
npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts lib/team-permissions.test.ts lib/team-member-profiles-api.test.ts

 ✓ lib/team-permissions.test.ts (14 tests)
 ✓ app/profile/profile-ui.test.ts (36 tests)
 ✓ lib/member-profile.test.ts (106 tests)
 ✓ lib/team-member-profiles-api.test.ts (28 tests)

 Test Files  4 passed (4)
      Tests  184 passed (184)
```

---

## Review Issues — Round 2 (Merged)

### Issue 19 [General] — Severity: bug
- **File**: app/profile/page.tsx:1461-1468, 1617
- **Description**: During unified bootstrap, `editingLabel` resolves to "Your profile" (landing view is false while `isProfileBootstrap`), so the blue editing banner appears above the welcome card.
- **Suggestion**: Hide editing banner when `showOwnerBootstrapSetup` is true.
- **Status**: fixed
- **Response**: Moved `showOwnerBootstrapSetup` earlier and set `editingLabel` to `null` when `showOwnerBootstrapSetup` is true, suppressing the banner during first-time setup.

### Issue 20 [Security] — Severity: bug
- **File**: lib/team-member-profiles-api.ts:284-293
- **Description**: Bootstrap `carrier_only` path ran `normalizeBootstrapSelfRoles` but skipped `validateBootstrapSelfSave`; legacy carrier-only API calls could bootstrap org without company name or with invalid PII.
- **Suggestion**: Extend server bootstrap validation to `carrier_only` path or gate appropriately.
- **Status**: fixed
- **Response**: Added `validateBootstrapCarrierOnlySave()` (company required; optional email/phone format and max-length when present). Server applies it for bootstrap `carrier_only` saves when actor lacks `organization_id`.

### Issue 21 [General] — Severity: bug
- **File**: app/profile/page.tsx:523-529
- **Description**: Bootstrap role `useEffect` ran for `isForcedCarrierOwner` even when `ownProfile` exists, resetting form baseline and re-injecting Owner roles on every render for forced-owner accounts.
- **Suggestion**: Narrow bootstrap role useEffect to `!ownProfile` only.
- **Status**: fixed
- **Response**: Changed condition to `if (!ownProfile)` only; removed `isForcedCarrierOwner` from effect deps and body. Session load still handles initial bootstrap prefill.

### Issue 22 [General] — Severity: nit
- **File**: app/profile/page.tsx:1696
- **Description**: Owner Operator checkbox uses `disabled={isSaving}` while bootstrap inputs use `isFieldDisabled(key)` and role grid uses `isLoadingMember || isSaving`.
- **Suggestion**: Align Owner Operator checkbox disabled logic.
- **Status**: fixed
- **Response**: Changed checkbox to `disabled={isSaving || isLoadingMember}` matching the User Roles grid pattern.

### Issue 23 [General] — Severity: suggestion
- **File**: lib/member-profile.ts:430-432
- **Description**: CDL hint says "from Your Profile after setup" but post-bootstrap self-edit is via Team Roster **Edit** on own row.
- **Suggestion**: Fix CDL hint copy to reference Team Roster Edit.
- **Status**: fixed
- **Response**: Updated `getOwnerBootstrapOwnerOperatorHint()` to: "You can add CDL details later — use Edit on your row in Team Roster."

### Issue 24 [Tests] — Severity: suggestion
- **File**: app/profile/profile-ui.test.ts
- **Description**: No assertion that editing banner is suppressed during bootstrap.
- **Suggestion**: Assert `editingLabel` null when `showOwnerBootstrapSetup`.
- **Status**: fixed
- **Response**: Added source-inspection test matching `showOwnerBootstrapSetup` in `editingLabel` ternary.

### Issue 25 [Tests] — Severity: suggestion
- **File**: app/profile/profile-ui.test.ts
- **Description**: useEffect test still allowed forced-carrier-owner branch.
- **Suggestion**: Assert effect scoped to `!ownProfile` only.
- **Status**: fixed
- **Response**: Updated test to match `if (!ownProfile)` and assert `isForcedCarrierOwner` removed from effect.

### Issue 26 [Tests] — Severity: suggestion
- **File**: app/profile/profile-ui.test.ts
- **Description**: Owner Operator checkbox disabled prop not asserted.
- **Suggestion**: Assert `disabled={isSaving || isLoadingMember}`.
- **Status**: fixed
- **Response**: Added bootstrap slice assertion for aligned checkbox disabled logic.

### Issue 27 [Tests] — Severity: suggestion
- **File**: lib/member-profile.test.ts
- **Description**: CDL hint test still checked generic "CDL" not Team Roster path.
- **Suggestion**: Assert Team Roster reference in hint.
- **Status**: fixed
- **Response**: Updated hint test to expect `Team Roster` in copy.

### Issue 28 [Tests] — Severity: suggestion
- **File**: lib/member-profile.test.ts
- **Description**: No tests for `validateBootstrapCarrierOnlySave`.
- **Suggestion**: Add company-required and PII limit tests.
- **Status**: fixed
- **Response**: Added test covering company required, optional PII validation, and role clamp via `normalizeBootstrapSelfRoles`.

### Issue 29 [Tests] — Severity: suggestion
- **File**: lib/member-profile.test.ts
- **Description**: Missing explicit `validateBootstrapSelfSave` company-name rejection assertion.
- **Suggestion**: Assert message for empty company name.
- **Status**: fixed
- **Response**: Added `Company name is required.` assertion on empty form.

### Issue 30 [Tests] — Severity: suggestion
- **File**: lib/member-profile.test.ts
- **Description**: Missing `prepareBootstrapFormForSave` with Owner+Driver roles.
- **Suggestion**: Assert roles preserved through prep.
- **Status**: fixed
- **Response**: Extended prepareBootstrap test to verify `['Owner','Driver']` preserved.

### Issue 31 [Tests] — Severity: suggestion
- **File**: lib/member-profile.test.ts
- **Description**: Missing `validateBootstrapOptionalPhone` / `validateBootstrapOptionalEmail` max-length tests.
- **Suggestion**: Add boundary tests.
- **Status**: fixed
- **Response**: Added phone/email max-length boundary assertions in carrier_only validation test.

### Issue 32 [Tests] — Severity: suggestion
- **File**: lib/team-member-profiles-api.test.ts
- **Description**: No integration test rejecting bootstrap `carrier_only` without company name.
- **Suggestion**: Add async rejection test.
- **Status**: fixed
- **Response**: Added `rejects bootstrap carrier_only save without company name` integration test.

### Issue 33 [Tests] — Severity: suggestion
- **File**: lib/team-member-profiles-api.test.ts
- **Description**: No integration test verifying role clamp on bootstrap `carrier_only`.
- **Suggestion**: Assert upsert payload roles are `['Owner']` when form sends Admin.
- **Status**: fixed
- **Response**: Added `clamps bootstrap carrier_only roles to Owner on null actorProfile` integration test.

### Issue 34 [Tests] — Severity: suggestion
- **File**: lib/team-member-profiles-api.test.ts
- **Description**: Source gate test missing `validateBootstrapCarrierOnlySave` wiring.
- **Suggestion**: Assert carrier_only bootstrap validation in API source.
- **Status**: fixed
- **Response**: Extended bootstrap gate source-inspection for `validateBootstrapCarrierOnlySave`.

### Issue 35 [Tests] — Severity: suggestion
- **File**: app/profile/profile-ui.test.ts
- **Description**: Bootstrap persistence test missing `validateBootstrapCarrierOnlySave` import path.
- **Suggestion**: Assert API uses carrier-only validator for legacy path.
- **Status**: fixed
- **Response**: Added `validateBootstrapCarrierOnlySave` to bootstrap persistence source assertions.

---

## Implementation Summary (Review Round 2 Fixes)

### Files Changed
| File | Changes |
|------|---------|
| `lib/member-profile.ts` | Added `validateBootstrapOptionalEmail`, `validateBootstrapCarrierOnlySave`; updated CDL hint copy |
| `lib/team-member-profiles-api.ts` | Apply carrier-only bootstrap validation before role normalization |
| `app/profile/page.tsx` | Suppress editing banner during bootstrap; narrow role useEffect; align checkbox disabled |
| `lib/member-profile.test.ts` | +carrier_only validation tests, hint/PII boundary tests |
| `app/profile/profile-ui.test.ts` | Bootstrap banner, useEffect, checkbox assertions |
| `lib/team-member-profiles-api.test.ts` | +2 integration tests; source gate for carrier_only validation |

### Test Results
```
npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts lib/team-permissions.test.ts lib/team-member-profiles-api.test.ts

 ✓ lib/team-permissions.test.ts (14 tests)
 ✓ app/profile/profile-ui.test.ts (36 tests)
 ✓ lib/member-profile.test.ts (107 tests)
 ✓ lib/team-member-profiles-api.test.ts (30 tests)

 Test Files  4 passed (4)
      Tests  187 passed (187)
```