# User Roles Section — Implementation Summary

## Goal
Make **User Roles** always visible and prominent on the Profile page when editing your own profile (including first-visit bootstrap), while keeping roles in the member edit card only for team members.

## Changes

### `lib/member-profile.ts`
- Added `shouldShowUserRolesSection(editingTarget, isProfileBootstrap, ownProfile)`:
  - Returns `true` when `editingTarget.kind === 'self'` (own profile / bootstrap / first visit)
  - Returns `false` when editing team members (`member_profile`, `team_member_profile`)

### `app/profile/page.tsx`
- Extracted reusable `UserRolesCheckboxGrid` component with:
  - `USER_ROLE_OPTIONS` checkboxes (Owner / Admin, Driver, Permit Clerk, Viewer)
  - Shared `canEditRoles`, `canWriteProfile`, and `disabled` logic
- Added `showUserRolesSection` derived from `shouldShowUserRolesSection`
- Placed new **User Roles** `<section>` **after** the Carrier Information card and **before** the member edit card / Team Roster
- Helper text: *"Select your roles. Choose Owner / Admin to set up your carrier organization."*
- Wrapped member edit card roles in `editingTarget.kind !== 'self'` so self-editing no longer duplicates roles at the bottom of the profile card

### Tests
- **`lib/member-profile.test.ts`**: `shouldShowUserRolesSection` cases (self vs team member targets)
- **`app/profile/profile-ui.test.ts`**:
  - `userRolesSectionSlice` helper
  - Asserts dedicated User Roles section placement after carrier card
  - Asserts team-member-only roles in member edit card
  - Asserts bootstrap-friendly self roles helper text outside member edit card

## Test Results
```
npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts
✓ lib/member-profile.test.ts (70 tests)
✓ app/profile/profile-ui.test.ts (33 tests)
```

## UX Flow
1. **First visit (bootstrap)**: Carrier card + User Roles section visible; user selects Owner / Admin in User Roles, then saves carrier info
2. **Editing own profile**: User Roles always in dedicated section near top
3. **Editing team members**: Roles remain in member edit card only (no duplicate self section)

---

## Follow-up Fix (grok-review-1a378925 — all 7 issues)

### `lib/member-profile.ts`
- Added `isUserRolesReadOnlyOnProfile()` — read-only on landing when no Save Profile path; editable during bootstrap, active self edit, or when member edit card is shown
- Added `getUserRolesSectionHelperText()` with variants:
  - Landing read-only: *"Your assigned roles."*
  - `!canEditRoles`: *"Roles are managed by your organization owner."*
  - Bootstrap: *"Select your roles. Choose Owner / Admin to set up your carrier organization."*
  - Org exists: appends *"Role changes save with Save Profile."*
- Updated `validateBootstrapCarrierSaveRoles` error to reference *"User Roles section"*
- Simplified `shouldShowUserRolesSection(editingTarget)` — always visible for self

### `app/profile/page.tsx`
- Landing view shows roles read-only from `ownProfile.user_roles` (not form toggles)
- `canEditRoles && !isUserRolesReadOnly` and `disabled` includes `isUserRolesReadOnly`
- Carrier bootstrap amber copy: *"Choose Owner / Admin in the User Roles section below…"*

### Tests
- **`lib/member-profile.test.ts`**: +8 tests (`isUserRolesReadOnlyOnProfile`, `getUserRolesSectionHelperText`)
- **`app/profile/profile-ui.test.ts`**: +2 tests (landing read-only wiring, carrier copy)
- **`lib/team-member-profiles-api.test.ts`**: updated bootstrap role error message assertion

### Test Results
```
npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts
✓ app/profile/profile-ui.test.ts (35 tests)
✓ lib/member-profile.test.ts (78 tests)
```