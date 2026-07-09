# Merged Review — team_invites + Roster UI (a1ba6084)

### Issue 1 [Tests] — bug
- **File**: app/api/admin/migrate/route.test.ts
- **Description**: No POST/GET tests for 033 team_invites migration fallback (031 has tests).
- **Suggestion**: Add route tests mirroring 031 pattern.
- **Status**: fixed
- **Response**: Added GET tests for missing/inconclusive `team_invites`; POST tests for 033 apply after full migration, inconclusive recovery, and catch-path fallback. Extended complete-schema GET to assert `migration033Sql` and required columns.

### Issue 2 [General] — suggestion
- **File**: lib/admin-migrate-team-invites.ts
- **Description**: teamInvitesTableMissing ignores status column in SCHEMA_CHECKS.
- **Suggestion**: Include status in missing detection.
- **Status**: fixed
- **Response**: Added `TEAM_INVITES_STATUS_KEY` and included `team_invites.status` in `teamInvitesTableMissing()`. Unit test updated.

### Issue 3 [Tests] — suggestion
- **File**: app/profile/profile-ui.test.ts
- **Description**: No assertion Delete absent from roster table slice.
- **Suggestion**: expect(rosterSection).not.toContain roster Delete button pattern.
- **Status**: fixed
- **Response**: Added `expect(rosterSection).not.toMatch(/'Deleting\.\.\.' : 'Delete'/)` and `expect(memberCard).toMatch(...)` for Delete in card.

### Issue 4 [Tests] — suggestion
- **File**: app/profile/profile-ui.test.ts
- **Description**: showMemberCardActions guards (not self, not new member) not tested.
- **Suggestion**: Add source slice assertions.
- **Status**: fixed
- **Response**: Added regex assertion on `showMemberCardActions` definition covering `editingMember != null`, `editingTarget.kind !== 'self'`, and `!isNewTeamMemberTarget(editingTarget)`.

### Issue 5 [General-2] — suggestion
- **File**: app/profile/page.tsx
- **Description**: Member actions at bottom of long edit card — consider placing near card header for discoverability.
- **Suggestion**: Move Member actions block below card title/header row.
- **Status**: fixed
- **Response**: Moved Member actions below header/driver warning and above form fields. Test asserts `Member actions` appears before `DRIVER_IDENTITY_FIELDS` in member card slice.

### Issue 6 [Security] — suggestion
- **File**: app/api/admin/migrate
- **Description**: 033 repairs table only; 029 accept RPCs may still be missing on partial DB.
- **Suggestion**: Document in migration comment or extend schema checks for RPC existence (wontfix if too large — document only).
- **Status**: fixed
- **Response**: Added NOTE in `033_team_invites_table.sql` that 028/029 RPCs require full manifest apply. Documented in impl summary; no RPC schema checks (out of scope).