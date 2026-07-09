# Account Switcher Bootstrap Fix — Implementation Summary

## Problem (confirmed root cause)

`app/profile/page.tsx` treated **any user without a `member_profiles` row** as a primary-owner bootstrap:

- `isProfileBootstrap = !ownProfile`
- Initial load called `ensureBootstrapOwnerRoles()` for all users lacking a profile
- `shouldShowOwnerBootstrapSetupCard` showed "Welcome to Truckeros" for every such account

When dev-switching to an existing team member (Driver/Admin with roster data or membership but no `member_profiles` row yet), the profile page incorrectly showed owner onboarding instead of the role-appropriate landing view.

## Solution

Replaced naive `!ownProfile` bootstrap detection with **`needsPrimaryOwnerBootstrap()`**, which returns true only when the actor has:

- No `member_profiles` row with `organization_id`
- No `team_member_profiles` link (`linked_user_id` or `driver_email`)
- No `organization_memberships` row

Forced owner (`andrehampton1@outlook.com`) still bootstraps only when not already linked to a team.

### New helpers

| File | Functions |
|------|-----------|
| `lib/member-profile.ts` | `needsPrimaryOwnerBootstrap`, `hasExistingTeamMembership`, `memberProfileFromLinkedRoster`, `resolveActorProfile` |
| `lib/roster-profile-link.ts` | `fetchLinkedTeamMemberRoster`, `fetchOrganizationMembershipForUser` |

### Profile page changes (`app/profile/page.tsx`)

1. **On load without `member_profiles`**: parallel fetch of roster link + org membership before deciding bootstrap vs team-member view.
2. **`effectiveOwnProfile`**: hydrated from persisted profile, linked roster, or membership — used for UI permissions/landing (not for conflating DB state).
3. **`ensureBootstrapOwnerRoles`**: gated to `needsPrimaryOwnerBootstrap` only (initial load + mount effect + carrier save).
4. **`loadTeamData`**: loads full org roster for primary owners **and** Owner/Admin managers (not only primary owner).
5. **After successful save**: clears `linkedRosterProfile` / `organizationMembership` when a real profile row is created.

### Server save path (`lib/team-member-profiles-api.ts`)

Self-save bootstrap validation now uses the same `needsPrimaryOwnerBootstrap` gate. Roster-linked users without `member_profiles` get `organization_id` and roles from roster/membership instead of owner bootstrap validation.

## Test results

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

New unit coverage:

- `needsPrimaryOwnerBootstrap` — owner vs roster-linked vs membership vs forced owner
- `resolveActorProfile` / `memberProfileFromLinkedRoster`
- Roster/membership fetch helpers (mocked Supabase)

## Manual verification steps (dev account switcher)

Prerequisites: dev mode enabled, `SUPABASE_SERVICE_ROLE_KEY` set, owner account with team roster.

1. **Owner with profile** — switch to `andrehampton1@outlook.com` (owner). Expect landing with Carrier Information + full Team Roster. No "Welcome to Truckeros" card.

2. **Team member with `member_profiles`** — switch to Driver/Admin email that has accepted an invite (has `member_profiles`). Expect:
   - Driver: landing with role badges, "Edit My Profile", limited self-service
   - Admin: landing with team tools, full roster visibility

3. **Roster-only team member** (no `member_profiles`, row in `team_member_profiles` by email or `linked_user_id`) — switch to that email. Expect:
   - **No** Welcome/onboarding card
   - Landing view with correct role badges
   - Appropriate team section for role

4. **Truly new primary owner** — sign in as a brand-new account with no org/roster/membership. Expect Welcome/bootstrap setup card and Owner role assignment on save.

5. **Forced owner edge case** — `andrehampton1@outlook.com` without org still gets bootstrap; same account linked to a roster/org does **not**.

6. **Switch back** — use "Switch back to owner" in dev banner; confirm owner landing restores without bootstrap flash (loading spinner covers resolution).

## Files changed

- `lib/member-profile.ts`
- `lib/roster-profile-link.ts` (new)
- `lib/roster-profile-link.test.ts` (new)
- `lib/member-profile.test.ts`
- `app/profile/page.tsx`
- `app/profile/profile-ui.test.ts`
- `lib/team-member-profiles-api.ts`
- `lib/team-member-profiles-api.test.ts`

---

## Review follow-up (59816093) — all issues fixed

Addressed all 8 open items from `grok-review-59816093.md`:

1. **Admin loads on initial paint** — `hydratedActorProfile` drives invites/deletions/pending-change loads for roster-only managers.
2. **Save/carrier payloads** — `effectiveOwnProfile` used in `buildSavePayloadForTarget`, `buildCarrierOnlyApiSavePayload`, and bootstrap role validation (carrier save gated to `isProfileBootstrap`).
3. **RLS-safe team context** — `fetchActorTeamContext` fetches `organization_memberships` first; server uses `resolveSelfSaveOrganizationId`.
4. **Role clamping** — `clampSelfSaveRolesFromTeamContext` always enforces roster/membership roles on non-bootstrap self-save.
5. **Tests** — roster-linked + membership-only API tests; membership-only `resolveActorProfile`; UI slice for load branch.

### Test results (post-review)

```text
npx vitest run \
  lib/member-profile.test.ts \
  lib/roster-profile-link.test.ts \
  app/profile/profile-ui.test.ts \
  lib/team-member-profiles-api.test.ts

Test Files  4 passed (4)
Tests       204 passed (204)
```