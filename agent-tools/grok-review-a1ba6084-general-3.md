# Code Review: `team_invites` Repair Migration + Team Roster UI — General Pass 3

**Review ID:** a1ba6084  
**Scope:** `supabase/migrations/033_team_invites_table.sql`, `lib/admin-migrate-team-invites.ts`, `app/api/admin/migrate/route.ts`, `scripts/apply-migrations.mjs`, `app/profile/page.tsx`, `app/profile/profile-ui.test.ts`, related tests  
**Reference:** `agent-tools/grok-impl-summary-a1ba6084.md`  
**Prior reviews:** None filed under `a1ba6084` (this is the first Grok review artifact for this effort)  
**Focus:** Third-pass verification that live DBs missing `team_invites` are repaired via targeted migration `033`, and that Re-invite / Delete / Request removal moved from roster table Actions into the member edit card  
**Status:** Review only — no code changes made

---

## Verification Summary

| Focus area | Status | Evidence |
|------------|--------|----------|
| **Idempotent `033` repair migration** | **Fixed** | `033_team_invites_table.sql` mirrors `027` `team_invites` DDL (table, indexes, RLS, `NOTIFY pgrst`). Listed in `migration-manifest.json` after `027`. |
| **`getMigration033Sql` + manifest wiring** | **Fixed** | `lib/migrations.ts:92-94`; `lib/migrations.test.ts:267-273` asserts `CREATE TABLE IF NOT EXISTS`, `027` reference comment, manifest entry. |
| **Targeted apply helper (mirrors `031`)** | **Fixed** | `applyTeamInvitesMigrationIfNeeded()` in `lib/admin-migrate-team-invites.ts` matches `applyTeamMemberPermissionsMigrationIfNeeded` shape; 5 unit tests. |
| **`SCHEMA_CHECKS` includes `team_invites`** | **Fixed** | `app/api/admin/migrate/route.ts:59-62` checks `organization_id`, `invite_token`, `status`. |
| **Admin migrate POST/GET integration** | **Fixed** | POST runs `033` after full migration and in catch fallback (`route.ts:336-342`, `377-388`); exposes `migration033Sql`, `teamInvitesMigrationAttempted`, `teamInvitesMigrationApplied`; GET includes `migration033Sql` (`route.ts:248`). |
| **CLI script fallback** | **Fixed** | `scripts/apply-migrations.mjs:76`, `113-121`, `162`, `171`, `175` — schema check + `applyTeamInvitesFixIfNeeded` on success and catch paths. |
| **Roster table Actions slimmed** | **Fixed** | `page.tsx:2554-2566` — only **Edit** button in Actions column. |
| **Member edit card actions** | **Fixed** | `page.tsx:1834-1856`, `2401-2443` — `showMemberCardActions`, `allowCardReinvite` / `allowCardDelete` / `allowCardRequestRemoval`; **Member actions** section at card bottom. |
| **Permission gating preserved** | **Fixed** | Re-invite uses `canReinviteMember` + `resolveMemberInviteContact`; Delete uses `canDeleteMember`; Request removal uses `canRequestMemberRemoval` with `!allowCardDelete` guard (Permit Clerk path). Handlers unchanged (`handleReinviteMember`, `confirmDeleteMember`). |
| **Self / new-member exclusions** | **Fixed** | `showMemberCardActions` false when `editingTarget.kind === 'self'` or `isNewTeamMemberTarget(editingTarget)` (`page.tsx:1838-1841`). |
| **Post-delete card cleanup** | **Fixed** | `confirmDeleteMember` resets to self form when deleted member was being edited (`page.tsx:1614-1625`). |
| **Source-inspection UI tests** | **Fixed** | `profile-ui.test.ts:659-682` — Re-invite/Delete/Request removal in `memberEditCardSlice`, absent from `teamRosterSectionSlice` (Re-invite, Request removal); roster retains Edit. |
| **Unit / source tests** | **Passing (per impl)** | **83/83** across 6 files per `grok-impl-summary-a1ba6084.md`. Independent re-run blocked by shell harness error in this review environment. |
| **Live DB migration apply** | **Unverified** | No Supabase connection in review; repair path logic verified statically only. |
| **Runtime UI / interaction** | **Unverified** | Project uses source-inspection tests; no RTL/Playwright coverage for card action clicks. |

**Pass 3 conclusion:** Both stated goals are **correctly implemented**. The `031`-style repair pattern for `team_invites` is wired through API, CLI, manifest, and tests. Roster Actions now expose only Edit; destructive/invite actions live in the member edit card with existing permission helpers. Remaining gaps are partial-schema edge cases, test depth for UI gates and migration failure, and manual/live-DB verification.

---

## End-to-End Flows (After Fix)

### 1. Live DB missing `team_invites` — Admin migrate API

```
GET /api/admin/migrate (admin auth + SUPABASE_SERVICE_ROLE_KEY)
  → SCHEMA_CHECKS: team_invites.organization_id / invite_token / status → missing
  → needsMigration: true; migration033Sql exposed in response

POST /api/admin/migrate (admin auth + DATABASE_URL or SUPABASE_DB_PASSWORD)
  → runMigrationSql(full consolidated SQL) — may fail if prior migrations already partially applied
  → applyTeamInvitesMigrationIfNeeded:
      before: teamInvitesTablePossiblyMissing → true
      run 033_team_invites_table.sql (CREATE TABLE IF NOT EXISTS + RLS + NOTIFY)
      after: columnsExist → teamInvitesMigrationApplied: true
  → GET /api/team-invites no longer hits PostgREST schema-cache error
```

### 2. Full migration fails — catch-path targeted repair

```
POST /api/admin/migrate → runMigrationSql throws
  → catch: applyTeamMemberPermissionsMigrationIfNeeded (031)
  → catch: applyTeamInvitesMigrationIfNeeded (033)
  → if 033 succeeds: applied: true, teamInvitesMigrationApplied: true
  → success: false if other tables still missing; operator uses GET diagnostics + manual SQL
```

### 3. Owner/Admin — edit team member from roster

```
Team Roster table → row Actions: [Edit] only
  → Click Edit → member edit card opens (showMemberEditCard)
  → Scroll to bottom → "Member actions"
      → Re-invite (if email/phone + canReinviteMember)
      → Delete (if canDeleteMember) → confirm modal → confirmDeleteMember → resetToSelfForm
```

### 4. Permit Clerk — request removal instead of delete

```
Edit member → Member actions
  → allowCardDelete: false (Permit Clerk lacks direct delete for target)
  → allowCardRequestRemoval: true
  → "Request removal" shown (allowCardRequestRemoval && !allowCardDelete)
  → confirm modal → deletion_requests path via DELETE API
```

### 5. Self edit / Add New Member — no Member actions

```
Edit my profile (editingTarget.kind === 'self')
  → showMemberCardActions: false

+ Add New Member (isNewTeamMemberTarget)
  → showMemberCardActions: false
  → Save and Invite button shown instead (showSaveAndInviteButton)
```

---

## Issues

### 1

- **Severity:** suggestion
- **File:line:** `lib/admin-migrate-team-invites.ts:16-21`, `app/api/admin/migrate/route.ts:59-62`
- **Description:** `teamInvitesTableMissing()` treats only `team_invites.organization_id` and `team_invites.invite_token` as triggers for targeted `033`, but `SCHEMA_CHECKS` also requires `status`. If the table exists but `status` is absent (partial/corrupt schema), `applyTeamInvitesMigrationIfNeeded` skips repair because `033` is `CREATE TABLE IF NOT EXISTS` only — it cannot add a missing column. Operator sees `team_invites.status` in `missingColumns` with no automated fix.
- **Suggestion:** Either extend the missing detector to include `team_invites.status`, or add a separate `034` `ALTER TABLE ... ADD COLUMN IF NOT EXISTS status` repair migration for column-only gaps. Document in migrate GET response when table exists but column repair is needed.
- **Status:** open

### 2

- **Severity:** suggestion
- **File:line:** `lib/admin-migrate-team-invites.test.ts`, `lib/admin-migrate-team-invites.ts:39-44`
- **Description:** Unit tests cover skip, success, and inconclusive paths but not **failed apply** (`attempted: true`, `applied: false` when post-migration schema check still reports missing). Same gap exists in `admin-migrate-permissions.test.ts` (pre-existing pattern).
- **Suggestion:** Add test where `runMigration` runs but second `getSchemaStatus` still returns `team_invites.organization_id` missing; assert `{ attempted: true, applied: false }`.
- **Status:** open

### 3

- **Severity:** suggestion
- **File:line:** `app/profile/profile-ui.test.ts:680-682`
- **Description:** Roster relocation test asserts Re-invite and Request removal are absent from `teamRosterSectionSlice`, and Edit is present, but does **not** assert **Delete** is absent from the roster slice. A regression re-adding Delete to the table row would not be caught.
- **Suggestion:** Add `expect(rosterSection).not.toContain('Delete')` (or a tighter match on the row action button label) alongside existing Re-invite / Request removal negatives.
- **Status:** open

### 4

- **Severity:** suggestion
- **File:line:** `app/profile/profile-ui.test.ts:674-679`, `app/profile/page.tsx:2429`
- **Description:** Tests assert `allowCardDelete` and `Request removal` appear in `memberEditCardSlice`, but not the **`allowCardRequestRemoval && !allowCardDelete`** mutual-exclusion guard. Permit Clerk vs Owner/Admin button visibility is a stated product requirement (impl summary step 5).
- **Suggestion:** Add `expect(memberCard).toContain('allowCardRequestRemoval && !allowCardDelete')` or dedicated tests for `showMemberCardActions` false on self/new-member (`editingTarget.kind !== 'self'`, `!isNewTeamMemberTarget`).
- **Status:** open

### 5

- **Severity:** suggestion
- **File:line:** `app/profile/profile-ui.test.ts:1-6`, `app/profile/page.tsx:2401-2443`
- **Description:** Member-actions relocation is verified only via static source inspection. Runtime behavior (scroll to actions, confirm modal from card, re-invite success message, disabled state during `reinvitingMemberKey`) is not exercised. This is an accepted project limitation per test file header, but it leaves UX regressions undetected.
- **Suggestion:** Add manual QA steps to release checklist (impl summary §4) or adopt RTL for one interaction test: open edit card → click Re-invite → assert success `saveMessage`.
- **Status:** open

### 6

- **Severity:** suggestion
- **File:line:** `supabase/migrations/027_team_invites_and_deletion_requests.sql:111+`, `supabase/migrations/033_team_invites_table.sql`
- **Description:** Repair migration `033` covers only `team_invites`. If `027` failed after creating `team_invites` but before `deletion_requests`, or if `deletion_requests` is missing independently, no targeted repair analogous to `033` exists. Permit Clerk "Request removal" depends on `deletion_requests` + API paths from `027`.
- **Suggestion:** Out of scope for this effort unless production reports `deletion_requests` gaps; consider a future `034_deletion_requests_table.sql` repair mirroring `033` if needed.
- **Status:** open

### 7

- **Severity:** suggestion
- **File:line:** `lib/migration-manifest.json:15,21`, `app/api/admin/migrate/route.ts:325-342`
- **Description:** Full consolidated migration already includes `027` and `033`. On a clean DB, POST runs `team_invites` DDL twice (027 in full batch, then 033 skip or redundant re-apply). Idempotent, but issues duplicate `NOTIFY pgrst` and adds noise when diagnosing migration logs.
- **Suggestion:** Accept for repair safety; optionally log when `033` is skipped because checks pass after full migration.
- **Status:** open

### 8

- **Severity:** nit
- **File:line:** `app/profile/page.tsx:2401-2443`
- **Description:** Member actions sit below the full edit form (roles, driver fields, Save / Save and Invite). On members with long forms, Re-invite/Delete may require scrolling past primary save actions — a deliberate UX trade-off vs. the prior one-click table actions.
- **Suggestion:** Consider sticky footer for Member actions on `md+` breakpoints, or a visual separator hint in the card header that actions are at the bottom.
- **Status:** open

### 9

- **Severity:** nit
- **File:line:** `scripts/apply-migrations.mjs:92-99`
- **Description:** CLI `isTeamInvitesTablePossiblyMissing` uses broad string matching (`team_invites`, `does not exist`, `schema cache`) whereas the API helper uses structured `missingColumns` + `inconclusiveChecks`. Slight behavioral divergence if PostgREST returns an unusual error shape not matching CLI heuristics.
- **Suggestion:** Align CLI detection with `teamInvitesTablePossiblyMissing` logic from `lib/admin-migrate-team-invites.ts` (shared module or duplicated predicates + tests).
- **Status:** open

### 10

- **Severity:** nit
- **File:line:** `app/api/admin/migrate/route.ts:248`, `agent-tools/grok-impl-summary-a1ba6084.md:26`
- **Description:** Impl summary verify step references `GET /api/admin/migrate` column presence; GET returns `tableResults` per table but operators must interpret nested structure. No single `team_invites: "ok"` convenience field.
- **Suggestion:** Document expected GET JSON shape for `team_invites` checks in ops runbook; optional: flatten `team_invitesReady: boolean` in GET response.
- **Status:** open

---

## Prior Issue Reconciliation

| Issue (source) | Result |
|----------------|--------|
| `team_invites` not in `SCHEMA_CHECKS` / live DB schema-cache errors on `/api/team-invites` (`grok-impl-summary-a1ba6084`) | **Resolved** — `033` repair + `SCHEMA_CHECKS` + targeted apply in API and CLI |
| Re-invite / Delete / Request removal cluttering roster Actions column | **Resolved** — roster Edit only; actions in member edit card |
| No targeted migration helper for `team_invites` (unlike `031` permissions) | **Resolved** — `lib/admin-migrate-team-invites.ts` |
| Tests for migration `033` and UI relocation | **Resolved** — `migrations.test.ts`, `admin-migrate-team-invites.test.ts`, `profile-ui.test.ts:659-682` |

---

## Positive Observations

1. **Consistent repair pattern:** `033` follows the established `031` permissions model — shared helper shape, post-migration schema re-check, catch-path fallback, manifest entry, and dedicated unit tests.
2. **Idempotent DDL:** `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` make re-runs safe when full migration partially applied.
3. **RLS parity:** `033` policies match `027` verbatim — no policy drift between primary and repair migrations.
4. **UI uses existing permission layer:** Card actions delegate to `canReinviteMember`, `canDeleteMember`, `canRequestMemberRemoval` rather than duplicating role checks inline.
5. **Defensive Permit Clerk guard:** `allowCardRequestRemoval && !allowCardDelete` mirrors `canActorRequestMemberDeletion` returning false when direct delete is allowed (`team-permissions.ts:317`).
6. **Delete flow cleanup:** `confirmDeleteMember` still resets edit state when the deleted member was open in the card — avoids stale edit UI after removal.
7. **Button types:** Re-invite/Delete/Request removal use `type="button"` inside the form — no accidental form submit.
8. **Test slice boundaries:** `memberEditCardSlice` / `teamRosterSectionSlice` give meaningful regression fences for the relocation change.

---

## Manual Verification Checklist (recommended before closing)

Prerequisites: admin credentials, `DATABASE_URL` or `SUPABASE_DB_PASSWORD`, org with team members (or staging DB missing `team_invites`).

**Migration**

1. `GET /api/admin/migrate` — confirm `team_invites.*` columns reported; note `migration033Sql` present.
2. On DB missing table: `POST /api/admin/migrate` — `teamInvitesMigrationAttempted: true`, `teamInvitesMigrationApplied: true`.
3. `GET /api/team-invites` (Owner/Admin bearer) — `{ success: true, data: [...] }` without schema-cache error.
4. Alternative: `node scripts/apply-migrations.mjs` — log shows targeted `team_invites` migration when needed.

**Roster UI**

5. Sign in as **Owner/Admin** — roster Actions column shows **Edit** only per row.
6. Edit member with email/phone — **Member actions** at card bottom; **Re-invite** works and shows invite link in success message.
7. Edit deletable member — **Delete** → confirm modal → member removed; edit card closes.
8. Sign in as **Permit Clerk** — edit member → **Request removal** (not Delete).
9. Edit self — no Member actions section.
10. **+ Add New Member** — no Member actions; **Save and Invite** present.

---

## Summary by Severity

| Severity | Count |
|----------|-------|
| bug | 0 |
| suggestion | 7 |
| nit | 3 |
| **Total open** | **10** |

---

## Focus-Area Verdict

| Area | Verdict |
|------|---------|
| **`team_invites` schema repair** | **Resolved** for missing-table case; **partial column gap** unaddressed (issue #1). |
| **Admin / CLI migration wiring** | **Resolved** — mirrors `031`; catch fallback and response flags present. |
| **Roster Actions simplification** | **Resolved** — Edit only in table. |
| **Member edit card actions** | **Resolved** — correct placement, gating, and handler reuse. |
| **Test depth** | **Adequate** for helpers and source slices; **gaps** for Delete roster negative, gate expressions, migration failure, and runtime UI (issues #2–#5). |
| **Live / manual verification** | **Pending** — required before production close. |

No blocking **bugs** found. The implementation matches the impl summary and is safe to ship after manual checklist (especially migration apply on the affected live DB and Permit Clerk request-removal path). Highest-value follow-ups: run manual steps 1–10, add issue #3 roster Delete negative test, and decide whether issue #1 partial-column repair is in scope.

---

## Notes

- Test count per implementation summary: `npx vitest run lib/admin-migrate-team-invites.test.ts lib/admin-migrate-permissions.test.ts lib/migrations.test.ts app/profile/profile-ui.test.ts lib/team-invites.test.ts app/api/team-invites/route.test.ts` → **83/83 passed** (not independently re-run in this review pass due to shell harness `(cd ...; cmd)` parse error).
- `027` remains the canonical combined `team_invites` + `deletion_requests` migration; `033` is a surgical repair for the invites table only.
- No code changes were made in this review pass.