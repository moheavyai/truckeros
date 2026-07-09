# General Review Pass 2: Account Switcher Bootstrap Fix

**Scope:** `needsPrimaryOwnerBootstrap`, `lib/roster-profile-link.ts`, `app/profile/page.tsx`, `lib/team-member-profiles-api.ts`, related tests  
**Reference:** `agent-tools/grok-impl-summary-59816093.md`  
**Focus:** Dev account-switch / roster-only / membership-only actors, bootstrap gating correctness, profile landing parity, regression risk  
**Date:** 2026-07-08  
**Reviewer:** Independent pass 2 (no fixes applied)

---

## Implementation Verification

| Area | Status | Evidence |
|------|--------|----------|
| `needsPrimaryOwnerBootstrap` gate | **Implemented** | `lib/member-profile.ts:306–319` — false when roster or membership exists; forced owner exempt only when unlinked |
| Roster/membership fetch helpers | **Implemented** | `lib/roster-profile-link.ts` — `linked_user_id` first, `driver_email` fallback; membership `organization_id` + `role` |
| `resolveActorProfile` / hydration | **Implemented** | `lib/member-profile.ts:335–353` — persisted profile → roster → membership priority |
| Profile page parallel resolution | **Implemented** | `app/profile/page.tsx:533–568` — fetches roster + membership when no `member_profiles` row |
| `effectiveOwnProfile` for UI/permissions | **Implemented** | `page.tsx:370–376`; used for team section, badges, saves, field gates |
| Bootstrap gated (`ensureBootstrapOwnerRoles`) | **Implemented** | Initial load (`554–561`), mount effect (`614–625`), carrier save via `isProfileBootstrap` |
| `loadTeamData` for Owner/Admin managers | **Implemented** | `page.tsx:474–475` — `isPrimaryOwner(profile) \|\| hasManagementAccess(profile)` |
| Server save uses same bootstrap gate | **Implemented** | `team-member-profiles-api.ts:329–397` — roster/membership org + roles when not bootstrapping |
| Post-save clears synthetic linkage | **Implemented** | `page.tsx:1219–1221`, `1383–1385` — clears `linkedRosterProfile` / `organizationMembership` when real row exists |
| Unit + source-inspection tests | **Present** | 5 files, 219 tests (re-run below) |

**Tests (re-run this review):**

```text
npx vitest run \
  lib/member-profile.test.ts \
  lib/roster-profile-link.test.ts \
  app/profile/profile-ui.test.ts \
  lib/team-member-profiles-api.test.ts \
  lib/dev-account-switch.test.ts

Test Files  5 passed (5)
Tests       219 passed (219)
```

---

## Edge Case Analysis

### Dev account switcher (primary scenario)

| Scenario | Behavior | Assessment |
|----------|----------|------------|
| Switch to roster-linked Driver/Admin (no `member_profiles`) | Parallel roster + membership fetch; `isProfileBootstrap` false; `effectiveOwnProfile` hydrated from roster; landing + role badges | **Correct** — fixes reported root cause |
| Switch to member with `member_profiles` | Existing path unchanged; linkage state cleared | **Correct** |
| Switch to truly new account | `needsPrimaryOwnerBootstrap` true; Welcome card + `ensureBootstrapOwnerRoles` | **Correct** |
| Switch back to owner | `window.location.reload()` in `DevAccountSwitcher` (`:225`) triggers full remount + session resolution | **Correct** — loading spinner covers resolution |
| Forced owner (`andrehampton1@outlook.com`) unlinked | Still bootstraps | **Correct** (unit test) |
| Forced owner linked to roster/org | Bootstrap suppressed | **Correct** (unit test) |

### Roster-only team member

| Scenario | Behavior | Assessment |
|----------|----------|------------|
| Linked via `linked_user_id` | First query wins; email lookup skipped | **Correct** (tested) |
| Linked via `driver_email` only | Fallback after null `linked_user_id` | **Correct** (weak test — see Finding #6) |
| Admin/Driver landing permissions | `memberProfileFromLinkedRoster` maps `user_roles`, `organization_id` | **Correct** |
| Full org roster visibility (Admin) | `loadTeamData` uses `hasManagementAccess(actorProfile)` | **Correct** |
| First self-save creates `member_profiles` | Server assigns `organization_id` + roles from roster (`team-member-profiles-api.ts:360–397`) | **Correct** |
| Admin invites / deletion queues on first paint | Initial token loads still keyed to `loadedProfile` only (`page.tsx:581–586`) | **Bug** — see Finding #1 |

### Membership-only (no roster row, no `member_profiles`)

| Scenario | Behavior | Assessment |
|----------|----------|------------|
| `organization_memberships` row present | `needsPrimaryOwnerBootstrap` false; minimal synthetic profile with `role` | **Correct** for bootstrap gate |
| Landing UI | No driver/carrier fields unless membership carries them (it does not) | **Sparse but acceptable** if invite accept always creates roster/profile eventually |
| Admin manager tools | `hasManagementAccess` true when `role` is `Admin`; full roster load runs | **Correct** |
| Admin async sections on mount | Same `loadedProfile` guard as roster-only | **Bug** — Finding #1 |

### `member_profiles` row without `organization_id`

| Scenario | Behavior | Assessment |
|----------|----------|------------|
| Row exists, no org, no team linkage | `needsPrimaryOwnerBootstrap` returns **false** (`!ownProfile` is false) | **Edge gap** — non-bootstrap landing with no team context; see Finding #3 |
| Row with `is_primary_owner` but no `organization_id` | Bootstrap false; `shouldBootstrapOrganization` true on save | **Pre-existing asymmetry** — outside this fix’s main path |

### Lookup failures / ambiguity

| Scenario | Behavior | Assessment |
|----------|----------|------------|
| Membership query errors | `fetchOrganizationMembershipForUser` returns `null` (`roster-profile-link.ts:60–62`) | **Risk** — transient DB error could show bootstrap to linked user; see Finding #4 |
| Both roster and membership exist | Roster wins in `resolveActorProfile`; bootstrap suppressed if either exists | **OK** if data consistent; stale roster could mask membership role — Finding #5 |
| Multiple roster rows | `order('updated_at', { ascending: false }).limit(1)` — most recent wins | **Reasonable** — undocumented tie-break |

---

## Regression Risk

| Surface | Risk | Verdict |
|---------|------|---------|
| Primary owner with existing profile | Unchanged path when `member_profiles` row exists | **None** |
| Bootstrap for new owners | Still gated; client + server aligned on `needsPrimaryOwnerBootstrap` | **Low** |
| Carrier save / org bootstrap | Server still runs full bootstrap validation only when `shouldBootstrap` | **Low** |
| Team member saves (editing others) | Unaffected — gate applies to self-save only | **None** |
| Permission checks site-wide on profile page | Migrated to `effectiveOwnProfile` consistently in grep sweep | **Low** — reduces prior `ownProfile`-only mis-gating |
| Extra queries on load | +2 Supabase reads when no `member_profiles` row | **Low** — scoped to that cohort; dev switch target |
| Duplicate fetches on self-save | Client already resolved linkage; server re-fetches roster + membership | **Low** — acceptable for authoritative server gate |
| `buildSavePayloadForTarget(..., ownProfile)` | Still passes persisted `ownProfile` (often `null` for roster actors); server compensates | **Low** — intentional split (UI vs DB truth) |

**Overall regression risk: Low** for the stated bug fix. One functional gap remains on **initial admin async loads** for hydrated actors (Finding #1).

---

## Findings

### 1
- **Severity:** bug
- **File:line:** `app/profile/page.tsx:579–587`
- **Description:** After resolving a roster- or membership-linked actor without a `member_profiles` row, the page loads team data and sets form/permissions via `actorProfile` / `effectiveOwnProfile`, but **admin-side async sections** still require `loadedProfile` (the raw DB row, which stays `null`). Roster-only or membership-only **Admin** users therefore miss initial loads of `loadAdminDeletionRequests`, `loadTeamInvites`, and (for primary owners) `loadAdminPendingChangeRequests` on first paint. UI gates like `showTeamInvitesSection` may render (via `effectiveOwnProfile`) while data arrays are empty until a later action triggers reload.
- **Suggestion:** Derive an `initialActorProfile = loadedProfile ?? resolveActorProfile(null, linkedRoster, userId, membership)` in the mount effect and use it for the `isPrimaryOwner` / `canManageMemberPermissions` checks (or reuse `effectiveOwnProfile` once state is committed).
- **Status:** open

### 2
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:335–353`, `lib/member-profile.test.ts:717–761`
- **Description:** `resolveActorProfile` membership-only path builds a minimal profile (`user_id`, `organization_id`, `user_roles`, `is_primary_owner: false`) with no PII. Acceptable for permissions, but landing name/summary may be blank for membership-only actors until first save.
- **Suggestion:** Document as expected interim state, or enrich from `auth.users` email metadata on the client when membership-only.
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:306–319`
- **Description:** `needsPrimaryOwnerBootstrap` returns **false** when `ownProfile` exists even if it lacks `organization_id` and the user has no roster/membership linkage. That orphan `member_profiles` row shows a non-bootstrap landing without team context instead of owner setup.
- **Suggestion:** Treat `ownProfile` without `organization_id` and without team linkage as bootstrap-eligible (unless `is_primary_owner` is explicitly false with intentional partial data). Add unit test if product expects recovery bootstrap.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `lib/roster-profile-link.ts:48–67`, `app/profile/page.tsx:533–552`
- **Description:** `fetchOrganizationMembershipForUser` (and roster warnings) swallow errors and return `null`. A transient failure with no roster match yields `needsPrimaryOwnerBootstrap === true`, incorrectly showing the Welcome/onboarding card to an existing team member.
- **Suggestion:** Distinguish error vs miss (e.g. propagate error flag, keep loading, or show retry/toast instead of bootstrap).
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:341–342`
- **Description:** When both `linkedRoster` and `organizationMembership` exist but disagree (stale roster row vs accepted invite membership), hydration prefers roster for roles/org. Bootstrap is still suppressed, but UI permissions may reflect the wrong source.
- **Suggestion:** Prefer membership when both exist and `linked_user_id` is set; or reconcile in fetch layer.
- **Status:** open

### 6
- **Severity:** nit
- **File:line:** `lib/roster-profile-link.test.ts:80–101`
- **Description:** The `driver_email` fallback test uses `createSupabaseMock`, which returns the same roster row for **every** `team_member_profiles` query. It does not assert that the `linked_user_id` query returned null before the email query ran (unlike the first test).
- **Suggestion:** Mirror the first test’s per-`eq` mock to prove two-step lookup ordering.
- **Status:** open

### 7
- **Severity:** nit
- **File:line:** `lib/roster-profile-link.ts:6`, `lib/member-profile.ts:289–292`
- **Description:** `OrganizationMembershipLink` is defined in `member-profile.ts` but imported/re-exported from `roster-profile-link.ts` for page consumption — mild module coupling.
- **Suggestion:** Move shared link types to `types/` or keep type only in `roster-profile-link.ts`.
- **Status:** open

### 8
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:1113–1117`, `1330`
- **Description:** `buildSavePayloadForTarget` defaults `profileSnapshot` to `ownProfile` (persisted row), not `effectiveOwnProfile`. Server re-resolves linkage, so saves work, but client payload may omit `organization_id` until server enrichment — slightly obscures tracing for roster-first saves.
- **Suggestion:** Pass `effectiveOwnProfile` for self-target saves, or document that server is authoritative for org resolution.
- **Status:** open

### 9
- **Severity:** nit
- **File:line:** `lib/member-profile.test.ts`, `app/profile/profile-ui.test.ts`
- **Description:** No test covers `resolveActorProfile` **membership-only** hydration or an integration-style assertion that roster-linked Admin does **not** render `getOwnerBootstrapSetupCardTitle()` / Welcome card.
- **Suggestion:** Add `resolveActorProfile(null, null, userId, { organization_id, role: 'Admin' })` unit test; optional source match for `shouldBootstrap` false → no Welcome card branch.
- **Status:** open

---

## Test Coverage Gaps

| Gap | Priority |
|-----|----------|
| Initial mount admin loads use `loadedProfile` not hydrated actor (Finding #1) | **High** |
| Membership-only `resolveActorProfile` | Medium |
| Lookup error → false bootstrap (Finding #4) | Medium |
| Email fallback two-step mock (Finding #6) | Low |
| Orphan `member_profiles` without org (Finding #3) | Low |

Existing tests solidly cover: bootstrap true/false matrix, forced owner, roster hydration, server source wiring, profile page static wiring for new helpers, dev switch regression shapes.

---

## Summary

| Severity | Count |
|----------|-------|
| bug | 1 |
| suggestion | 4 |
| nit | 4 |
| **Total open** | **9** |

**Pass-2 verdict:** The fix is **architecturally sound** — bootstrap detection is centralized in `needsPrimaryOwnerBootstrap`, client and server gates match, and `effectiveOwnProfile` correctly separates UI/permission hydration from persisted DB state. The reported dev-switch bug (roster-linked team members seeing owner onboarding) is **addressed** for bootstrap card, role badges, and team roster loading.

The main remaining functional issue is **Finding #1**: roster/membership-only managers can see manager UI affordances while invite/deletion/admin-review data is not fetched on initial mount because async loaders still require a raw `member_profiles` row.

**Recommend:** Fix Finding #1 before calling the dev-switch Admin path fully verified; otherwise safe to merge for the core bootstrap/landing correction with manual follow-up on admin invite panels after first interaction or reload.