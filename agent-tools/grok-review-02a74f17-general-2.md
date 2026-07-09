# Forced Carrier Owner — General Review Pass 2

**Scope:** `lib/forced-carrier-owner.ts`, `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`, related tests, DB triggers (`020`, `023`)  
**Reference:** `agent-tools/grok-impl-summary-02a74f17.md`  
**Focus:** `prepareMemberProfileSave` promotion correctness, client/server consistency, edge cases (partial profile, viewer role, existing org rename)  
**Tests run:** `npx vitest run lib/forced-carrier-owner.test.ts lib/team-member-profiles-api.test.ts lib/member-profile.test.ts app/profile/profile-ui.test.ts` → **148/148 passing**

---

## Executive Summary

Application-layer promotion in `prepareMemberProfileSave()` is wired consistently on both client (`buildCarrierOnlyApiSavePayload`) and server (`saveTeamMemberProfileForUser`) via `actorEmail` from auth. Bootstrap (no `organization_id`) and already-primary-owner rename paths are coherent and well-tested at the unit layer.

The implementation summary’s “no gaps” conclusion is **overstated**. The highest-risk gap is a **DB/application mismatch**: promoting `is_primary_owner` from `false` → `true` on an existing org-linked profile is implemented in TypeScript but **blocked in production** by `enforce_member_profile_privileged_columns`. The primary integration test for forced-owner org-linked save uses mocked Supabase and would not catch this.

---

## Verified Correct (Happy Paths)

| Area | Status | Evidence |
|------|--------|----------|
| Email match | OK | `isForcedCarrierOwner()` trim + lowercase (`lib/forced-carrier-owner.ts:4-5`); unit tests |
| Bootstrap promotion (no org) | OK | `shouldBootstrapOrganization` + `prepareMemberProfileSave` assign UUID + `is_primary_owner: true` (`lib/member-profile.ts:636-664`); `lib/forced-carrier-owner.test.ts:58-83` |
| Partial profile bootstrap | OK | Profile row without `organization_id` bootstraps org + primary flag; client payload mirrors server via shared `prepareMemberProfileSave` |
| Already-primary rename | OK | Existing org preserved; `company_name` flows through payload (`lib/member-profile.test.ts:266-284`); `ensureOrganizationBootstrap` syncs `organizations.name` post-upsert (`lib/team-member-profiles-api.ts:52-68`) |
| Server permission bypass (carrier_only) | OK | Viewer gate skipped when `forcedCarrierOwner && saveScope === 'carrier_only'` (`lib/team-member-profiles-api.ts:212-217`) |
| Client handler bypass | OK | `handleSaveCarrierInfo` skips `canWriteTeamData` and bootstrap role failure for forced owner (`app/profile/page.tsx:829-841`) |
| Role injection consistency | OK | Both paths call `ensureBootstrapOwnerAdminRoles` before save; `prepareMemberProfileSave` also injects for forced email (`lib/member-profile.ts:649-651`) |
| Carrier card visibility | OK | `shouldShowCarrierInformationCard` + `canSaveCarrierInfo` return true for forced email regardless of bootstrap/primary flags |

---

## Open Issues

### 1
- **Severity:** bug
- **File:line:** `lib/member-profile.ts:654-658`, `supabase/migrations/020_member_profiles_privileged_columns.sql:60-62`, `lib/team-member-profiles-api.test.ts:253-294`
- **Description:** `prepareMemberProfileSave()` sets `is_primary_owner: true` when `existing.organization_id` is set and `isForcedCarrierOwner(actorEmail)`, even if `existing.is_primary_owner === false`. The DB trigger `enforce_member_profile_privileged_columns` raises `'Cannot change is_primary_owner on self-update'` on any UPDATE where `OLD.is_primary_owner IS DISTINCT FROM NEW.is_primary_owner`. A forced owner who is org-linked as a non-primary member (e.g. approved carrier link, imported driver row) will have the upsert rejected in production. The integration test models exactly this scenario (`driverProfile` with `organization_id: 'org-1'`, `is_primary_owner: false`) and asserts `upsertPayload.is_primary_owner === true`, but mocked Supabase never runs triggers — giving false confidence.
- **Suggestion:** Either (a) restrict forced-owner promotion to bootstrap-only (`!existing?.organization_id`) and document that the allowlisted account must not be a linked non-primary member, or (b) add a privileged server-side path (service role or SECURITY DEFINER RPC) to perform the promotion, or (c) extend the DB trigger with an explicit allowlist exception. Add a test that documents the intended behavior for org-linked non-primary actors.
- **Status:** open

### 2
- **Severity:** bug
- **File:line:** `app/profile/page.tsx:1165-1170`, `lib/member-profile-permissions.ts:13-23`
- **Description:** `showEditCarrierButton` requires `canWriteProfile` (`canWriteTeamData(ownProfile)`), but `handleSaveCarrierInfo` bypasses that gate for `forcedCarrierOwner`. A forced owner whose persisted `user_roles` are Viewer-only and who already has carrier data (`hasCarrierData` → summary mode, `carrierFormExpanded === false`) sees the Carrier Information card (`shouldShowCarrierInformationCard` returns true) but cannot expand the form: no Edit button, no inline inputs, and no path to rename carrier fields. Save handler bypass is unreachable without form expansion (`shouldShowCarrierForm` returns false in summary mode).
- **Suggestion:** Include `forcedCarrierOwner` in `showEditCarrierButton` (mirror the save-handler bypass), or default `carrierFormExpanded` to true for forced owners in summary mode when `!canWriteProfile`.
- **Status:** open

### 3
- **Severity:** bug
- **File:line:** `app/profile/page.tsx:909-911`, `lib/team-member-profiles-api.ts:212-217`
- **Description:** Forced owner bypass of viewer write restrictions applies only to `carrier_only` saves. `handleSaveProfile` still early-returns on `!canWriteTeamData(ownProfile)` with no `forcedCarrierOwner` exception, and the server rejects non–`carrier_only` self-saves for viewers. Until a successful carrier save refreshes `user_roles` away from Viewer-only, the forced owner cannot use **Save Profile** to complete driver details — conflicting with post-bootstrap copy (“Complete your driver details below, then click Save Profile”).
- **Suggestion:** If forced owners must complete onboarding in one session, bypass `canWriteTeamData` in `handleSaveProfile` (and the matching server branch) when `isForcedCarrierOwner(actorEmail)`, or auto-expand/edit driver fields inline after carrier bootstrap without requiring Save Profile.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `lib/team-member-profiles-api.ts:52-84`, `lib/team-member-profiles-api.test.ts:186-201`
- **Description:** Existing-org **rename** for an already-primary forced owner is supported at the app layer (`company_name` in upsert payload + `ensureOrganizationBootstrap` syncing `organizations.name`), but no test asserts that `ensureOrganizationBootstrap` is invoked with the updated name. The mock `from()` handler returns a no-op upsert for non-`member_profiles` tables, so org-table sync is unverified even for the forced-owner integration test.
- **Suggestion:** Add a mocked test that captures `organizations` upsert arguments after a forced-owner rename, or document manual smoke steps (dev `[carrier-save]` logs + `organizations.name` check).
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:643-667`, `lib/team-member-profiles-api.ts:244`
- **Description:** Requirement text says promotion on “every **carrier** save,” but `prepareMemberProfileSave(..., actorEmail)` runs for all self-save scopes (`full`, `member_only`, `carrier_only`). A forced owner submitting `member_only` or `full` with an existing org would also emit `is_primary_owner: true` in the payload — same DB trigger conflict as issue #1, and broader than the stated requirement.
- **Suggestion:** Gate forced-owner `is_primary_owner` injection on `saveScope === 'carrier_only'`, or document that any self-save promotes ownership.
- **Status:** open

### 6
- **Severity:** suggestion
- **File:line:** `lib/forced-carrier-owner.ts:2`, `lib/team-member-profiles-api.ts:194-195`
- **Description:** Authorization is a hardcoded email allowlist compared against Supabase auth `user.email`. Any account with that email receives primary-owner carrier treatment. There is no env-based override, audit log, or expiry — acceptable for a single known operator but fragile for rotation, typos, or compromised mailbox.
- **Suggestion:** Move to env config (`FORCED_CARRIER_OWNER_EMAIL`) with fallback to the constant; log when the bypass path is taken (server-side only).
- **Status:** open

### 7
- **Severity:** suggestion
- **File:line:** `lib/team-member-profiles-api.test.ts:210-251`, `lib/forced-carrier-owner.test.ts:34-42`
- **Description:** Tests cover viewer rejection for `member_only` and forced-owner allowance at the pure-function layer, but there is no integration test proving a Viewer-profile forced owner succeeds on `carrier_only` through `saveTeamMemberProfileForUser` while `member_only` still throws. Regression in the `forcedCarrierOwner && saveScope === 'carrier_only'` branch would not be caught.
- **Suggestion:** Add `saveTeamMemberProfileForUser` tests: forced email + Viewer profile + `carrier_only` → upsert called; same actor + `member_only` → forbidden.
- **Status:** open

### 8
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:133-137`, `lib/member-profile.ts:149-169`, `app/profile/page.tsx:857-862`
- **Description:** Client POST includes `organization_id` from `buildCarrierOnlyApiSavePayload` for logging/traceability, but the server derives org exclusively from the DB actor row inside `prepareMemberProfileSave`. Safe against spoofing; client and server promotion stay aligned as long as both call `prepareMemberProfileSave` with `actorEmail`. The client field is never parsed from the request body.
- **Suggestion:** Add a code comment on the API route or in `buildCarrierOnlyApiSavePayload` stating body `organization_id` is ignored by design; optionally log a dev warning on mismatch.
- **Status:** open

### 9
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:337-343`
- **Description:** Mount `useEffect` calls `ensureBootstrapOwnerAdminRoles` whenever `isForcedCarrierOwner(user?.email)` even if `ownProfile` exists. On every `ownProfile` / email dependency change, in-progress `user_roles` edits in form state may be overwritten with Owner/Admin prepended. Likely intentional for the allowlisted account but surprising if roles are ever manually adjusted in the UI.
- **Suggestion:** Narrow the effect to bootstrap (`!ownProfile`) or run only once per session for forced owners.
- **Status:** open

### 10
- **Severity:** nit
- **File:line:** `lib/member-profile.test.ts:286-304`, `lib/forced-carrier-owner.test.ts:44-56`
- **Description:** `member-profile.test.ts` documents that non-forced org-linked profiles do **not** get `is_primary_owner` in the payload when the flag was false. The forced-owner test covers the opposite with `actorEmail` passed. The distinction is correct but easy to miss when reading only `prepareMemberProfileSave` — the fourth parameter controls promotion.
- **Suggestion:** Add a one-line JSDoc on `prepareMemberProfileSave` noting `actorEmail` triggers allowlisted promotion independent of `existing.is_primary_owner`.
- **Status:** open

---

## Edge-Case Matrix

| Scenario | App-layer behavior | Production DB | Test coverage |
|----------|-------------------|---------------|---------------|
| No profile / partial (no `organization_id`) | Bootstrap UUID + `is_primary_owner: true` | Allowed (one-time bootstrap trigger) | `forced-carrier-owner.test.ts:58-83` |
| Org-linked, already `is_primary_owner: true`, rename | Org preserved, `company_name` updated, org name synced | Allowed (flag unchanged) | `member-profile.test.ts:266-284`; forced integration test (mock only) |
| Org-linked, `is_primary_owner: false`, forced save | Payload sets `is_primary_owner: true` | **Blocked** by migration 020 trigger | Integration test asserts promotion but **would fail live** |
| Viewer-only `user_roles`, no carrier data | Card shown, form expanded, save bypass works | Bootstrap path OK; promotion path depends on org state | Partial (pure functions only) |
| Viewer-only, existing carrier data (summary mode) | Card shown, **no Edit**, save unreachable | N/A until form expanded | **None** |
| Viewer completing driver profile via Save Profile | Blocked until roles refresh | Blocked on `member_only` | **None** for forced owner |

---

## Client / Server Consistency Assessment

| Step | Client (`handleSaveCarrierInfo`) | Server (`saveTeamMemberProfileForUser`) | Aligned? |
|------|----------------------------------|----------------------------------------|----------|
| Actor identity | `user?.email` | `userData.user.email` from token | Yes (same session) |
| Viewer gate | Bypassed when `forcedCarrierOwner` | Bypassed when `forcedCarrierOwner && carrier_only` | Yes |
| Bootstrap role validation | Skipped when `forcedCarrierOwner` | Skipped in dedicated branch (no `validateBootstrapCarrierSaveRoles` throw) | Yes |
| Role injection | `ensureBootstrapOwnerAdminRoles` on snapshot | `ensureBootstrapOwnerAdminRoles` on `formForSave` | Yes |
| Promotion authority | `buildCarrierOnlyApiSavePayload` → `prepareMemberProfileSave(..., actorEmail)` | `prepareMemberProfileSave(..., actorEmail)` | Yes |
| Org ID source | Derived in `prepareMemberProfileSave` from DB-shaped `existing` / bootstrap | Derived from DB `actorProfile` | Yes (body `organization_id` ignored) |
| Post-save org sync | N/A (server only) | `ensureOrganizationBootstrap` | N/A |

**Verdict:** Client and server are consistent for promotion logic. The inconsistency is between **application promotion** and **database enforcement** (issue #1), not between client and server.

---

## Disagreement with Prior Summary

`grok-impl-summary-02a74f17.md` states “Gaps found: None.” This pass identifies at least one production-blocking gap (issue #1) and two UX gaps for viewer-role forced owners (issues #2, #3). Tests passing 148/148 does not validate trigger behavior or org-linked promotion.

---

## Recommended Manual Smoke (Post-Fix)

1. Fresh account (`andrehampton1@outlook.com`, no `member_profiles` row): carrier bootstrap → confirm `organization_id`, `is_primary_owner`, `organizations` row.
2. Same account after bootstrap: rename `company_name` → confirm `organizations.name` updates.
3. If org-linked non-primary scenario is in scope: reproduce save and confirm whether promotion succeeds or fails with trigger error (establishes baseline before fix).