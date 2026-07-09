# Code Review: Forced Carrier Owner — General Pass 3

**Scope:** `lib/forced-carrier-owner.ts`, `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`, related tests  
**Reference:** `agent-tools/grok-impl-summary-02a74f17.md`  
**Focus:** UX (carrier card visibility, mount effect), test coverage gaps, maintainability of email hardcode  
**Tests referenced:** 148/148 passing (`forced-carrier-owner` 4, `team-member-profiles-api` 17, `member-profile` 92, `profile-ui` 35)

---

## Verification Summary

Core save/promotion paths are implemented consistently across client, API, and persistence:

| Requirement | Status | Evidence |
|-------------|--------|----------|
| `is_primary_owner = true` on carrier save | ✅ | `prepareMemberProfileSave()` (`lib/member-profile.ts:649–665`) |
| Org bootstrap when missing | ✅ | `shouldBootstrapOrganization()` + `ensureOrganizationBootstrap()` |
| Bootstrap role checks bypassed | ✅ | Server branch (`team-member-profiles-api.ts:222–233`); client gates (`page.tsx:831,839`) |
| Carrier card visible for forced email | ✅ | `shouldShowCarrierInformationCard()` early return (`member-profile.ts:286`) |
| Mount effect injects Owner/Admin | ✅ | `page.tsx:338–343` |

The implementation summary claim of “no gaps” is accurate for the **happy path** (bootstrap or Driver-role account, carrier save via API). Remaining issues are UX inconsistencies before DB promotion, incomplete UI privilege wiring, and test/maintainability debt.

---

## Open Issues

### 1
- **Severity:** bug
- **File:line:** `app/profile/page.tsx:1165–1170`, `lib/member-profile.ts:445–452`
- **Description:** Carrier edit affordances are gated by `canWriteProfile` (`canWriteTeamData(ownProfile)`), which is **not** bypassed for the forced owner email. `handleSaveCarrierInfo` correctly skips the viewer gate (`page.tsx:831`), but when the account already has carrier data the UI enters summary mode (`shouldShowCarrierForm` returns `false` until `carrierFormExpanded`). `showEditCarrierButton` requires `canWriteProfile`, so a forced owner with a **Viewer-only** persisted profile sees the Carrier Information card in read-only summary with no **Edit Carrier Info** button and no **Save Carrier Info** button — save is reachable only via API/devtools, not the UI.
- **Suggestion:** Include `forcedCarrierOwner` in `showEditCarrierButton` (and any related expand/collapse gates), or derive a `canManageCarrierUi = canManageCarrier || forcedCarrierOwner` flag shared by edit/save/collapse controls.
- **Status:** open

### 2
- **Severity:** bug
- **File:line:** `app/profile/page.tsx:1094–1095`, `app/profile/page.tsx:1257–1261`, `lib/member-profile.ts:315–326`
- **Description:** Forced-owner UX helpers are only partially wired. `isProfileBootstrap` is strictly `!ownProfile`, so a forced owner with an existing non-primary row (e.g. Driver in an org) does **not** see the amber bootstrap welcome (“setting up as Owner / Admin”) even though the mount effect and save path treat them as bootstrap-capable. Likewise `shouldShowOwnerAdminBadge` reads only persisted `ownProfile` and ignores `forcedCarrierOwner`, so the Owner / Admin badge is hidden until after a successful carrier save updates the DB — while the mount effect silently injects Owner / Admin into form state.
- **Suggestion:** Extend bootstrap copy and badge visibility with `forcedCarrierOwner && !primaryOwner` (or `!hasOwnerAdminRole(ownProfile?.user_roles)`), matching the implicit-promotion story told by the mount effect.
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:1095`, `app/profile/page.tsx:1558–1561`, `app/profile/page.tsx:1701`, `app/profile/page.tsx:1750`, `app/profile/page.tsx:262`
- **Description:** Team-management surfaces key off `primaryOwner` (`isPrimaryOwner(ownProfile)` from DB) only. A forced owner who has not yet completed a carrier save cannot add team members, approve link requests, or load full org roster (`loadTeamData` only fetches org members when `isPrimaryOwner(profile)`). Carrier save is unblocked, but the landing page still presents a non-owner experience until promotion persists — inconsistent with “always Owner/Admin” intent.
- **Suggestion:** Treat `forcedCarrierOwner` as elevated for team UI gates (or run a one-time silent promotion on login) so pre-save UX matches post-save privileges; document if intentional deferral.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:338–343`
- **Description:** The mount `useEffect` re-applies `ensureBootstrapOwnerAdminRoles` whenever `ownProfile`, `editingTarget.kind`, or `user?.email` changes **and** `isForcedCarrierOwner(user?.email)` is true — including after the account is already primary owner in the DB. This is idempotent but causes transient form/DB divergence: landing role badges read `ownProfile` (Driver) while form holds injected Owner/Admin until save or remount. Non-forced bootstrap runs only when `!ownProfile`; forced path runs on every revisit, which is broader than necessary.
- **Suggestion:** Narrow the condition to `!ownProfile || (forcedCarrierOwner && !primaryOwner && !hasOwnerAdminRole(ownProfile?.user_roles))` to avoid re-mutating form on established owners; add `form` baseline guard if user edits roles elsewhere.
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:654–658`, `supabase/migrations/019_team_member_profiles.sql:17–19`
- **Description:** `prepareMemberProfileSave` sets `is_primary_owner: true` for a forced owner even when `existing.organization_id` is set and `existing.is_primary_owner` is false. If another primary owner already exists in that org, the upsert will conflict with `idx_member_profiles_one_primary_owner_per_org`. The integration test mocks a successful upsert for a non-primary driver in `org-1` and does not exercise the constraint.
- **Suggestion:** Document that forced promotion is only valid for solo/bootstrap orgs, or add a guard that fails fast with a clear error when the org already has a different primary owner.
- **Status:** open

### 6
- **Severity:** suggestion
- **File:line:** `lib/member-profile.test.ts:601–626`
- **Description:** `shouldShowCarrierInformationCard` tests cover primary owner, bootstrap, and form-role paths but **omit** the `actorEmail` parameter introduced for forced owner. Regression in the email bypass would not be caught by the 92-test `member-profile` suite (only `forced-carrier-owner.test.ts` covers save gates, not card visibility).
- **Suggestion:** Add cases: forced email + non-primary profile + `user_roles: ['Driver']` → `true`; non-forced same profile → `false`.
- **Status:** open

### 7
- **Severity:** suggestion
- **File:line:** `lib/team-member-profiles-api.test.ts:253–295`
- **Description:** Forced-owner API coverage is a single happy-path test (driver profile, existing `organization_id`, company rename). Missing scenarios: (a) forced owner with **Viewer-only** profile + `carrier_only` (validates viewer bypass on `member_only` is not confused with carrier path), (b) forced owner with **no** `organization_id` asserting `ensureOrganizationBootstrap` upserts `organizations` + `organization_memberships`, (c) assertion that `validateBootstrapCarrierSaveRoles` is **not** invoked for forced owner (branch isolation).
- **Suggestion:** Extend mocked Supabase chain to assert `from('organizations').upsert` / `from('organization_memberships').upsert` for bootstrap; add viewer-profile variant mirroring the UI dead-end in issue #1.
- **Status:** open

### 8
- **Severity:** suggestion
- **File:line:** `lib/team-member-profiles-api.ts:52–84`
- **Description:** `ensureOrganizationBootstrap` has **zero** direct unit tests. It is the persistence bridge for new-org creation and is only reached indirectly; mock upsert failures or partial writes would be undetected.
- **Suggestion:** Add focused tests for: early return when `!organization_id` or `!is_primary_owner`; successful org + membership upsert; propagated `orgError` / `membershipError`.
- **Status:** open

### 9
- **Severity:** suggestion
- **File:line:** `app/profile/profile-ui.test.ts:271–303`, `app/profile/profile-ui.test.ts:204–211`
- **Description:** Profile UI tests are source-inspection only — they verify symbols exist but not behavioral composition. Notably `showEditCarrierButtonGuard` expects `canWriteProfile` without any `forcedCarrierOwner` exception (`profile-ui.test.ts:274–295`), encoding the bug in #1 as “correct.” Mount-effect test matches regex presence but does not assert dependency array, guard ordering relative to initial profile load, or interaction with `setForm` from the auth `useEffect` (`page.tsx:306–308`).
- **Suggestion:** Add pure helper tests for composed flags (`showEditCarrierButton` logic extracted or table-driven expectations). Update source-inspection to require `forcedCarrierOwner` in edit-button guard once fixed.
- **Status:** open

### 10
- **Severity:** suggestion
- **File:line:** `lib/forced-carrier-owner.ts:1–6`
- **Description:** The allowlist is a **hardcoded personal email** in source control, exported as `FORCED_CARRIER_OWNER_EMAIL` and imported by tests and API tests. There is no env-based override, feature flag, expiry comment, or runbook for removal. Changing the Supabase auth email silently disables all bypasses. Adding a second break-glass account requires a code change and redeploy.
- **Suggestion:** Move to `process.env.FORCED_CARRIER_OWNER_EMAIL` (comma-separated allowlist), keep `isForcedCarrierOwner()` as the single check, add a `@temporary` comment with removal criteria, and stop exporting the raw constant to tests (use env fixture or test-only override).
- **Status:** open

### 11
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:1135–1140`
- **Description:** `shouldShowCarrierInformationCard` already returns `true` for `isForcedCarrierOwner(actorEmail)` internally (`member-profile.ts:286`). Call-site args `primaryOwner || forcedCarrierOwner` and `isProfileBootstrap || forcedCarrierOwner` are redundant and may confuse future readers into thinking the helper requires those flags for forced owner.
- **Suggestion:** Pass `primaryOwner`, `isProfileBootstrap`, `form`, `actorEmail` only; rely on the helper’s email check.
- **Status:** open

### 12
- **Severity:** nit
- **File:line:** `lib/forced-carrier-owner.ts:1`
- **Description:** File comment says “Account that always receives primary Owner/Admin carrier-save treatment” but does not state this is temporary, security-sensitive, or that server-side `actorEmail` from JWT is the trust boundary (client checks are UX-only).
- **Suggestion:** Expand module docblock: purpose, client vs server authority, removal plan.
- **Status:** open

---

## UX Flow Notes (Carrier Card + Mount Effect)

```
Initial load (page.tsx:287–323)
  → setUser, load member_profiles, setOwnProfile + setForm from DB, setLoading(false)

Mount effect (page.tsx:338–343) — runs after
  → if self && (!ownProfile || forcedOwner): setForm(ensureBootstrapOwnerAdminRoles)

Carrier card visible when (page.tsx:1135–1141)
  → shouldShowCarrierInformationCard(..., actorEmail) → true for forced email

Carrier form vs summary (member-profile.ts:445–452)
  → no carrier data: form always shown (bootstrap OK)
  → has carrier data: form only if carrierFormExpanded
  → expand button blocked for Viewer forced owner (issue #1)

Save path (page.tsx:822–857)
  → forcedOwner bypasses canWriteTeamData + bootstrap role failure
  → canSaveCarrierInfo(forced) always true
```

---

## Summary

| Severity | Count |
|----------|-------|
| bug | 2 |
| suggestion | 8 |
| nit | 2 |

**Highest-impact items:** Viewer-only forced owner stuck in read-only carrier summary (#1); incomplete bootstrap/badge UX for existing non-primary rows (#2). **Test debt:** `shouldShowCarrierInformationCard` actorEmail path, `ensureOrganizationBootstrap`, and forced-owner viewer/bootstrap API branches (#6–#9). **Maintainability:** hardcoded email should move to configuration with a documented removal path (#10).