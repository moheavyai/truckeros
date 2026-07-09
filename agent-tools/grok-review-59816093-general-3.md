# Code Review: Account Switcher Bootstrap / Onboarding Gating — General Pass 3

**Review ID:** 59816093  
**Scope:** `lib/member-profile.ts`, `lib/roster-profile-link.ts`, `app/profile/page.tsx`, `lib/team-member-profiles-api.ts`, related tests  
**Reference:** `agent-tools/grok-impl-summary-59816093.md`  
**Prior reviews:** None filed under `59816093` (this is the first Grok review artifact for this effort)  
**Focus:** Third-pass verification that dev account switching no longer shows primary-owner onboarding for roster-linked / membership-linked actors lacking a `member_profiles` row  
**Status:** Review only — no code changes made

---

## Verification Summary

| Focus area | Status | Evidence |
|------------|--------|----------|
| **Root cause (`!ownProfile` → bootstrap)** | **Fixed** | `isProfileBootstrap` derives from `needsPrimaryOwnerBootstrap()` (`page.tsx:378-386`), not `!ownProfile`. |
| **`needsPrimaryOwnerBootstrap` gate** | **Fixed** | Returns false when roster or `organization_memberships` link exists (`member-profile.ts:312-318`); forced owner still bootstraps only when unlinked (`member-profile.test.ts:700-714`). |
| **Parallel roster + membership fetch before decision** | **Fixed** | No-profile branch awaits `Promise.all([fetchLinkedTeamMemberRoster, fetchOrganizationMembershipForUser])` before bootstrap vs landing (`page.tsx:533-552`). |
| **`effectiveOwnProfile` hydration** | **Fixed** | `resolveActorProfile(ownProfile, linkedRosterProfile, user.id, organizationMembership)` drives permissions, landing, team section (`page.tsx:370-376`, widespread `effectiveOwnProfile` usage). |
| **`ensureBootstrapOwnerRoles` gating** | **Fixed** | Mount effect and initial load call it only when `needsPrimaryOwnerBootstrap` is true (`page.tsx:554-561`, `613-625`); carrier save uses `isProfileBootstrap` snapshot (`page.tsx:1149-1153`). |
| **Server save parity** | **Fixed** | `saveTeamMemberProfileForUser` fetches roster/membership, gates bootstrap validation on `needsPrimaryOwnerBootstrap`, and stamps `organization_id` from linkage when not bootstrapping (`team-member-profiles-api.ts:329-397`). |
| **`loadTeamData` for Owner/Admin managers** | **Fixed** | `shouldLoadFullOrg` uses `isPrimaryOwner(profile) \|\| hasManagementAccess(profile)` (`page.tsx:474-475`), so roster-hydrated Admins load full roster. |
| **Post-save linkage cleanup** | **Fixed** | Successful saves clear `linkedRosterProfile` / `organizationMembership` when a real profile row exists (`page.tsx:1219-1221`, `1384-1385`). |
| **Loading covers resolution (no bootstrap flash)** | **Fixed** | Full-page spinner until session + profile/roster resolution completes (`page.tsx:1884-1895`); `setLoading(false)` runs after parallel fetch (`page.tsx:591`). |
| **Unit / source tests** | **Passing (per impl)** | **219/219** across 5 files per `grok-impl-summary-59816093.md`. Independent re-run blocked by shell harness error in this review environment. |
| **Dev-switch manual scenarios** | **Unverified** | No Playwright or live-Supabase test exercises switch → reload → landing for roster-only actors. |
| **Roster-only Admin admin-panel data on first load** | **Gap** | Initial admin fetches still keyed on `loadedProfile`, not hydrated `actorProfile` (`page.tsx:581-587`). |

**Pass 3 conclusion:** The core regression — dev-switching to a roster-linked Driver/Admin and seeing "Welcome to Truckeros" — is **correctly addressed** at the helper, client load, UI permission, and server save layers. `needsPrimaryOwnerBootstrap` is the single gate on both sides. Remaining gaps are initial-load admin data for roster-only managers, behavioral (non–source-inspection) API tests for the roster skip path, and E2E proof of dev-switch flows.

---

## End-to-End Flow (After Fix)

### 1. Dev switch → roster-linked Driver (no `member_profiles`)

```
verifyOtp + reload → /profile
  → getSession → member_profiles.maybeSingle() → null
  → parallel fetch: team_member_profiles (linked_user_id → driver_email) + organization_memberships
  → needsPrimaryOwnerBootstrap({ ownProfile: null, linkedRoster }) → false
  → resolveActorProfile → synthetic profile (org_id, Driver roles, is_primary_owner: false)
  → setFormState from actorProfile; loadTeamData for driver self-service scope
  → isProfileBootstrap = false → no Welcome card; landing + role badges + Edit My Profile
  → mount effect: needsPrimaryOwnerBootstrap → false → no ensureBootstrapOwnerRoles injection
```

### 2. Dev switch → roster-linked Admin (no `member_profiles`)

```
Same resolution path with Admin roles on roster row
  → effectiveOwnProfile has hasManagementAccess → full org roster via loadTeamData
  → showTeamInvitesSection = true (canManageMemberPermissions)
  → ⚠️ teamInvites / deletionRequests NOT loaded on initial paint (loadedProfile still null)
  → sections render empty until user action triggers loadTeamInvites / loadAdminDeletionRequests
```

### 3. Truly new primary owner (no org / roster / membership)

```
member_profiles null, roster + membership null
  → needsPrimaryOwnerBootstrap → true
  → ensureBootstrapOwnerRoles on form; Welcome/setup card via shouldShowOwnerBootstrapSetupCard
  → save runs bootstrap validation (client + server)
```

### 4. Forced owner (`andrehampton1@outlook.com`)

```
No team linkage → needsPrimaryOwnerBootstrap → true (even if member_profiles absent)
Linked roster or membership → false (same as any other account)
```

### 5. Switch back to owner

```
Reload after verifyOtp; loading spinner covers roster resolution
  → persisted member_profiles loaded → linkedRosterProfile / organizationMembership cleared
  → owner landing (carrier + full roster); no bootstrap card
```

---

## Issues

### 1

- **Severity:** bug
- **File:line:** `app/profile/page.tsx:579-587`
- **Description:** After the no-profile branch resolves a roster- or membership-linked **Admin**, `showTeamInvitesSection` and deletion-review UI become visible via `effectiveOwnProfile`, but the initial `session.access_token` block only loads admin data when `loadedProfile` is truthy. Roster-only managers therefore land with empty Team Invites and Pending Deletion sections until a later handler (create invite, accept invite, etc.) calls `loadTeamInvites` / `loadAdminDeletionRequests`.
- **Suggestion:** Hoist `actorProfile` from the no-profile branch (or compute `resolveActorProfile(...)` once) and use `const adminActor = loadedProfile ?? resolvedActor` for `isPrimaryOwner` / `canManageMemberPermissions` checks before `setLoading(false)`. Mirror the driver path, which already calls `loadOwnPendingChangeRequests` with `actorProfile` (`page.tsx:566-567`).
- **Status:** open

### 2

- **Severity:** suggestion
- **File:line:** `lib/team-member-profiles-api.test.ts:900-951`, `lib/team-member-profiles-api.ts:329-397`
- **Description:** Server-side roster skip is verified only via source-inspection tests (`expect(source).toContain('needsPrimaryOwnerBootstrap')`, regex on `shouldBootstrap`). No mocked test asserts that an actor with `actorProfile = null`, `linkedRoster` populated, and `saveScope: 'full'` **does not** call `validateBootstrapSelfSave` and **does** set `payload.organization_id` from the roster row.
- **Suggestion:** Add one test: `mockMaybeSingle` → null profile, `mockLinkedRosterMaybeSingle` → Admin roster row, form with driver fields; assert upsert payload includes roster `organization_id`, `is_primary_owner: false`, and no bootstrap org UUID generation.
- **Status:** open

### 3

- **Severity:** suggestion
- **File:line:** `lib/member-profile.test.ts:717-761`, `lib/member-profile.ts:335-353`
- **Description:** `resolveActorProfile` tests cover roster hydration and persisted-profile precedence, but not the **membership-only** path (`organizationMembership` without `linkedRoster`). That path is used when a user has `organization_memberships` but no roster row and no `member_profiles` row.
- **Suggestion:** Add `resolveActorProfile(null, null, userId, { organization_id: 'org-1', role: 'Admin' })` expectation and a `needsPrimaryOwnerBootstrap` case with membership only (already partially covered at line 691-697; add matching `resolveActorProfile` test).
- **Status:** open

### 4

- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:1147-1187`, `lib/member-profile.ts:155-176`
- **Description:** Carrier save still passes `ownProfile` (persisted DB row) into `validateBootstrapCarrierSaveRoles` and `buildCarrierOnlyApiSavePayload`, while UI gates use `effectiveOwnProfile`. This is intentional separation (avoid conflating synthetic hydration with upsert baseline), but roster-linked Admins saving carrier fields get client payload org UUIDs from `prepareMemberProfileSave(null)` while the server overwrites with roster `organization_id`. Dev `[carrier-save]` logs can show misleading `organization_id` for this path.
- **Suggestion:** Document in `handleSaveCarrierInfo` that `ownProfile` is deliberate for API baseline; optionally pass `effectiveOwnProfile` into `buildCarrierOnlyApiSavePayload` when `!ownProfile && effectiveOwnProfile?.organization_id` for logging accuracy only.
- **Status:** open

### 5

- **Severity:** suggestion
- **File:line:** `lib/roster-profile-link.ts:14-45`, `lib/roster-profile-link.test.ts:80-101`
- **Description:** `fetchLinkedTeamMemberRoster` correctly prefers `linked_user_id` then `driver_email`, but the email-fallback test uses a mock that returns roster data on the first `maybeSingle` for all `team_member_profiles` queries. It does not prove the linked lookup returned null before email lookup ran (the user-id test does prove ordering).
- **Suggestion:** Split mocks so the `linked_user_id` query returns null and only the `driver_email` query returns the row; assert both lookups were invoked in order.
- **Status:** open

### 6

- **Severity:** suggestion
- **File:line:** `lib/roster-profile-link.ts:52-57`, `lib/member-profile.ts:312`
- **Description:** Both fetch helpers take `.order('updated_at', { ascending: false }).limit(1)`. Users linked to multiple orgs (stale roster row + new membership) silently resolve to the most recently updated row. `needsPrimaryOwnerBootstrap` then treats any linkage as non-bootstrap, which is correct, but the chosen org may not match the dev-switcher’s intended team.
- **Suggestion:** Accept for dev tooling; document single-org assumption. If multi-org becomes real, add explicit org selection or prefer membership over roster.
- **Status:** open

### 7

- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:306-318`, `lib/member-profile.test.ts:651-715`
- **Description:** `needsPrimaryOwnerBootstrap` returns false when `ownProfile` exists without `organization_id`, team linkage, or `is_primary_owner` (orphan/incomplete row). That actor gets neither bootstrap nor hydrated team view — a data anomaly outside the dev-switch regression but unhandled in tests.
- **Suggestion:** Add a test documenting the orphan-row behavior; consider treating `ownProfile` without org and without team linkage as bootstrap-eligible if product intends self-healing.
- **Status:** open

### 8

- **Severity:** suggestion
- **File:line:** `app/profile/profile-ui.test.ts`, `components/DevAccountSwitcher.tsx`, manual steps in impl summary
- **Description:** Dev-switch bootstrap gating is not proven end-to-end. Coverage is helper unit tests + `page.tsx` source assertions (`needsPrimaryOwnerBootstrap`, `fetchLinkedTeamMemberRoster`, `effectiveOwnProfile`). No test simulates session swap → profile load → absence of `shouldShowOwnerBootstrapSetupCard` for a roster email.
- **Suggestion:** Add a manual QA checklist to CI docs (impl summary steps 1–6) or a Playwright spec behind `isDevAccountSwitcherEnabled()`. Minimum: switch to roster-only Driver email, assert no "Welcome to Truckeros" text after reload.
- **Status:** open

### 9

- **Severity:** nit
- **File:line:** `lib/roster-profile-link.ts:22-24`, `lib/roster-profile-link.ts:60-62`
- **Description:** Lookup errors log `console.warn` and return null, which makes `needsPrimaryOwnerBootstrap` fall through to bootstrap UI if the actor truly lacks a profile row. A transient RLS or network failure could briefly show the Welcome card for a roster-linked user on retry-less first load.
- **Suggestion:** On fetch error with no profile row, consider a non-bootstrap "could not load team linkage" warning state instead of defaulting to owner bootstrap; or retry once before deciding.
- **Status:** open

### 10

- **Severity:** nit
- **File:line:** `app/profile/page.tsx:613`
- **Description:** Comment documents first-visit Owner injection; mount `useEffect` correctly gates on `needsPrimaryOwnerBootstrap`. Minor redundancy with initial-load branch that also calls `ensureBootstrapOwnerRoles` for bootstrap actors (`page.tsx:560`).
- **Suggestion:** Optional dedupe: rely on initial-load injection only when `!ownProfile`, keep mount effect as safety net for edge navigations.
- **Status:** open

---

## Prior Issue Reconciliation

| Issue (source) | Result |
|----------------|--------|
| Any user without `member_profiles` treated as bootstrap (`grok-impl-summary-59816093`) | **Resolved** — `needsPrimaryOwnerBootstrap` + parallel linkage fetch |
| `ensureBootstrapOwnerRoles` on all no-profile loads | **Resolved** — gated on `needsPrimaryOwnerBootstrap` |
| Team roster not loaded for non–primary-owner managers | **Resolved** — `hasManagementAccess` in `loadTeamData` |
| Server bootstrap validation for roster-linked self-save | **Resolved** — shared gate + org/role stamp from linkage |
| Dev-switch session persistence (related `173775a0` effort) | **Out of scope** — assumes `verifyOtp` + reload works; this review targets post-switch profile landing only |

---

## Positive Observations

1. **Single source of truth:** `needsPrimaryOwnerBootstrap` is shared by client UI, mount effect, initial load, and server save — low drift risk.
2. **Clean hydration layer:** `effectiveOwnProfile` separates synthetic permission state from `ownProfile` DB state; post-save cleanup clears linkage state when a real row appears.
3. **Forced-owner edge case:** Explicitly handled without bypassing team linkage (`member-profile.test.ts:700-714`).
4. **Loading UX:** Spinner blocks render until roster/membership resolution finishes, preventing bootstrap flash on dev switch.
5. **Modular fetch helpers:** `lib/roster-profile-link.ts` keeps Supabase lookup chains out of `page.tsx` and is independently unit tested.
6. **API test harness updated:** `team-member-profiles-api.test.ts` mocks `team_member_profiles` and `organization_memberships` select chains (`mockLinkedRosterMaybeSingle`, `mockMembershipLookupMaybeSingle`) so existing save tests keep passing after the new fetches.

---

## Manual Verification Checklist (recommended before closing)

Prerequisites: dev mode, `SUPABASE_SERVICE_ROLE_KEY`, owner with team roster, dev switcher enabled.

1. **Owner with profile** — switch to owner email → Carrier Information + full Team Roster; no Welcome card.
2. **Member with `member_profiles`** — switch to accepted Driver → role badges, Edit My Profile, no carrier management.
3. **Roster-only Driver** — switch to email/`linked_user_id` on roster without `member_profiles` → **no** Welcome card; landing with Driver badges; team section appropriate to role.
4. **Roster-only Admin** — same as (3) plus full roster visibility; **confirm Team Invites populate on first paint** (currently expected to fail — issue #1).
5. **New account** — fresh user with no linkage → Welcome/setup card and bootstrap save.
6. **Forced owner** — `andrehampton1@outlook.com` without team → bootstrap; same email when roster-linked → no bootstrap.
7. **Switch back** — owner restore without bootstrap flash; spinner during load only.

Console sanity check after roster-only switch:

```js
// Should NOT see bootstrap card in DOM
document.body.innerText.includes('Welcome to Truckeros')  // expect false

// effectiveOwnProfile analogue after load
const { data } = await (await import('@/lib/supabase/client')).createClient().auth.getSession()
// Inspect network: team_member_profiles + organization_memberships fetched before profile UI renders
```

---

## Summary by Severity

| Severity | Count |
|----------|-------|
| bug | 1 |
| suggestion | 7 |
| nit | 2 |
| **Total open** | **10** |

---

## Focus-Area Verdict

| Area | Verdict |
|------|---------|
| **Bootstrap detection** | **Resolved.** `needsPrimaryOwnerBootstrap` replaces naive `!ownProfile` and matches product intent. |
| **Dev-switch landing** | **Resolved** for Driver and primary-owner paths; **partial** for roster-only Admin admin-panel data (issue #1). |
| **Client/server parity** | **Resolved** for bootstrap gating and org assignment; behavioral API test still thin (issue #2). |
| **`effectiveOwnProfile`** | **Resolved** for permissions, landing, and team visibility. |
| **Test depth** | **Adequate** for helpers; **gaps** for E2E dev switch and roster-skip save orchestration. |

One functional **bug** remains for roster-only Admin initial admin-data loading. No blocking issues for the stated regression (roster-linked Driver/Admin incorrectly shown owner onboarding). Highest-value follow-ups: fix issue #1, add issue #2 behavioral API test, run manual checklist step 4 before closing.

---

## Notes

- Test count per implementation summary: `npx vitest run lib/member-profile.test.ts lib/roster-profile-link.test.ts app/profile/profile-ui.test.ts lib/team-member-profiles-api.test.ts lib/dev-account-switch.test.ts` → **219/219 passed** (not independently re-run in this review pass).
- Related dev-switcher session work (`173775a0`) should remain closed before manual QA; this review assumes reload lands on the switched session.
- No code changes were made in this review pass.