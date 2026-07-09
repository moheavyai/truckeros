# Code Review: User Roles Section + Bootstrap Placement — General Pass 3

**Scope:** `app/profile/page.tsx`, `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/profile-ui.test.ts`, `lib/member-profile.test.ts`  
**Reference:** `agent-tools/grok-impl-summary-1a378925.md`  
**Focus:** Re-verify dedicated User Roles placement, bootstrap carrier+roles flow, and landing-view interactions; report only remaining open issues

---

## Verification Summary

The implementation summary goals are met in code and tests:

| Area | Status |
|------|--------|
| **Dedicated User Roles section** | `shouldShowUserRolesSection` returns `true` for `editingTarget.kind === 'self'` (`lib/member-profile.ts:260–266`) |
| **Placement** | Carrier card → User Roles section → member edit card / Team Roster (`page.tsx:1200–1308`) |
| **No self-duplicate roles** | Member edit card wraps roles in `editingTarget.kind !== 'self'` (`page.tsx:1467–1482`) |
| **Shared checkbox grid** | `UserRolesCheckboxGrid` extracted with shared `canEditRoles` / `disabled` logic (`page.tsx:120–161`, `1294–1304`, `1469–1480`) |
| **Bootstrap role persistence** | `handleSaveCarrierInfo` snapshots `user_roles`; `buildCarrierOnlySavePayload` merges roles when `!existing \|\| !existing.organization_id` (`page.tsx:808`, `lib/member-profile.ts:122–124`) |
| **Bootstrap role validation** | Client + server `validateBootstrapCarrierSaveRoles` before carrier-only upsert when actor lacks `organization_id` |
| **Team-member roles** | Roles remain in member edit card only for non-self targets with team-specific helper text |

**Tests:** `119/119` passing (`profile-ui` 33, `member-profile` 70, `team-member-profiles-api` 16).

**Typecheck note:** `tsc --noEmit` reports no errors in profile files; pre-existing errors remain in unrelated routes/tests.

---

## End-to-End Bootstrap Flow (Roles Placement)

### 1. First visit — null profile

```
Page order (top → bottom):
  Carrier Information card (isProfileBootstrap banner)
  → User Roles section (Owner / Admin checkboxes)
  → Member edit card (driver fields + Save Profile)

User selects Owner / Admin in User Roles section
  → form.user_roles updated via toggleRole
User fills carrier fields in card above
  → handleSaveCarrierInfo
      → validateBootstrapCarrierSaveRoles(formSnapshot, null)
      → buildCarrierOnlyApiSavePayload — includes form user_roles
  → prepareMemberProfileSave — generates organization_id + is_primary_owner
  → success copy guides driver completion in member edit card
```

### 2. Partial profile — row exists, no `organization_id`

```
User selects Owner / Admin in User Roles section (visible while editing self)
  → shouldShowCarrierInformationCard(..., form) = true
  → canSaveCarrierInfo(ownProfile, form) = true (form has Owner / Admin)
  → canActorSaveCarrierOnlyScope(actorProfile, form) = true (no org + form roles)
  → buildCarrierOnlySavePayload merges form user_roles
  → org bootstrap succeeds without intermediate Save Profile
```

### 3. Established org — primary owner

```
User Roles section visible on landing and inline edit
  → buildCarrierOnlySavePayload preserves DB roles (form roles ignored)
  → role changes require Save Profile (member edit card) — see Open Issue #1
```

---

## Open Issues

### 1
- **Severity:** bug
- **File:line:** `app/profile/page.tsx:1294–1306`, `app/profile/page.tsx:1308–1327`, `lib/member-profile.ts:272–303`
- **Description:** On landing (`shouldShowLandingProfileView` true), primary owners see an **editable** User Roles section (`showUserRolesSection` true, `canEditRoles` true) but the member edit card—and its **Save Profile** button—is hidden. `buildCarrierOnlySavePayload` does not persist in-form role changes once `organization_id` exists (`lib/member-profile.ts:122–124`). Role-only edits made on landing are silently discarded unless the user clicks **Edit** on their roster row (no **Edit my profile** affordance for primary owners). The dedicated roles section implies inline persistence that the save model does not support.
- **Suggestion:** Either (a) hide or read-only the User Roles section on landing when `showMemberEditCard` is false, (b) add a **Save Roles** action in the User Roles section that posts `member_only` with role deltas, or (c) keep member edit card visible (collapsed) whenever `isFormDirty()` includes `user_roles` changes.
- **Status:** open

### 2
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:1200–1213`, `app/profile/page.tsx:1294–1306`
- **Description:** Visual order is **Carrier → User Roles**, but bootstrap copy instructs the opposite sequence: carrier banner says *"Select Owner / Admin under roles, then add carrier details here"* while the User Roles section sits **below** the carrier card. New users encounter carrier fields first with instructions to complete a step that appears later on the page.
- **Suggestion:** Reorder bootstrap layout to **User Roles → Carrier → Member edit card**, or rewrite both onboarding strings to match top-to-bottom flow (e.g. *"In User Roles below, select Owner / Admin, then return here to add carrier details"*).
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:176–186`, `app/profile/page.tsx:1211–1212`, `app/profile/page.tsx:1302`
- **Description:** Bootstrap messaging is split across three surfaces with overlapping intent: carrier amber banner (*"under roles"*), `validateBootstrapCarrierSaveRoles` error (*"under roles before saving carrier information"*), and User Roles helper (*"Choose Owner / Admin to set up your carrier organization"*). *"Under roles"* dates from when roles lived at the bottom of the member edit card; the dedicated section now uses an `<h2>User Roles</h2>` heading above the carrier card in the DOM.
- **Suggestion:** Centralize bootstrap copy in one place (prefer the User Roles section as canonical) and update error strings to reference *"the User Roles section"* instead of *"under roles"*.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:260–266`
- **Description:** `shouldShowUserRolesSection` accepts `isProfileBootstrap` and `ownProfile` but ignores both (`_isProfileBootstrap`, `_ownProfile`). Call site passes three arguments (`page.tsx:1111`) suggesting future gating (e.g. hide on landing, show only for bootstrap) that is not implemented. Unused parameters widen the API without behavior.
- **Suggestion:** Either use the parameters (e.g. always show for self except when editing via team-member target) or simplify the signature to `shouldShowUserRolesSection(editingTarget)` and update tests/callers.
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `app/profile/profile-ui.test.ts:191–210`
- **Description:** Placement tests assert Carrier → User Roles → member edit card ordering and self-vs-team-member role split, but do not assert landing-view behavior: editable roles without a visible save affordance (Open Issue #1) would not be caught. Tests remain static source inspection per accepted project limitation.
- **Suggestion:** Add `expect(source).toMatch(/showUserRolesSection[\s\S]*showMemberEditCard/)` landing guard assertions, or adopt RTL to verify primary-owner landing cannot persist role toggles.
- **Status:** open

### 6
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:1467–1482`
- **Description:** Team-member role block in the member edit card omits an `<h2>User Roles</h2>` heading (only a top border + `UserRolesCheckboxGrid`), while the self-service section has a prominent heading. Minor visual inconsistency when editing roster members.
- **Suggestion:** Add `<h2>User Roles</h2>` above the team-member grid for parity, or add a compact subheading inside `UserRolesCheckboxGrid` when no external heading is provided.
- **Status:** open

### 7
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:1294–1306`
- **Description:** User Roles section has no scoped success/error feedback. Bootstrap role validation errors surface on the carrier card (`setCarrierMessage`), which is visually separated from the role checkboxes a user may have just edited.
- **Suggestion:** Mirror `carrierMessage` with a `rolesMessage` region in the User Roles section, or hoist bootstrap validation errors to a shared onboarding status area between both sections.
- **Status:** open

---

## Resolved Since Prior Reviews (not reopened)

The following bootstrap and placement items from earlier general passes are **verified fixed** and are not reopened:

| Prior item | Resolution |
|------------|------------|
| Roles hidden at bottom of member card during bootstrap | Dedicated `User Roles` section always visible for self |
| Bootstrap carrier save dropping Owner / Admin role | `buildCarrierOnlySavePayload` merges `user_roles` when `!existing \|\| !organization_id` |
| Carrier save enabled before roles selected | `validateBootstrapCarrierSaveRoles` blocks client + server |
| Partial profile (no org) carrier bootstrap blocked | `canSaveCarrierInfo` + `canActorSaveCarrierOnlyScope` accept form Owner / Admin |
| `showLandingProfileView` undefined symbol | Uses `shouldShowLandingProfileView` (`profile-ui.test.ts:392–397`) |
| `saveMessage` hidden on landing-return flows | Global banner above member edit card (`profile-ui.test.ts:399–408`) |
| `is_primary_owner` false→true promotion on UPDATE | `prepareMemberProfileSave` only preserves existing primary flag (`member-profile.test.ts:257–275`) |
| Server bootstrap validation only when `actorProfile` null | Runs when `!actorProfile \|\| !actorProfile.organization_id` (`team-member-profiles-api.ts:212–219`) |
| Self roles duplicated in member edit card | Guarded by `editingTarget.kind !== 'self'` |

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
| **Roles placement (self vs team)** | **Resolved.** Dedicated section after carrier card; team-member roles isolated in member edit card; `UserRolesCheckboxGrid` shared. |
| **Bootstrap happy path (null profile)** | **Resolved.** Roles visible before carrier save; roles flow through carrier-only payload; org bootstrap + guided driver completion tested. |
| **Bootstrap edge path (partial profile, no org)** | **Resolved.** Form roles + server gates align; no intermediate Save Profile required. |
| **Landing + established primary owner** | **Open.** Editable roles without save path (Issue #1); onboarding copy vs DOM order (Issue #2). |

**No open bugs block the documented first-visit bootstrap path** (select Owner / Admin in User Roles → Save Carrier Info → Save Profile for driver details). One bug affects **primary owners on landing** who edit roles in the new dedicated section without opening the member edit card.

---

## Notes

- Manual verification: on first visit, confirm User Roles checkboxes sit below the carrier card, Owner / Admin selection enables carrier save, and post-save bootstrap prompt appears in the member edit card.
- Issue **#2** is UX-only for bootstrap; the data path is correct because `toggleRole` updates `form.user_roles` before `handleSaveCarrierInfo` regardless of visual order.
- Prior `canSaveCarrierInfo` vs `canActorSaveCarrierOnlyScope` divergence for org-linked Drivers remains mitigated by `shouldShowCarrierInformationCard` hiding the carrier surface; not reopened as a ship-risk for this change set.
- No code changes were made in this review pass.