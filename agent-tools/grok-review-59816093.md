# Merged Review — Account Switcher Bootstrap (59816093)

### Issue 1 [General] — bug
- **File**: app/profile/page.tsx:579-587
- **Description**: loadTeamInvites/loadAdminDeletionRequests gate on loadedProfile not effectiveOwnProfile; roster-only Admin sees empty admin sections.
- **Suggestion**: Use hydrated actorProfile for initial admin loads.
- **Status**: fixed
- **Response**: Initial session load now builds `hydratedActorProfile` via `resolveActorProfile` and uses it for `loadAdminPendingChangeRequests`, `loadAdminDeletionRequests`, and `loadTeamInvites`.

### Issue 2 [General] — bug
- **File**: app/profile/page.tsx (buildCarrierOnlyApiSavePayload, carrier save)
- **Description**: Carrier save uses ownProfile null while UI uses effectiveOwnProfile; roster-linked Admin can fork new org with Owner bootstrap roles.
- **Suggestion**: Use effectiveOwnProfile in carrier/save payload builders and validateBootstrapCarrierSaveRoles.
- **Status**: fixed
- **Response**: `handleSaveCarrierInfo` passes `effectiveOwnProfile` to `buildCarrierOnlyApiSavePayload` and `validateBootstrapCarrierSaveRoles` (bootstrap-gated). Carrier payload no longer treats roster-linked admins as null-actor bootstrap.

### Issue 3 [Security] — bug
- **File**: lib/roster-profile-link.ts, RLS
- **Description**: Roster-only users may not read team_member_profiles via client RLS → false bootstrap → new org creation.
- **Suggestion**: Add server-side or membership-based resolution; handle lookup errors; ensure roster-linked users cannot bootstrap new org.
- **Status**: fixed
- **Response**: Added `fetchActorTeamContext` (membership fetched before roster). Client and server bootstrap decisions use `organization_memberships` when roster RLS blocks reads. Server self-save resolves org via `resolveSelfSaveOrganizationId` and skips bootstrap when membership exists.

### Issue 4 [Security] — bug
- **File**: lib/team-member-profiles-api.ts self-save
- **Description**: First self-save may accept escalated roles from client; roster roles not always enforced.
- **Suggestion**: Clamp roles from roster/membership on self-save when not bootstrapping.
- **Status**: fixed
- **Response**: Added `clampSelfSaveRolesFromTeamContext`; server always replaces client `user_roles` with roster/membership roles on non-bootstrap self-save (Owner escalation stripped).

### Issue 5 [Tests] — bug
- **File**: lib/team-member-profiles-api.test.ts
- **Description**: No behavioral test for roster-linked self-save skipping bootstrap.
- **Suggestion**: Add API test with mocked roster context.
- **Status**: fixed
- **Response**: Added tests for roster-linked self-save and membership-only visibility; asserts org reuse, role clamping, and no `organizations.upsert`.

### Issue 6 [Tests] — suggestion
- **File**: lib/member-profile.test.ts
- **Description**: resolveActorProfile membership-only hydration untested.
- **Suggestion**: Add unit test.
- **Status**: fixed
- **Response**: Added `hydrates from organization_memberships when roster is unavailable` plus `clampSelfSaveRolesFromTeamContext` and `resolveSelfSaveOrganizationId` coverage.

### Issue 7 [General-2] — suggestion
- **File**: app/profile/profile-ui.test.ts
- **Description**: No UI slice for initial-load parallel fetch → landing vs Welcome branch.
- **Suggestion**: Add source assertions.
- **Status**: fixed
- **Response**: Added assertions for `fetchActorTeamContext`, `hydratedActorProfile`, and bootstrap vs landing branch wiring.

### Issue 8 [General] — suggestion
- **File**: buildSavePayloadForTarget, validateBootstrapCarrierSaveRoles
- **Description**: Still use ownProfile instead of effectiveOwnProfile.
- **Suggestion**: Align all save paths.
- **Status**: fixed
- **Response**: `buildSavePayloadForTarget` defaults to `effectiveOwnProfile`; `handleSave` and carrier save paths aligned. UI tests updated accordingly.