# Roster dual-source edit matrix

**Plan:** `docs/plans/user-accounts-roles-flows.md` Phase 2 / §4.1  
**Code:** `lib/member-profile-permissions.ts`, `lib/team-member-profiles-api.ts`, profile team table

The team list merges two stores. **Authz for linked users is always `organization_memberships`**, not roster/profile multi-select alone. Client and API both use membership-first acting roles (`resolveActingRolesFromInputs` / `buildActingPermissionActor`) for the **target org**; Owner Operator merge applies only when that org is home.

## Sources

| `source` | Table | Meaning |
|----------|-------|---------|
| `member_profile` | `member_profiles` | Linked auth user with a home (or same-org) profile row |
| `team_member_profile` | `team_member_profiles` | Org roster row (may be unlinked / pre-invite) |

Dedup: roster rows whose `linked_user_id` already appears in org `member_profiles` are omitted from the combined list.

## Who can edit (`canEditMember` / API write gates)

| Actor (acting role for target org) | Self row | Other row |
|------------------------------------|----------|-----------|
| Primary owner (membership or bootstrap) | yes | yes |
| Owner / Admin (management access) | yes | yes |
| Driver / Clerk / Viewer | self only | no |

Gates use **membership role for the org** (plus home OO exception on home only)—not stale home `user_roles` alone.  
`canEditMember` does **not** branch on `source`. UI also requires write access for the Edit button.

## What an edit writes

| Source | Save path | Profile fields | Roles `user_roles[]` | Membership scalar `role` | Custom `permissions` (membership) |
|--------|-----------|----------------|----------------------|--------------------------|-----------------------------------|
| `member_profile` (self) | `saveTeamMemberProfileForUser` self branch | Yes (scoped) | Home multi-select when self-edit allowed | Synced via `primaryRoleFromUserRoles` when membership/roster context exists; bootstrap uses `ensureOrganizationMembership`. **Preserves** `is_primary_owner`. | Self carrier path typically omits body permissions: if role **unchanged**, existing custom membership perms preserved; if role **changed**, reset to `{ mode: 'global' }` |
| `member_profile` (other) | same API, `targetUserId` | Personal fields only (carrier stripped) | Yes | **Always** synced after upsert (`syncOrganizationMembershipForMember`); preserves primary flag | Optional body `permissions` if actor can manage; if omitted, preserve only when role unchanged, else global |
| `team_member_profile` | `createOrUpdateRosterMemberForUser` | Roster personal fields | Yes (display/edit on roster) | Synced **whenever** `linked_user_id` is set; **preserves** existing `is_primary_owner` | Stored on roster; when linked: body perms applied if provided; if omitted, preserve custom only when role **unchanged**, else reset to global |
| Unlinked roster | same | Yes | Display/edit only | **No membership** until invite accept / link | Roster-only until linked |

## Rules of thumb

1. **`user_roles[]` on roster/profile** — multi-label display and form edit (Owner + optional Driver for OO on home profile; assignable roles on team edit).
2. **`organization_memberships.role`** — scalar authz for that org. Derived with `primaryRoleFromUserRoles` (Owner+Driver → `Owner`).
3. **Acting role for nav/tools/API gates** — membership for the **effective** org, plus Owner Operator home exception (`lib/nav-actor.ts`). Never merge home OO into a foreign org.
4. **Membership permission hygiene** — on role-only sync: keep custom overrides only if role is unchanged; demote/promote without explicit permissions body → `mode: 'global'` (role defaults apply).
5. **Delete / removal request** — resource type maps by source: `member_profile` → `team_member`, `team_member_profile` → `roster_member` (`mapMemberSourceToResourceType`).

## Owner Operator note

Primary owner with home `user_roles = ['Owner','Driver']` keeps membership.role = `Owner`. Driver capabilities on the **home** org come from the acting-role merge, not a second membership row. Roster list for that person still shows both labels from home `user_roles[]`.
