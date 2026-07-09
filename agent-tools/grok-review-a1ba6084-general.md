# Code Review: `team_invites` Migration Repair + Team Roster UI Move

**Review ID:** a1ba6084  
**Reference:** `agent-tools/grok-impl-summary-a1ba6084.md`  
**Verdict:** **Approve with minor fixes** — The `033` repair migration and admin/script fallback wiring correctly address the live `team_invites` schema-cache failure (mirrors the `031` permissions pattern, including catch-path recovery). Roster destructive/invite actions are cleanly relocated into the member edit card with permission guards preserved. Remaining gaps are operational (partial repair scope, API test coverage) and minor test/UX polish—not blockers for the stated fix.

---

## Focus Area Verification

| Area | Result | Notes |
|------|--------|-------|
| Idempotent `033` repair migration | ✅ Pass | `CREATE TABLE IF NOT EXISTS`, indexes, RLS policies, `NOTIFY pgrst` (`033_team_invites_table.sql:5–94`). Content matches `027` `team_invites` slice. |
| Manifest + loader | ✅ Pass | `033_team_invites_table.sql` in `migration-manifest.json:21`; `getMigration033Sql()` in `migrations.ts:92–94`; asserted in `migrations.test.ts:267–274`. |
| Admin migrate schema detection | ✅ Pass | `team_invites` added to `SCHEMA_CHECKS` with `organization_id`, `invite_token`, `status` (`route.ts:59–62`). GET exposes `migration033Sql` and flattened `requiredColumns` (`route.ts:243–248`). |
| Targeted fallback (API success path) | ✅ Pass | After full `MIGRATION_SQL`, `applyTeamInvitesMigrationIfNeeded` runs `033` when table missing/inconclusive (`route.ts:336–342`). |
| Targeted fallback (API catch path) | ✅ Pass | Catch block runs both `031` and `033` fallbacks independently (`route.ts:361–389`) — fixes the asymmetric catch gap noted in prior `031` review. |
| CLI script parity | ✅ Pass | `apply-migrations.mjs` checks `team_invites`, applies `033` on success and catch paths (`apply-migrations.mjs:76, 171–175`). |
| `applyTeamInvitesMigrationIfNeeded` helper | ✅ Pass | Mirrors permissions helper; handles missing columns and inconclusive table checks (`admin-migrate-team-invites.ts:16–44`). |
| Roster table Actions column | ✅ Pass | Only **Edit** button in roster rows (`page.tsx:2554–2566`). No Re-invite/Delete/Request removal in table slice. |
| Member edit card actions | ✅ Pass | **Member actions** section at card bottom with `allowCardReinvite`, `allowCardDelete`, `allowCardRequestRemoval` (`page.tsx:2401–2443`). Hidden for new members (`!isNewTeamMemberTarget`) and when no action is permitted. |
| Permission guards preserved | ✅ Pass | Re-invite uses `canReinviteMember` (excludes self/primary owner); delete uses `canDeleteMember`; request removal gated by `allowCardRequestRemoval && !allowCardDelete`. |
| Profile UI tests | ✅ Pass | `profile-ui.test.ts:659–682` asserts actions in `memberEditCardSlice`, not `teamRosterSectionSlice`. |
| Impl-summary test suite | ✅ Pass | 6 files, **83 tests** — all passed (verified 2026-07-08). |

---

## Issues

### 1

- **Severity:** bug
- **File:Line:** `supabase/migrations/033_team_invites_table.sql:1–94`, `lib/admin-migrate-team-invites.ts:29–44`
- **Description:** Targeted `033` repair creates only the `team_invites` table and org-manager RLS. If migration `027` never ran on a live DB, sibling objects from the same migration (`deletion_requests` table) and downstream invite-accept infrastructure (`preview_team_invite` / `accept_team_invite` RPCs in `028`/`029`) remain missing. Applying only `033` (via fallback or manual SQL) fixes `GET /api/team-invites` schema errors but does **not** guarantee invite accept (`/api/team-invites/accept`) or Permit Clerk **Request removal** (`deletion_requests`) work.
- **Suggestion:** Document this limitation in migrate instructions; consider a `034` repair bundle for `deletion_requests` + accept RPCs, or extend schema checks to surface missing RPCs/`deletion_requests` so operators know partial repair occurred.
- **Status:** open

### 2

- **Severity:** suggestion
- **File:Line:** `app/api/admin/migrate/route.test.ts` (entire file), `app/api/admin/migrate/route.ts:336–389`
- **Description:** Route tests cover `031` permissions fallback (GET missing column, POST success/catch paths) but have **no** analogous coverage for `team_invites` / `033`. Regressions in `applyTeamInvitesMigrationIfNeeded` wiring or `SCHEMA_CHECKS` for `team_invites` would not be caught by CI.
- **Suggestion:** Add GET test flagging missing `team_invites.organization_id`; POST tests mirroring `031` cases: (a) full migration succeeds but table still missing → second `runMigrationSql` with `033` SQL; (b) full migration throws → `033` still attempted in catch path.
- **Status:** open

### 3

- **Severity:** suggestion
- **File:Line:** `app/api/admin/migrate/route.ts:358–406`
- **Description:** When the consolidated migration throws but targeted `033` (or `031`) succeeds, POST returns `success: false` with `applied: true` and `teamInvitesMigrationApplied: true`. Operators or admin UI consumers may treat the response as total failure and retry unnecessarily, or miss that `team_invites` was actually repaired.
- **Suggestion:** Return `success: true` when post-fallback `getSchemaStatus().columnsExist` is true (or add a distinct `partialSuccess: true` flag with a clear message listing which targeted migrations applied).
- **Status:** open

### 4

- **Severity:** suggestion
- **File:Line:** `app/profile/profile-ui.test.ts:680–682`
- **Description:** Roster relocation test asserts `teamRosterSectionSlice` does **not** contain `Re-invite` or `Request removal`, and does contain `Edit`, but does **not** assert `Delete` is absent from the roster table slice. A regression re-adding Delete to the table row would not fail this test.
- **Suggestion:** Add `expect(rosterSection).not.toContain('Delete')` (or a more precise match on the Actions `<td>` block only).
- **Status:** open

### 5

- **Severity:** suggestion
- **File:Line:** `app/profile/page.tsx:2401–2443`, `agent-tools/grok-impl-summary-a1ba6084.md:73–76`
- **Description:** Re-invite, Delete, and Request removal now live at the **bottom** of the member edit card. Users must open Edit and scroll past identity/roles/permissions fields to reach destructive actions. This is likely intentional (contextual, safer) but reduces discoverability compared to inline table actions.
- **Suggestion:** Consider a sticky footer for **Member actions** on long edit cards, or a brief hint in the roster table (“Edit member for invite/delete actions”). No code change required if manual QA confirms acceptable UX.
- **Status:** open

### 6

- **Severity:** nit
- **File:Line:** `lib/migration-manifest.json:15–21`, `supabase/migrations/027_team_invites_and_deletion_requests.sql:25–109`, `supabase/migrations/033_team_invites_table.sql:5–89`
- **Description:** Full consolidated migration (`getFullMigrationSql`) runs both `027` (creates `team_invites`) and `033` (re-creates same table/policies). Idempotent DDL makes this safe but adds redundant work on every full migrate apply.
- **Suggestion:** Acceptable for repair safety; optionally add a comment in `033` header that duplicate execution after `027` is expected/no-op.
- **Status:** open

### 7

- **Severity:** nit
- **File:Line:** `lib/admin-migrate-team-invites.ts:16–20`, `app/api/admin/migrate/route.ts:59–62`
- **Description:** `teamInvitesTableMissing()` triggers fallback only for `team_invites.organization_id` or `team_invites.invite_token`, not `team_invites.status`, even though `status` is in `SCHEMA_CHECKS`. A hypothetically corrupted table missing only `status` would not trigger targeted `033`.
- **Suggestion:** Include `team_invites.status` in `teamInvitesTableMissing`, or document that `status` is diagnostic-only in schema checks.
- **Status:** open

---

## Test Run Summary (2026-07-08)

```
npx vitest run \
  lib/admin-migrate-team-invites.test.ts \
  lib/admin-migrate-permissions.test.ts \
  lib/migrations.test.ts \
  app/profile/profile-ui.test.ts \
  lib/team-invites.test.ts \
  app/api/team-invites/route.test.ts
```

**Result:** 6 files, **83 tests** — all passed (1.17s)

| Suite | Tests |
|-------|-------|
| app/profile/profile-ui.test.ts | 39 |
| lib/migrations.test.ts | 20 |
| lib/team-invites.test.ts | 9 |
| app/api/team-invites/route.test.ts | 5 |
| lib/admin-migrate-permissions.test.ts | 5 |
| lib/admin-migrate-team-invites.test.ts | 5 |

---

## Manual Verification Checklist (from impl summary)

| Step | Expected | Review note |
|------|----------|-------------|
| Owner/Admin roster table | Actions column shows **Edit** only | Code + `profile-ui.test.ts` aligned |
| Edit member with email/phone | **Member actions** → Re-invite | `allowCardReinvite` + `canReinviteMember` |
| Deletable member | **Delete** in card → confirm modal | Uses existing `setDeleteCandidate` flow |
| Permit Clerk | **Request removal** instead of Delete | `allowCardRequestRemoval && !allowCardDelete` |
| Self edit | No Member actions | All `allowCard*` false for `is_self` |
| + Add New Member | No Member actions; Save and Invite instead | `!isNewTeamMemberTarget` guard |
| Post-migration `GET /api/team-invites` | `{ success: true, data: [...] }` | Requires `033` or full `027+` applied; accept RPCs still need `028`/`029` (issue #1) |

---

## Summary

Core deliverables are sound: **`033` closes the `team_invites` schema gap** with the same targeted-fallback pattern as `031`, and **roster UI relocation** keeps permission logic intact while simplifying the table. Before relying on targeted `033` alone in production, operators should understand it repairs listing/creation only—not the full invite-accept or deletion-request stack. Recommended follow-ups: admin migrate route tests for `033`, clearer partial-success POST responses, and a `Delete`-absent roster regression assertion.