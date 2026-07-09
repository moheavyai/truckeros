# Code Review: User Roles Section Visibility Fix

**Scope:** `lib/member-profile.ts`, `app/profile/page.tsx`, `lib/member-profile.test.ts`, `app/profile/profile-ui.test.ts`  
**Reference:** `agent-tools/grok-impl-summary-1a378925.md`

---

## Summary

The refactor correctly extracts `UserRolesCheckboxGrid`, removes duplicate self-editing roles from the member edit card, and places a dedicated **User Roles** section between the carrier card and member edit card. Team-member editing still shows roles only inside the member edit card.

The follow-up fix addresses the original landing-view gap without hiding the section: roles stay visible on landing but render **read-only** from `ownProfile.user_roles` when there is no Save Profile path. Bootstrap and active self-edit flows remain editable. Helper text, carrier onboarding copy, and tests were updated accordingly.

**All prior findings are resolved.**

---

## What Works Well

| Area | Assessment |
|------|------------|
| **DRY extraction** | `UserRolesCheckboxGrid` centralizes checkbox rendering, disabled state, and helper text for both self and team-member flows. |
| **Duplicate removal** | `editingTarget.kind !== 'self'` guard in the member edit card prevents self roles from appearing twice. |
| **Placement** | Dedicated section sits after carrier card and before member edit card / team roster, matching the implementation goal. |
| **Landing safety** | `isUserRolesReadOnlyOnProfile` gates editability: read-only on landing without member edit card; editable during bootstrap, active self edit, or when member edit card is shown. |
| **Permissions reuse** | Shared `canEditRoles`, `canWriteProfile`, `toggleRole`, and `disabled` wiring is consistent across both call sites, with `isUserRolesReadOnly` layered for self flow. |
| **Helper text** | `getUserRolesSectionHelperText` covers landing read-only, managed-by-owner, bootstrap, and Save Profile hint when an org exists. |
| **Team-member path** | `shouldShowUserRolesSection` returns `false` for `member_profile` / `team_member_profile` targets. |
| **Onboarding copy** | Carrier bootstrap amber text references *"User Roles section below"*, aligning with section order. |
| **Tests** | Unit tests for visibility, read-only gating, helper text, and `profile-ui.test.ts` slice assertions document placement, wiring, and landing read-only behavior. |

---

## Findings (Resolved)

### 1 — Landing view: editable roles without save path
- **Severity:** bug
- **File:line:** `lib/member-profile.ts:270-283`, `app/profile/page.tsx:1114-1121`, `app/profile/page.tsx:1310-1320`
- **Description:** On landing (`shouldShowLandingProfileView`), primary owners could toggle roles into `form` with no Save Profile button.
- **Resolution:** Added `isUserRolesReadOnlyOnProfile`. Landing shows `ownProfile.user_roles` with checkboxes disabled; `canEditRoles && !isUserRolesReadOnly` and `disabled` include read-only state. Helper text: *"Your assigned roles."*
- **Status:** fixed

### 2 — Unused `shouldShowUserRolesSection` parameters
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:266-268`, `app/profile/page.tsx:1113`
- **Description:** `_isProfileBootstrap` and `_ownProfile` were accepted but ignored.
- **Resolution:** Signature simplified to `(editingTarget)` only. Bootstrap/owner context moved to `isUserRolesReadOnlyOnProfile` and `getUserRolesSectionHelperText`.
- **Status:** fixed

### 3 — Bootstrap copy vs section order
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:1225-1229`
- **Description:** Carrier card copy implied roles were above carrier fields while User Roles renders below.
- **Resolution:** Amber copy updated to *"Choose Owner / Admin in the User Roles section below, then add carrier details here…"*
- **Status:** fixed

### 4 — Tests missing landing-view regression coverage
- **Severity:** nit
- **File:line:** `lib/member-profile.test.ts:340-427`, `app/profile/profile-ui.test.ts:215-230`
- **Description:** Tests did not assert landing read-only vs bootstrap/active-edit behavior.
- **Resolution:** Added `isUserRolesReadOnlyOnProfile` and `getUserRolesSectionHelperText` suites; `profile-ui` asserts `isUserRolesReadOnly`, `displayUserRoles`, and helper-text wiring.
- **Status:** fixed

### 5 — No save affordance on dedicated User Roles section
- **Severity:** nit
- **File:line:** `lib/member-profile.ts:300-301`, `app/profile/page.tsx:1122-1127`
- **Description:** Persistence still depends on Save Profile in the member edit card; problematic when roles were editable on landing.
- **Resolution:** Landing is read-only (finding 1). When org exists and roles are editable, helper text appends *"Role changes save with Save Profile."*
- **Status:** fixed

---

## Issue Counts

| Severity | Open |
|----------|------|
| **bug** | 0 |
| **suggestion** | 0 |
| **nit** | 0 |
| **Total** | **0** |

---

## Verdict

**Approve.** The refactor meets the core goal: User Roles is prominent for own-profile flows, team-member roles stay in the member edit card, and the landing-view regression is closed via read-only display rather than hiding the section. Bootstrap onboarding copy and tests align with the implementation.

**Verified test command:**

```
npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts
```

**Result:** 113 tests passed (35 `profile-ui`, 78 `member-profile`).