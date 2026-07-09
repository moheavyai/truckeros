## Review Issues (Round 2)

### Issue 15 [Security] — Severity: bug
- **File**: supabase/migrations/028_org_manager_rls_and_invite_accept.sql:44-47
- **Description**: Broad organization_memberships INSERT policy allows any user to join any org as Admin without valid invite
- **Suggestion**: Remove broad policy; use SECURITY DEFINER RPC or WITH CHECK requiring matching pending team_invites row for auth user email/phone
- **Status**: fixed
- **Response**: Migration `029_tighten_invite_accept_rls.sql` drops `"Users can insert own membership on invite accept"`. Accept flow uses `accept_team_invite(p_token)` SECURITY DEFINER RPC (validates token, email, expiry) — no client INSERT on `organization_memberships`.

### Issue 16 [Security] — Severity: bug
- **File**: 028 invitee SELECT policy
- **Description**: Phone-only invites enumerable cross-org (invite_email IS NULL matches all phone invites)
- **Suggestion**: Token-scoped read only via server API; remove client-readable phone-only SELECT or require invite_token match
- **Status**: fixed
- **Response**: Migration 029 drops `"Invitees can view matching pending invites"` and `"Invitees can accept matching pending invites"`. Preview/accept are token-scoped via `preview_team_invite` / `accept_team_invite` RPCs; `GET /api/team-invites/accept?token=` uses server RPC only.

### Issue 17 [General] — Severity: bug
- **File**: lib/team-invite-accept.ts:64-75
- **Description**: Accept upsert overwrites existing member_profiles with empty form
- **Suggestion**: Load existing profile and merge org_id, roles, email only
- **Status**: fixed
- **Response**: RPC `accept_team_invite` uses `ON CONFLICT (user_id) DO UPDATE` for only `organization_id`, `is_primary_owner`, `user_roles`. Admin fallback in `acceptInviteViaAdmin` loads existing profile via `memberProfileFromRow` before update.

### Issue 18 [General] — Severity: bug
- **File**: lib/team-invite-accept.ts, 028 RLS
- **Description**: Re-invite fails - invitees have INSERT but not UPDATE on organization_memberships
- **Suggestion**: Add invitee self-UPDATE policy scoped to own row or handle in accept API with service role
- **Status**: fixed
- **Response**: `accept_team_invite` RPC upserts membership with `ON CONFLICT (organization_id, user_id) DO UPDATE SET role, is_primary_owner` — re-invites work without invitee UPDATE RLS. Broad INSERT policy removed (issue 15).

### Issue 19 [General] — Severity: bug
- **File**: app/profile/page.tsx, team-member-profiles-api
- **Description**: member_profile edit shows permissions editor but doesn't load/save membership permissions
- **Suggestion**: Load membership permissions for linked members; save via syncOrganizationMembershipForMember
- **Status**: fixed
- **Response**: `handleEditMember` loads `organization_memberships.permissions` for `member_profile` targets. `canEditMemberPermissions` includes `member_profile`. Save payload passes `permissions`; `saveTeamMemberProfileForUser` syncs to membership via `syncOrganizationMembershipForMember`.

### Issue 20 [General] — Severity: bug
- **File**: app/profile/page.tsx role UI
- **Description**: Owner still assignable in team member role picker creating undeletable members
- **Suggestion**: Exclude Owner from assignable roles except bootstrap; server reject Owner on team saves
- **Status**: fixed
- **Response**: Added `ASSIGNABLE_TEAM_ROLES` (excludes Owner). Team edit UI uses `roleOptions={teamRoleOptions}`. Server `rejectNonBootstrapOwnerRoles()` in `saveTeamMemberProfileForUser` and `createOrUpdateRosterMemberForUser`.

### Issue 21 [Tests] — Severity: bug
- **File**: lib/member-profile.test.ts:82-84
- **Description**: Test expects legacy Owner/Admin -> Owner by default but validateUserRoles now defaults to Admin without isPrimaryOwner
- **Suggestion**: Update test to pass isPrimaryOwner:true for Owner case OR document default as Admin
- **Status**: fixed
- **Response**: Test updated: legacy `Owner / Admin` → Admin without `isPrimaryOwner`; separate test with `{ isPrimaryOwner: true }` → Owner.

---

## Test Run Summary (2026-07-08, Round 2)

```
npx vitest run \
  lib/member-profile.test.ts \
  lib/team-member-profiles-api.test.ts \
  lib/team-permissions.test.ts \
  lib/team-invites.test.ts \
  lib/deletion-requests.test.ts \
  app/api/team-invites/route.test.ts \
  app/api/team-invites/accept/route.test.ts \
  lib/migrations.test.ts \
  app/profile/profile-ui.test.ts \
  types/member-profile.test.ts
```

**Result:** 10 files, 211 tests — all passed (2.43s)

| Suite | Tests |
|-------|-------|
| app/profile/profile-ui.test.ts | 36 |
| lib/migrations.test.ts | 16 |
| lib/member-profile.test.ts | 98 |
| lib/team-invites.test.ts | 9 |
| app/api/team-invites/accept/route.test.ts | 4 |
| lib/team-member-profiles-api.test.ts | 28 |
| app/api/team-invites/route.test.ts | 3 |
| lib/team-permissions.test.ts | 13 |
| types/member-profile.test.ts | 2 |
| lib/deletion-requests.test.ts | 2 |

**All Round 2 issues (15–21) resolved.**