# Code Review: Profile UX Landing View + Save New Member + Carrier Persistence — General Pass 3

**Scope:** `app/profile/page.tsx`, `lib/member-profile.ts`, `lib/profile-persistence.ts`, `lib/member-profile-permissions.ts`, `app/profile/profile-ui.test.ts`, related API/migration files  
**Reference:** `agent-tools/grok-impl-summary-126caeea.md`  
**Focus:** Re-verify landing UX, Save New Member flow, and carrier save persistence; report only remaining open issues

---

## Verification Summary

The implementation summary goals are largely met in code and tests:

| Area | Status |
|------|--------|
| **Landing view** | Carrier Information card + Team Roster; member edit card hidden when `shouldShowLandingProfileView` is true |
| **+ Add New Member** | Opens `New Team Member` edit card; top-right **Save New Member** submit; returns to landing after successful roster insert |
| **Carrier persistence** | `handleSaveCarrierInfo` uses `resolveRefreshedOwnProfile` + `mergeCarrierFieldsOntoProfile`; `carrier_only` scope on API |
| **Bootstrap** | Carrier card visible on first visit (`isProfileBootstrap`); roles included in `buildCarrierOnlySavePayload` when no existing row |
| **Concurrent saves** | `isSaving = isAnySaveInFlight(savingCarrier, savingProfile)` gates all save/navigation controls |
| **Member edit retention** | `restoreEditingTargetAfterSave` keeps context when editing existing roster/member rows (not new-member create) |

**Tests:** `111/111` passing (`profile-ui` 27, `member-profile` 54, `member-profile-permissions` 15, `profile-persistence` 8, `profile-field-permissions` 7).

**Typecheck note:** `tsc --noEmit` reports `app/profile/page.tsx(840): Cannot find name 'showLandingProfileView'` — confirms a live runtime defect not caught by source-inspection tests.

---

## Open Issues

### 1
- **Severity:** bug
- **File:line:** `app/profile/page.tsx:839-846`
- **Description:** `editingLabel` calls `showLandingProfileView(...)`, which is undefined. The helper is imported and used correctly as `shouldShowLandingProfileView` on line 850, but line 840 references a non-existent symbol. This throws `ReferenceError` on every post-load render when computing `editingLabel`, breaking the editing banner and potentially crashing the page whenever the component re-renders after auth load.
- **Suggestion:** Replace `showLandingProfileView` with `shouldShowLandingProfileView` (or reuse the `showLandingView` const computed on line 850).
- **Status:** open

### 2
- **Severity:** bug
- **File:line:** `app/profile/page.tsx:1209-1221`, `app/profile/page.tsx:732-736`, `app/profile/page.tsx:747-750`, `app/profile/page.tsx:820`, `app/profile/page.tsx:253-256`
- **Description:** `saveMessage` feedback is rendered only inside `{showMemberEditCard && (…)}`. Flows that intentionally return to landing hide the member edit card, so success/error text is never shown. Affected flows include: **Save New Member** (`'New team member saved.'`), self **Save Profile** when `editingMemberKey` resets to `null`, **Delete team member**, **Account link approve/reject**, and `handleEditMember` load failures after `resetToSelfForm()`. Users get no visible confirmation on the landing layout for these actions.
- **Suggestion:** Move `saveMessage` (and optionally a shared status region) outside the member edit card—e.g. below the page header or above Team Roster—so landing-return flows surface feedback. Mirror the pattern used by `carrierMessage` on the carrier card.
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:850-851`, `lib/member-profile.ts:188-204`
- **Description:** On landing, primary owners and drivers have no inline self-profile edit surface. They must click **Edit** on their own row in Team Roster to reach driver/contact fields. The landing page reads as “done” (carrier summary + roster only) with no cue that self-profile editing lives behind a table row action.
- **Suggestion:** Add a landing-visible entry point (e.g. “Edit your profile” button near the roster header or a compact self-summary row) that calls `handleEditMember` for the `is_self` row, or show a collapsed self-profile card on landing for non-bootstrap users.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:616-623`, `app/profile/page.tsx:747-750`, `app/profile/page.tsx:993-1002`
- **Description:** Primary owners can expand carrier fields, edit carrier values, then click **Save Profile** (member-only scope) instead of **Save Carrier Info**. Carrier deltas are stripped from the payload and the post-save form reset uses DB/API state—silently discarding unsaved carrier edits with no discard prompt. `confirmDiscardCarrierIfDirty` only runs on carrier collapse, not on profile save.
- **Suggestion:** Block **Save Profile** while `carrierFieldsDiffer(form, ownProfile)` is true (prompt to save or discard carrier first), or run `confirmDiscardCarrierIfDirty` inside `handleSave` when `editingTarget.kind === 'self'`.
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:676-720`, `lib/profile-persistence.ts:11-30`
- **Description:** `mergeCarrierFieldsOntoProfile` is applied only in `handleSaveCarrierInfo`. `handleSave` relies on `resolveRefreshedOwnProfile` preferring the full API row for self-saves, which is sufficient when `savedProfile` is returned. If the API response omits `savedProfile` (parse failure, partial error recovery), self-save falls back to a direct Supabase read without carrier-column overlay—reintroducing the stale-read revert risk for carrier columns.
- **Suggestion:** Apply `mergeCarrierFieldsOntoProfile(refreshed, savedOwnProfile)` in `handleSave` whenever `priorTarget.kind === 'self'` and `savedOwnProfile` is present, for defense in depth.
- **Status:** open

### 6
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:80-89`, `lib/member-profile.ts:11-35`
- **Description:** Carrier field metadata is defined in `lib/member-profile.ts` (`CARRIER_FIELD_KEYS`, `CARRIER_SUMMARY_LABELS`) but duplicated in `page.tsx` as `CARRIER_FIELDS` with labels and placeholders. Drift risk if keys or labels change in one place only.
- **Suggestion:** Export a shared `CARRIER_FIELD_CONFIG` from `lib/member-profile.ts` and derive both summary labels and form field config from it.
- **Status:** open

### 7
- **Severity:** suggestion
- **File:line:** `lib/member-profile-permissions.ts:96,113`, `app/profile/page.tsx:1315`
- **Description:** Team Roster **Company** column displays per-row `company_name`. Member and roster saves strip carrier fields (`buildMemberProfileSavePayloadWithoutCarrier`), so non-owner rows and roster-only entries typically show `—` even when org carrier data exists on the primary owner's profile.
- **Suggestion:** Populate `company_name` in `memberProfileToListItem` / `teamMemberProfileToListItem` from the primary owner's profile (or org record) when the row value is empty, or rename the column to clarify it reflects stored row data.
- **Status:** open

### 8
- **Severity:** suggestion
- **File:line:** `lib/migration-manifest.json`, `supabase/migrations/022_profile_change_requests.sql`
- **Description:** Migration `022_profile_change_requests.sql` exists but is not listed in `lib/migration-manifest.json`. Automated migrate scripts will skip it; driver restricted-field change requests will fail in environments that rely on the manifest.
- **Suggestion:** Add `022_profile_change_requests.sql` to the manifest (or document manual apply in deploy runbook).
- **Status:** open

### 9
- **Severity:** suggestion
- **File:line:** `app/api/profile-change-requests/route.ts`, `app/profile/page.tsx:462-491`
- **Description:** Driver restricted-field edits POST to `/api/profile-change-requests` and show a review suffix on save, but there is no in-app admin approve/reject UI. Primary owners can only GET pending requests via API.
- **Suggestion:** Add an admin review panel on the profile page (or dashboard) listing pending requests with approve/reject actions.
- **Status:** open

### 10
- **Severity:** suggestion
- **File:line:** `app/profile/profile-ui.test.ts` (entire file)
- **Description:** UI tests remain static source inspection. They verify helper wiring and string presence but do not execute the component. Issues **#1** (undefined symbol) and **#2** (feedback placement) are examples of defects the suite cannot catch.
- **Suggestion:** Add RTL or Playwright coverage for landing → add member → save → landing, carrier save persistence, and status message visibility.
- **Status:** open

### 11
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:107`
- **Description:** `user` state is typed as `any`, weakening type safety for `user.id` and `AppHeader` props.
- **Suggestion:** Type as Supabase `User` or a narrow `{ id: string; email?: string }` interface.
- **Status:** open

### 12
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:447-459`, `app/profile/page.tsx:920-936`
- **Description:** **+ Add New Member** sets `editingMemberKey` to `null`, so the blue editing banner shows “New Team Member” but no roster row is highlighted during create (unlike edit-existing flows where `editingMemberKey` matches a table row). Minor visual inconsistency only.
- **Suggestion:** Optionally set a synthetic key (e.g. `team_member_profile-new`) for banner/row highlight parity, or add distinct styling on the edit card header for create vs edit.
- **Status:** open

### 13
- **Severity:** nit
- **File:line:** `app/profile/profile-ui.test.ts:98-108`
- **Description:** Landing layout tests assert `shouldShowLandingProfileView` is imported but do not verify `editingLabel` uses the same helper (the line 840 typo would have been caught by `expect(source).not.toContain('showLandingProfileView')` or a positive assertion on `shouldShowLandingProfileView` for `editingLabel`).
- **Suggestion:** Add `expect(source).not.toContain('showLandingProfileView(')` and assert `editingLabel` ternary references `shouldShowLandingProfileView`.
- **Status:** open

---

## Resolved Since Prior Reviews (not reopened)

The following items from `grok-review-3c36845c-general-3.md` and `grok-review-3c36845c-general-2.md` are **verified fixed** in this pass:

- Bootstrap carrier card hidden before first save → fixed via `shouldShowCarrierInformationCard(..., isProfileBootstrap)`
- Single `saving` flag coupling both buttons → fixed via `savingCarrier` / `savingProfile` + `isSaving`
- Post-save always reset to self when editing team members → fixed via `restoreEditingTargetAfterSave` (except intentional new-member → landing)
- Roster API response not parsed → fixed via `savedRoster` in `saveViaApi`
- `profileFromSaveResponse` / refresh helpers inline in page → extracted to `lib/profile-persistence.ts` with unit tests
- Bootstrap carrier save dropping Owner / Admin role → fixed via `buildCarrierOnlySavePayload` including `user_roles` when `!existing`
- Carrier expansion reset on `handleSaveCarrierInfo` → covered in `profile-ui.test.ts`
- `formatCarrierNameSummary` padded-name test → present in `member-profile.test.ts:250`
- Dropdown-driven member selector → removed in favor of roster **Edit** actions

---

## Summary by Severity

| Severity | Count |
|----------|-------|
| bug | 2 |
| suggestion | 8 |
| nit | 3 |
| **Total open** | **13** |

---

## Notes

- **Carrier persistence** on the dedicated **Save Carrier Info** path is correctly implemented and tested (`mergeCarrierFieldsOntoProfile`, API-first refresh).
- **Save New Member** correctly creates via API, refreshes roster, and resets editing target to landing—but success feedback is swallowed by issue **#2**.
- **Landing UX** structure matches the design summary; issues **#1** and **#2** are regressions that undermine the simplified layout in production.
- No code changes were made in this review pass.