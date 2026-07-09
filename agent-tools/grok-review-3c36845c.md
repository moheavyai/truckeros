# Merged Re-review (Round 4)

Security: 0 open.

## Review Issues

### Issue 1 [General] — Severity: bug
- **File**: app/profile/page.tsx:550-575, 641-658, 867
- **Description**: `handleSave` captures `priorTarget` but `buildSavePayloadForTarget()` uses live `editingTarget`/`form` after await. Cancel stays enabled during save — canceling mid-save can POST owner's profile instead of team member's.
- **Suggestion**: Snapshot payload from `priorTarget` + form before any await; disable Cancel when `isSaving`.
- **Status**: fixed
- **Response**: Refactored `buildSavePayloadForTarget` to accept explicit `target`, `formSnapshot`, and `profileSnapshot` parameters. `handleSave` now builds `savePayload` from `priorTarget` + current `form` before `setSavingProfile(true)` and any `await`. `saveViaApi` uses the frozen `savePayload` instead of calling `buildSavePayloadForTarget()` after session fetch. Cancel editing button now uses `disabled={isLoadingMember || isSaving}`.

### Issue 2 [Tests] — Severity: suggestion
- **File**: app/profile/profile-ui.test.ts
- **Description**: 11 remaining source-test depth gaps (save payload snapshot, cancel disabled during save, dropdown branches).
- **Suggestion**: Add assertions for snapshot-before-await pattern and `disabled` on cancel during save.
- **Status**: fixed
- **Response**: Added `snapshots save payload from prior target before any await in handleSave` test asserting parameterized `buildSavePayloadForTarget`, `savePayload` assignment before `setSavingProfile`/`getSession`, and `saveViaApi(accessToken, savePayload)` without post-await `buildSavePayloadForTarget()`. Added `disables cancel editing while save is in flight` test asserting `disabled={isLoadingMember || isSaving}` on Cancel editing button.

### Issue 3 [Tests] — Severity: nit
- **File**: lib/member-profile.test.ts, lib/profile-persistence.test.ts
- **Description**: 3 helper edge case tests still missing.
- **Suggestion**: Add remaining edge cases.
- **Status**: fixed
- **Response**: Added `shouldShowTeamSectionCarrierBlock` case for persisted roster `{ kind: 'team_member_profile', id: 'tm-1' }`. Added `shouldUseTeamMemberCarrierSummary` collapsed/expanded cases for persisted roster id. Added `resolveRefreshedOwnProfile` mismatch test when API `savedProfile.user_id` does not match session user and refreshed query is used.

---

## Implementation Summary (Round 4 fixes)

**Bug fix — save payload race with cancel during save**
- `buildSavePayloadForTarget(target, formSnapshot, profileSnapshot)` now snapshots editing context instead of reading live React state after async gaps.
- `handleSave` captures `savePayload = buildSavePayloadForTarget(priorTarget, form, ownProfile)` before any `await`, then posts that frozen payload.
- Cancel editing is disabled while `isSaving` to prevent mid-save target switches that could desync UI from the in-flight request.

**Tests added**
- `profile-ui.test.ts`: 2 new source assertions (payload snapshot before await; cancel disabled during save).
- `member-profile.test.ts`: persisted roster id edge cases for team-section carrier helpers.
- `profile-persistence.test.ts`: API row user_id mismatch fallback to refreshed query.

**Test run**: `node node_modules/vitest/vitest.mjs run app/profile/profile-ui.test.ts lib/member-profile.test.ts lib/member-profile-permissions.test.ts lib/profile-persistence.test.ts` — **90/90 passing** (profile-ui 25, member-profile 44, member-profile-permissions 15, profile-persistence 6).