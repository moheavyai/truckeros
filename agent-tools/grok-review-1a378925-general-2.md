# User Roles Section — General Review Pass 2

**Scope:** `app/profile/page.tsx` (`UserRolesCheckboxGrid`, dedicated User Roles section), `lib/member-profile.ts` (`shouldShowUserRolesSection`, role merge in `buildCarrierOnlySavePayload`), `lib/team-member-profiles-api.ts` (`selfSaveFormForActor`, `canActorSaveCarrierOnlyScope`), `app/profile/profile-ui.test.ts`, `lib/member-profile.test.ts`  
**Reference:** `agent-tools/grok-impl-summary-1a378925.md`  
**Prior reviews (carrier + roles context):** `agent-tools/grok-review-5bcd107e-general-2.md`, `agent-tools/grok-review-fcd8976b-general-2.md`  
**Tests (impl summary):** `npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts` → **103/103 passing** (70 + 33)

---

## Verified Fixed / Implemented Since Prior Carrier-Mode Reviews

| Area | Status | Evidence |
|------|--------|----------|
| Dedicated User Roles section for own profile | **Implemented** | `shouldShowUserRolesSection` returns true for `editingTarget.kind === 'self'` (`lib/member-profile.ts:260–266`); section rendered at `page.tsx:1294–1306` |
| No duplicate self roles in member edit card | **Implemented** | Member card wraps roles in `editingTarget.kind !== 'self'` (`page.tsx:1467–1482`); test asserts no `>User Roles</h2>` in member card slice (`profile-ui.test.ts:184`) |
| Reusable checkbox grid | **Implemented** | `UserRolesCheckboxGrid` shared by dedicated section + team-member block (`page.tsx:120–161`, `1297–1304`, `1469–1480`) |
| Section placement (carrier → roles → member card) | **Implemented** | `carrierCardSlice` ends at `{showUserRolesSection && (`; `userRolesSectionSlice` ends at `{showMemberEditCard && (` (`profile-ui.test.ts:31–44`, `191–210`) |
| Bootstrap roles merged on carrier-only save | **Fixed (prior)** | `buildCarrierOnlySavePayload` merges `user_roles` when `!existing \|\| !existing.organization_id` (`lib/member-profile.ts:122–124`); deep-cloned in `handleSaveCarrierInfo` (`page.tsx:808`) |
| Bootstrap requires Owner / Admin before carrier save | **Fixed (prior)** | Client + server `validateBootstrapCarrierSaveRoles` (`page.tsx:813–817`, `team-member-profiles-api.ts:212–219`) |
| In-form Owner / Admin before persisted flag | **Fixed (prior)** | `canActorSaveCarrierOnlyScope(actorProfile, form)` accepts pending form roles (`team-member-profiles-api.ts:134–139`; test at `team-member-profiles-api.test.ts:157–170`) |
| Carrier card visible when Owner / Admin selected in form | **Fixed (prior)** | `shouldShowCarrierInformationCard(..., form)` (`lib/member-profile.ts:247–256`) |
| Member edit card after bootstrap carrier save | **Fixed (prior)** | `shouldShowMemberEditCard` + `shouldShowBootstrapProfilePrompt` (`lib/member-profile.ts:293–303`, `page.tsx:1485–1489`) |

### Intended flow after User Roles extraction

1. **First visit (bootstrap)** — Carrier card + dedicated User Roles section + member edit card visible; user selects Owner / Admin in User Roles, then saves carrier info (roles persist via `carrier_only`).
2. **Editing own profile** — User Roles always in dedicated section; member card holds driver fields only.
3. **Editing team members** — Dedicated section hidden; roles remain at bottom of member edit card.

---

## Open Issues

### 1
- **Severity:** bug
- **File:line:** `app/profile/page.tsx:1294–1304`, `app/profile/page.tsx:1474–1478`
- **Description:** The dedicated User Roles section always renders bootstrap copy — *"Select your roles. Choose Owner / Admin to set up your carrier organization."* — even when `canEditRoles` is `false` (non–primary-owner Drivers, Viewers). The team-member roles block correctly switches helper text based on `canEditRoles`; the self section does not. Locked users see instructions to self-assign Owner / Admin they cannot perform.
- **Suggestion:** Mirror the member-card pattern: `helperText={canEditRoles ? 'Select your roles…' : 'Roles are managed by your organization owner.'}` (or hide the section for non–role-editable self users if read-only display is unnecessary).
- **Status:** open

### 2
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:1209–1213`, `app/profile/page.tsx:1294–1306`
- **Description:** Bootstrap onboarding in the **Carrier Information** card tells users to *"Select Owner / Admin under roles, then add carrier details here"*, but the dedicated **User Roles** section is rendered **below** the carrier card. First-time users encounter carrier fields before the role checkboxes the copy references, reversing the stated order.
- **Suggestion:** Move the User Roles section above the carrier card during bootstrap (`isProfileBootstrap` or `!ownProfile`), or update carrier onboarding copy to *"Select Owner / Admin in the User Roles section below, then return here to add carrier details."*
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:1294–1304`, `lib/member-profile.ts:113–125`, `app/profile/page.tsx:806–878`
- **Description:** After an organization exists, role edits in the dedicated section are **not** persisted by **Save Carrier Info** (`buildCarrierOnlySavePayload` keeps DB roles when `existing.organization_id` is set). A primary owner can toggle roles, save carrier data, and `setFormState(memberProfileFromRow(profile))` silently reverts in-form role changes with no error or hint that **Save Profile** is required.
- **Suggestion:** Add helper text for established orgs (*"Role changes are saved with Save Profile below"*), disable role checkboxes while a carrier save is in flight if roles differ from baseline, or warn when `user_roles` differ from `ownProfile` at carrier-save time.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:259–266`, `app/profile/page.tsx:1111`
- **Description:** `shouldShowUserRolesSection(editingTarget, isProfileBootstrap, ownProfile)` accepts `isProfileBootstrap` and `ownProfile` but ignores both (`_isProfileBootstrap`, `_ownProfile`). Callers may assume bootstrap or ownership affects visibility; behavior is only `editingTarget.kind === 'self'`.
- **Suggestion:** Drop unused parameters, or use them (e.g. hide for Viewers, or show only when `canSelfEditRoles(ownProfile) \|\| isProfileBootstrap`).
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `app/profile/profile-ui.test.ts:191–210`
- **Description:** Tests assert dedicated section content and placement for own profile, but do not source-inspect that `{showUserRolesSection && (` is absent when `editingTarget.kind !== 'self'` (team-member edit / new-member flows). Regression could re-show self roles UI while editing another member's form state.
- **Suggestion:** Add test asserting `userRolesSectionSlice` is gated on `showUserRolesSection` and that member-card slice retains `editingTarget.kind !== 'self'` guard; optionally assert `shouldShowUserRolesSection` returns false for `member_profile` / `team_member_profile` in a cross-file import test.
- **Status:** open

### 6
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:120–161`
- **Description:** `UserRolesCheckboxGrid` renders role checkboxes without a `<fieldset>` / `legend` or `aria-labelledby` association to the section `<h2>`. Screen-reader users get helper paragraph + ungrouped checkboxes; the section heading is not programmatically tied to the control group.
- **Suggestion:** Wrap the grid in `<fieldset aria-labelledby="user-roles-heading">` with matching `id` on the `<h2>`, or use `role="group"` + `aria-label="User roles"`.
- **Status:** open

### 7
- **Severity:** bug
- **File:line:** `lib/member-profile.ts:160–174`, `app/profile/page.tsx:1104–1105,1136–1137`
- **Description:** *(Carryover from carrier reviews; affects roles + carrier bootstrap UX.)* `canSaveCarrierInfo` still returns `true` for any profile with `organization_id`, including non–primary-owner Drivers without Owner / Admin in persisted or form roles. UI may show carrier edit/save affordances that `canActorSaveCarrierOnlyScope` rejects server-side. Mitigated for plain Drivers by `shouldShowCarrierInformationCard`, but edge cases (org present, `is_primary_owner: false`, no Owner / Admin) can surface mismatched gates.
- **Suggestion:** Align `canSaveCarrierInfo` with `canActorSaveCarrierOnlyScope` semantics (primary owner, bootstrap, or Owner / Admin in persisted/form roles).
- **Status:** open

### 8
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:120–161`
- **Description:** `UserRolesCheckboxGrid` lives inline in `page.tsx` rather than a shared component file. Fine for a single consumer today, but duplicates presentation logic if roles UI is needed elsewhere (signup, admin).
- **Suggestion:** Extract to `components/UserRolesCheckboxGrid.tsx` if a second surface needs the same grid.
- **Status:** open

### 9
- **Severity:** nit
- **File:line:** `app/profile/profile-ui.test.ts:1–6`
- **Description:** User Roles behavior is validated via static source inspection only (accepted project pattern). Runtime cases — toggling roles then switching edit targets, discard prompts including `user_roles`, disabled state during carrier save — are not exercised in a render harness.
- **Suggestion:** When RTL is adopted, add interaction tests for bootstrap role → carrier save and role revert on carrier-only save with existing org.
- **Status:** open

---

## Summary

| Severity | Count |
|----------|-------|
| bug | 2 |
| suggestion | 5 |
| nit | 2 |
| **Total open** | **9** |

**Pass-2 verdict:** The User Roles extraction achieves its core goal — own-profile roles are prominent, deduplicated from the member edit card, and wired through the shared checkbox grid with correct team-member-only placement in the member card. Bootstrap role persistence and server gates from prior carrier work remain sound. Before treating the section production-complete, fix the misleading helper text for non–primary-owner self users (#1) and reconcile onboarding copy/order with the new layout (#2). Clarify how role edits persist after org creation (#3) to avoid silent data loss when users save carrier info without **Save Profile**.