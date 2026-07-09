# Code Review: Profile Page UX (Carrier Mode) — General Pass 3 (Re-review)

**Scope:** `app/profile/page.tsx`, `lib/member-profile.ts`, `app/profile/profile-ui.test.ts`, `lib/member-profile.test.ts`  
**Reference:** `agent-tools/grok-review-3c36845c.md` (round 1 merged review)  
**Focus:** Re-verify round 1 fixes; report only remaining open issues

---

## Verification Summary

All **23 round 1 issues** marked fixed in `grok-review-3c36845c.md` were re-checked against current code. Critical bugs (carrier-only save, org carrier sourcing, read-only team carrier block, collapse/reset, separate carrier form, edit race guards, viewer/role enforcement, stale refresh fallback, dirty prompts, loading state, security guards, and expanded tests) are **resolved**.

**70 tests pass** (`profile-ui.test.ts` 19, `member-profile.test.ts` 37, `member-profile-permissions.test.ts` 14).

---

## Open Issues

### 1
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:693,503-505`
- **Description:** On first visit `ownProfile` is null, so `isPrimaryOwner(ownProfile)` is false and `shouldShowCarrierInformationCard` hides the Carrier Information card. A new user who selects **Owner / Admin** cannot enter carrier data in the UI until after the first **Save Profile** bootstraps `is_primary_owner`. Carrier fields are not collected on the initial onboarding save (card is hidden; `excludeCarrier` is false but inputs are unavailable).
- **Suggestion:** Show carrier fields when `user_roles` includes **Owner / Admin** even before bootstrap, or add helper text on first visit explaining that carrier info unlocks after the first profile save.
- **Status:** open

### 2
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:592-601`
- **Description:** After saving any team member, `handleSave` always resets to self (`setEditingTarget({ kind: 'self' })`, reloads owner form). Success message references the edited member, but the form immediately shows the owner's profile. This may surprise users in a dropdown-driven workflow.
- **Suggestion:** Optionally keep `editingTarget` on the saved member and refresh `form` from the API response, or re-select the saved member in the dropdown after save.
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:86,680-687,828-833`
- **Description:** A single `saving` boolean drives both **Save Carrier Info** and the bottom save button. While one operation runs, both buttons show "Saving..." and are disabled.
- **Suggestion:** Use separate `savingCarrier` and `savingProfile` flags so each button reflects only its own in-flight action.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:427-431,583-585`
- **Description:** `profileFromSaveResponse` only recognizes `MemberProfile` rows (`'user_id' in row`). Roster / `team_member_profile` saves do not parse the API response; the UI relies solely on `loadTeamData` afterward. If list refresh fails, the form may not reflect the saved roster entry.
- **Suggestion:** Extend response parsing for `team_member_profile` rows and optimistically update `teamRosterRows` / `form` before `loadTeamData`.
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:57-66`, `lib/member-profile.ts:11-35`
- **Description:** Carrier field metadata is defined in `lib/member-profile.ts` (`CARRIER_FIELD_KEYS`, `CARRIER_SUMMARY_LABELS`) but duplicated in `page.tsx` as `CARRIER_FIELDS` with labels and placeholders.
- **Suggestion:** Export a shared `CARRIER_FIELD_CONFIG` from `lib/member-profile.ts` and derive UI field lists from it.
- **Status:** open

### 6
- **Severity:** suggestion
- **File:line:** `lib/member-profile-permissions.ts:96,113`, `app/profile/page.tsx:1192`
- **Description:** Team Roster **Company** column displays per-member `company_name` from each row. After carrier stripping on member/roster saves, non-owner rows typically have empty `company_name` even when org carrier exists on the primary owner's profile. Column often shows `—` despite saved org carrier data.
- **Suggestion:** Populate `company_name` in list items from the primary owner's profile (or org record) for non-owner entries, or rename column to clarify it reflects stored row data.
- **Status:** open

### 7
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:427-484`
- **Description:** `profileFromSaveResponse` and `refreshOwnProfileAfterSave` remain inline in the page component. Tests verify string presence but not runtime behavior (valid response parsing, Supabase error throw, missing row handling).
- **Suggestion:** Extract into a testable module with unit tests using mocked Supabase responses.
- **Status:** open

### 8
- **Severity:** suggestion
- **File:line:** `app/profile/profile-ui.test.ts` (entire file)
- **Description:** UI tests remain source-text assertions. They cannot catch runtime state bugs (e.g. stale edit race edge cases, collapse-with-unsaved-carrier interaction, failed refresh after roster save).
- **Suggestion:** Add component-level or integration tests for key user flows.
- **Status:** open

### 9
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:84`
- **Description:** `user` state is typed as `any`, weakening type safety for `user.id`, `user.email`, and props passed to `AppHeader`.
- **Suggestion:** Type as Supabase `User` or a narrow `{ id: string; email?: string }` interface.
- **Status:** open

### 10
- **Severity:** nit
- **File:line:** `lib/member-profile.test.ts:237-242`
- **Description:** `formatCarrierNameSummary` trims padded names (`'  Acme  '` → `'Acme'`), but tests cover non-empty, whitespace-only, and null—not padded valid names.
- **Suggestion:** Add `expect(formatCarrierNameSummary({ company_name: '  Acme Hauling  ' })).toBe('Acme Hauling')`.
- **Status:** open

### 11
- **Severity:** nit
- **File:line:** `app/profile/profile-ui.test.ts:232-239`
- **Description:** Carrier expansion reset test covers `resetToSelfForm`, `handleEditMember`, and `handleSave`, but not `handleSaveCarrierInfo` (which calls `setCarrierFormExpanded(false)` after successful carrier save).
- **Suggestion:** Add `expect(source).toMatch(/handleSaveCarrierInfo[\s\S]*setCarrierFormExpanded\(false\)/)`.
- **Status:** open

### 12
- **Severity:** nit
- **File:line:** `app/profile/profile-ui.test.ts:193`
- **Description:** `expect(source).not.toMatch(/flex justify-end gap-3[\s\S]*Save Carrier Info/)` remains ineffective (carrier button precedes main footer in file order). Placement is now correctly guarded by `carrierCardSlice`, but this assertion is dead weight.
- **Suggestion:** Remove the redundant negative regex; rely on `carrierCardSlice` assertions only.
- **Status:** open

---

## Summary by Severity

| Severity | Count |
|----------|-------|
| bug | 0 |
| suggestion | 8 |
| nit | 4 |
| **Total open** | **12** |

---

## Notes

- No open **bugs** remain from round 1 or this re-review.
- Remaining items are UX polish, test-depth improvements, and maintainability nits.
- No code changes were made in this review pass.