# Dev Account Switcher + team_member_profiles.permissions — Implementation Summary

## Issues Fixed

1. **Dev account switcher — switch back to primary owner** (`andrehampton1@outlook.com`)
2. **Missing `permissions` column on `team_member_profiles`** — New Team Member save broken

---

## Files Changed

| File | Change |
|------|--------|
| `components/DevAccountSwitcher.tsx` | UI fixes: owner always first in dropdown, valid controlled `select` value, org fallback via `team_member_profiles`, **Switch back to owner** button, clear `localStorage` persona when returning to owner |
| `lib/dev-account-switch.ts` | Added `isDevBaseOwnerEmail`, `resolveDevSwitchOrganizationId`; admin-client allowlist lookup; owner always allowed in `isDevSwitchEmailAllowed` |
| `lib/dev-account-switch.test.ts` | **New** — unit tests for allowlist, org resolution, owner fast-path |
| `app/api/dev/switch-user/route.ts` | Lighter auth (no `member_profiles` required); resolve org from member or roster; admin allowlist fetch |
| `app/api/dev/switch-user/route.test.ts` | Updated mocks; added **team member switches back to owner** test |
| `app/api/admin/migrate/route.ts` | `SCHEMA_CHECKS` includes `team_member_profiles.permissions`; targeted `031` apply when column missing |
| `app/api/admin/migrate/route.test.ts` | Test for missing permissions column detection |
| `supabase/migrations/031_team_member_profiles_permissions.sql` | **New** — idempotent `permissions jsonb` column + `NOTIFY pgrst` |
| `lib/migration-manifest.json` | Added `031_team_member_profiles_permissions.sql` |
| `lib/migrations.ts` | Added `getMigration031Sql()` |
| `lib/migrations.test.ts` | Manifest + migration 031 assertions |
| `scripts/apply-migrations.mjs` | Schema check includes `permissions`; fallback applies `031` when full migration fails |
| `lib/team-member-profiles-api.test.ts` | Added `createOrUpdateRosterMemberForUser` insert-with-permissions test |
| `app/profile/profile-ui.test.ts` | Dev switcher assertions for owner button and roster org fallback |

---

## Design Decisions

### 1. Dev switcher — reliable owner switch-back

**UI**
- Removed disabled empty `<option>` that conflicted with controlled `select` values.
- Owner email is always the first option and labeled `(owner)`.
- `selectValue` falls back to `DEV_BASE_OWNER_EMAIL` when current email is not in options (e.g. org data failed to load).
- Added explicit **Switch back to owner** button when logged in as a non-owner account.
- `loadTeamEmails` resolves `organization_id` from `member_profiles` or `team_member_profiles` (`linked_user_id` / `driver_email`) so team members still get a useful dropdown when org roster load would otherwise bail early.
- Clearing `dev-test-persona-email` from `localStorage` when switching back to owner.

**Server**
- Replaced `getAuthenticatedMemberProfile` (required `member_profiles` row) with token auth + `resolveDevSwitchOrganizationId` so team-member sessions are not blocked before allowlist checks.
- `fetchDevSwitchAllowlistEmails` can use `supabaseAdmin` to bypass RLS gaps when building org email lists.
- `isDevSwitchEmailAllowed` always permits `DEV_BASE_OWNER_EMAIL` regardless of allowlist contents.

### 2. `permissions` column — schema + safe apply

- Migration `027` already defines `permissions`, but live DB had not applied it (confirmed in dev logs: schema cache error).
- Added focused migration `031` (idempotent `ADD COLUMN IF NOT EXISTS`) for safe targeted apply.
- `GET/POST /api/admin/migrate` now checks `team_member_profiles.permissions` and runs `031` when missing after full migration attempt.
- `scripts/apply-migrations.mjs` applies `031` as fallback when full consolidated SQL fails (e.g. unrelated `member_profiles_user_roles_check` violation in migration 030).

---

## Test Commands & Results

```text
npx vitest run lib/dev-account-switch.test.ts app/api/dev/switch-user/route.test.ts app/api/admin/migrate/route.test.ts lib/team-member-profiles-api.test.ts lib/migrations.test.ts app/profile/profile-ui.test.ts
→ 6 files, 117 tests passed
```

### Live / integration

```text
node scripts/apply-migrations.mjs
Before: team_member_profiles.permissions — missing
After:  team_member_profiles — ok (permissions column applied via targeted 031 fallback)
```

Full consolidated migration still fails on this DB due to pre-existing `member_profiles_user_roles_check` data violation in migration 030; targeted `031` succeeded and all schema checks now pass.

---

## Manual Verification

1. Sign in as owner → use dev switcher to view as team member.
2. Click **Switch back to owner** or select `andrehampton1@outlook.com (owner)` → magic-link redirect to owner session.
3. Profile → **+ Add New Member** → **Save New Member** / **Save and Invite** → should succeed without `permissions` schema cache error.