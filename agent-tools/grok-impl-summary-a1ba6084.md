# Implementation Summary — team_invites + Team Roster UI

## 1. Fix `team_invites` table error

### Problem
Migration `027_team_invites_and_deletion_requests.sql` defines `team_invites`, but the live DB may not have it applied. The app hit PostgREST/schema-cache errors when calling `/api/team-invites`. `team_invites` was not in `SCHEMA_CHECKS` in the admin migrate route.

### Solution (mirrors `031` permissions pattern)

| File | Change |
|------|--------|
| `supabase/migrations/033_team_invites_table.sql` | **New** idempotent repair migration — creates `team_invites` table, indexes, RLS policies, `NOTIFY pgrst` |
| `lib/migration-manifest.json` | Added `033_team_invites_table.sql` |
| `lib/migrations.ts` | Added `getMigration033Sql()` |
| `lib/admin-migrate-team-invites.ts` | **New** helper: `applyTeamInvitesMigrationIfNeeded()` |
| `lib/admin-migrate-team-invites.test.ts` | **New** unit tests (5) |
| `app/api/admin/migrate/route.ts` | Added `team_invites` to `SCHEMA_CHECKS` (`organization_id`, `invite_token`, `status`); runs targeted `033` after full migration and in catch fallback; exposes `migration033Sql`, `teamInvitesMigrationAttempted`, `teamInvitesMigrationApplied` |
| `scripts/apply-migrations.mjs` | Added `team_invites` schema check; post-success and catch-path fallback via `033` |
| `lib/migrations.test.ts` | Added migration 033 assertions |
| `app/api/admin/migrate/route.test.ts` | GET/POST tests for 033 fallback (mirrors 031) |

### Partial-DB note (033 vs full invite stack)
Migration `033` repairs the `team_invites` **table and base RLS only**. Invite accept/preview RPCs and tightened policies live in `028_org_manager_rls_and_invite_accept.sql` and `029_tighten_invite_accept_rls.sql`. For complete invite functionality, apply the full migration manifest via `POST /api/admin/migrate` or `node scripts/apply-migrations.mjs` (not 033 alone).

### How to apply on live DB

1. **Admin UI / API**: `POST /api/admin/migrate` (requires admin auth + `DATABASE_URL` or `SUPABASE_DB_PASSWORD`)
2. **CLI**: `node scripts/apply-migrations.mjs`
3. **Manual**: Run `033_team_invites_table.sql` in Supabase SQL Editor, then `NOTIFY pgrst, 'reload schema';`
4. **Verify**: `GET /api/admin/migrate` — `team_invites.organization_id`, `invite_token`, `status` should show as present

---

## 2. Team Roster UI — Re-invite / Delete inside edit card

### Before
Re-invite, Delete, and Request removal were in the roster table **Actions** column.

### After
- **Roster table**: Only **Edit** button remains in Actions column
- **Member edit card** (`showMemberEditCard`): New **Member actions** section below card header (above form fields) when editing an existing member (not self, not new member)
  - Re-invite (Owner/Admin, member has email/phone)
  - Delete (Owner/Admin direct delete)
  - Request removal (Permit Clerk)

### Key variables added in `app/profile/page.tsx`
- `editingMember` — resolved from `editingMemberKey` + `teamMembers`
- `showMemberCardActions` — true when editing existing team member
- `allowCardReinvite`, `allowCardDelete`, `allowCardRequestRemoval`

### Tests updated
`app/profile/profile-ui.test.ts` — asserts Re-invite/Delete/Request removal in `memberEditCardSlice`, not in `teamRosterSectionSlice`.

---

## 3. Test results

```
npx vitest run \
  lib/admin-migrate-team-invites.test.ts \
  lib/admin-migrate-permissions.test.ts \
  lib/migrations.test.ts \
  app/profile/profile-ui.test.ts \
  lib/team-invites.test.ts \
  app/api/team-invites/route.test.ts
```

**83 tests passed** (6 files)

---

## 5. Review fixes (grok-review-a1ba6084)

| Issue | Fix |
|-------|-----|
| 1 | Admin migrate route tests for 033 (GET missing/inconclusive, POST apply/fallback) |
| 2 | `teamInvitesTableMissing` includes `team_invites.status` |
| 3 | profile-ui: Delete absent from roster slice, present in member card |
| 4 | profile-ui: `showMemberCardActions` guard assertions |
| 5 | Member actions moved below header for discoverability |
| 6 | 033 migration NOTE + summary doc for 028/029 RPC dependency |

### Test results (review fix pass)

```
npx vitest run \
  lib/admin-migrate-team-invites.test.ts \
  lib/admin-migrate-permissions.test.ts \
  lib/migrations.test.ts \
  app/profile/profile-ui.test.ts \
  lib/team-invites.test.ts \
  app/api/team-invites/route.test.ts \
  app/api/admin/migrate/route.test.ts
```

**109 tests passed** (7 files)

---

## 4. Manual roster verification checklist

1. Sign in as **Owner/Admin** with team members
2. **Team Roster table**: Each row shows only **Edit** in Actions (no Re-invite/Delete)
3. Click **Edit** on a member with email/phone → member edit card opens
4. **Member actions** appears near top of edit card (below header):
   - **Re-invite** visible for eligible members → click → success message with invite link
   - **Delete** visible for deletable members → click → confirm modal → member removed
5. Sign in as **Permit Clerk** → edit a member → **Request removal** shown instead of Delete
6. **Edit** on self profile → no Member actions section (self edit)
7. **+ Add New Member** → no Member actions (new member flow uses Save and Invite instead)
8. After migration apply: `GET /api/team-invites` returns `{ success: true, data: [...] }` without schema errors