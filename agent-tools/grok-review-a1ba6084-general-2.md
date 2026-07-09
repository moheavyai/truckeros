# General Review Pass 2: team_invites Migration + Team Roster Card Actions

**Scope:** `033_team_invites_table.sql`, `lib/admin-migrate-team-invites.ts`, `app/api/admin/migrate/route.ts`, `scripts/apply-migrations.mjs`, `app/profile/page.tsx` (roster Actions → member edit card), related tests  
**Reference:** `agent-tools/grok-impl-summary-a1ba6084.md`  
**Focus:** Live-DB repair path for missing `team_invites`, roster UI relocation of Re-invite/Delete/Request removal, regression risk, operator/manual verification  
**Date:** 2026-07-08  
**Reviewer:** Independent pass 2 (no fixes applied)

---

## Implementation Verification

| Area | Status | Evidence |
|------|--------|----------|
| Idempotent `033` repair migration | **Implemented** | `supabase/migrations/033_team_invites_table.sql` — `CREATE TABLE IF NOT EXISTS team_invites`, indexes, RLS, `NOTIFY pgrst` |
| Manifest + SQL loader | **Implemented** | `lib/migration-manifest.json:21`, `lib/migrations.ts:92–93`, `lib/migrations.test.ts:267–273` |
| Targeted apply helper (031 pattern) | **Implemented** | `lib/admin-migrate-team-invites.ts` mirrors `lib/admin-migrate-permissions.ts` |
| Admin migrate schema check | **Implemented** | `app/api/admin/migrate/route.ts:59–62` — `team_invites` + `organization_id`, `invite_token`, `status` |
| Admin migrate POST apply + catch fallback | **Implemented** | `route.ts:336–342` (post-success), `route.ts:376–388` (catch path) |
| CLI script parity | **Implemented** | `scripts/apply-migrations.mjs:76`, `:113–121`, `:171–175` |
| Roster table Actions column | **Implemented** | `app/profile/page.tsx:2554–2566` — **Edit** only |
| Member edit card actions | **Implemented** | `page.tsx:1834–1856`, `:2401–2443` — gated `Member actions` section |
| Permission reuse (no new rules) | **Implemented** | `canReinviteMember`, `canDeleteMember`, `canRequestMemberRemoval` unchanged; card wires same handlers |
| Source-inspection UI tests | **Updated** | `app/profile/profile-ui.test.ts:659–682` |
| Unit tests for 033 helper | **Present** | `lib/admin-migrate-team-invites.test.ts` (5 tests) |

**Tests (re-run this review):**

```text
npx vitest run \
  lib/admin-migrate-team-invites.test.ts \
  lib/admin-migrate-permissions.test.ts \
  lib/migrations.test.ts \
  app/profile/profile-ui.test.ts \
  lib/team-invites.test.ts \
  app/api/team-invites/route.test.ts

Test Files  6 passed (6)
Tests       83 passed (83)
```

*(Impl summary claim confirmed. `app/api/admin/migrate/route.test.ts` adds 21 additional tests not in the summary list; none cover `033` / `team_invites`.)*

---

## Edge Case Analysis

### `team_invites` migration repair

| Scenario | Behavior | Assessment |
|----------|----------|------------|
| Table entirely missing (`relation "team_invites" does not exist`) | `SCHEMA_CHECKS` marks all three columns missing; `teamInvitesTableMissing` true → `033` runs | **Correct** |
| PostgREST schema-cache stale (inconclusive check) | `teamInvitesTablePossiblyMissing` true → `033` runs | **Correct** |
| Table present, healthy | Helper returns `{ attempted: false, applied: false }` | **Correct** |
| Full consolidated migration throws; only `team_invites` missing | Catch path runs targeted `033` (mirrors fixed `031` pattern) | **Correct** |
| `027` never applied — `deletion_requests` also missing | `033` repairs **only** `team_invites`; no `034`-style repair for `deletion_requests` | **Gap** — see Finding #2 |
| Hypothetical partial table (exists but `status` column missing alone) | `teamInvitesTableMissing` keys off `organization_id` / `invite_token` only, not `status` | **Low-risk gap** — see Finding #3 |

### Team roster card actions

| Scenario | Behavior | Assessment |
|----------|----------|------------|
| Owner/Admin edits another member | Roster shows Edit only; card bottom shows Re-invite and/or Delete per permissions | **Correct** |
| Permit Clerk edits deletable member | Card shows **Request removal** (`allowCardRequestRemoval && !allowCardDelete`) | **Correct** |
| Edit own roster row (`member_profile` target, `is_self`) | `showMemberCardActions` may be true, but all `allowCard*` false → section hidden | **Correct** |
| Self profile edit (`editingTarget.kind === 'self'`) | `showMemberCardActions` false | **Correct** |
| **+ Add New Member** (`id: null`) | `isNewTeamMemberTarget` → no card actions; Save and Invite remains | **Correct** |
| Member without email/phone | `canReinviteMember` false → no Re-invite button | **Correct** |
| Primary owner row | Re-invite and delete both suppressed by permission helpers | **Correct** |
| Re-invite / delete success or error | `setSaveMessage` at page top (`page.tsx:1970–1983`), not inside card | **UX gap** — see Finding #5 |
| Long member form | User must scroll to card bottom for actions; no in-card sticky actions | **UX** — acceptable, not a bug |

---

## Findings

### 1
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `app/api/admin/migrate/route.test.ts` (entire file; cf. `route.ts:336–342`, `:376–388`) |
| **Description** | Admin migrate API tests cover targeted `031` recovery (post-success, inconclusive, catch-path) but have **zero** tests for `033` / `team_invites`. The primary production pain case for this effort — PostgREST errors on `/api/team-invites` when the table is missing — is unverified at the API layer. |
| **Suggestion** | Add POST tests mirroring the `031` trio: (a) full migration succeeds, `team_invites` still missing → second `runMigrationSql` with `033`; (b) inconclusive `team_invites` check → `033` attempted; (c) full migration throws, `team_invites` missing → catch-path `033` sets `teamInvitesMigrationApplied: true`. Extend GET test `requiredColumns` assertion to include `team_invites.organization_id`, `team_invites.invite_token`, `team_invites.status`. |
| **Status** | open |

### 2
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `supabase/migrations/033_team_invites_table.sql:1–94` vs `027_team_invites_and_deletion_requests.sql:111–197` |
| **Description** | Repair migration `033` intentionally duplicates only the `team_invites` slice of `027`. If live DB skipped all of `027`, **Request removal** (Permit Clerk) may still fail against a missing `deletion_requests` table even after `033` succeeds. The impl summary scopes the fix to `team_invites` schema errors; this is a related but unaddressed failure mode. |
| **Suggestion** | Document in operator runbooks that `027` (or a future `034_deletion_requests_table.sql`) may still be required for deletion-request flows. Optionally add `deletion_requests` to `SCHEMA_CHECKS` and a targeted repair migration if production reports that gap. |
| **Status** | open |

### 3
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `lib/admin-migrate-team-invites.ts:16–20` |
| **Description** | `teamInvitesTableMissing` triggers on `team_invites.organization_id` or `team_invites.invite_token` missing, but not on `team_invites.status` alone. `SCHEMA_CHECKS` includes `status`, so a hypothetical partial schema (table exists, `status` column dropped) would report `team_invites.status` in `missingColumns` yet skip targeted `033`. `CREATE TABLE IF NOT EXISTS` makes this unlikely in practice. |
| **Suggestion** | Include `team_invites.status` in `teamInvitesTableMissing`, or treat any `team_invites.*` missing column as a trigger — symmetric with how missing relation marks all three columns. |
| **Status** | open |

### 4
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `app/profile/profile-ui.test.ts:680–681` |
| **Description** | Roster relocation test asserts `rosterSection` does **not** contain `Re-invite` or `Request removal`, but does **not** assert absence of `Delete`. Current source is correct (Delete only in member card), yet a regression re-adding a roster Delete button would not fail this test if the label differed or appeared in a comment. |
| **Suggestion** | Add `expect(rosterSection).not.toContain('allowCardDelete')` and/or `expect(rosterSection).not.toMatch(/Deleting\.\.\.|'Delete'/)` within the roster slice bounds. |
| **Status** | open |

### 5
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `app/profile/page.tsx:1970–1983`, `:2406–2440`, `:1530–1543` |
| **Description** | Re-invite and delete feedback uses page-level `saveMessage` above the member edit card. Member actions live at the **bottom** of a potentially long card. After clicking Re-invite or Delete at the bottom, success/error banners render at the top — easy to miss without scrolling. `handleEditMember` scrolls to top on open (`:912`, `:953`), but action handlers do not. |
| **Suggestion** | Mirror `carrierMessage` pattern or duplicate a compact status line inside the `Member actions` block; optionally `scrollIntoView` the status region after `handleReinviteMember` / `confirmDeleteMember`. |
| **Status** | open |

### 6
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `app/profile/profile-ui.test.ts:1–6`, `:659–682` |
| **Description** | Roster/card placement is verified via static source slices only — no RTL render tests. Runtime concerns (button visibility per role, modal wiring, disabled states during `reinvitingMemberKey`) are not exercised. Accepted project limitation per file header, but manual QA remains mandatory. |
| **Suggestion** | Keep manual checklist (impl summary §4); consider RTL smoke test when harness is adopted: Owner opens edit card → Re-invite visible; roster row has no second action button. |
| **Status** | open |

### 7
| Field | Value |
|-------|-------|
| **Severity** | info |
| **File:Line** | `supabase/migrations/033_team_invites_table.sql` ↔ `027_team_invites_and_deletion_requests.sql:25–109` |
| **Description** | `team_invites` DDL in `033` matches `027` (idempotent `CREATE TABLE IF NOT EXISTS`, same RLS). Intentional duplication following the established `031` permissions repair pattern. No functional issue. |
| **Suggestion** | None required. |
| **Status** | informational |

---

## Manual Verification Checklist

Reproduce impl summary §4 with these pass-2 additions:

1. **Pre-migration** — `GET /api/admin/migrate` as admin: confirm `team_invites.*` columns listed in `requiredColumns`; if missing, `needsMigration: true`.
2. **Apply** — `POST /api/admin/migrate` or `node scripts/apply-migrations.mjs`; confirm response includes `teamInvitesMigrationAttempted` / `teamInvitesMigrationApplied` when applicable.
3. **Post-migration API** — `GET /api/team-invites` with Owner/Admin bearer token returns `{ success: true, data: [...] }` without PostgREST schema-cache errors.
4. **Roster table** — each row Actions column shows **Edit** only (no inline Re-invite/Delete/Request removal).
5. **Member edit card** — Edit eligible member → scroll to **Member actions**:
   - Re-invite (member with email/phone) → success message includes invite link stub text
   - Delete → confirm modal → member removed from roster
6. **Permit Clerk** — Request removal shown instead of Delete on eligible targets.
7. **Self / new member** — no Member actions on self edit or **+ Add New Member** (Save and Invite remains).
8. **Feedback visibility** — after Re-invite at card bottom, confirm whether success banner at page top is noticeable (Finding #5).

---

## Verdict

**Pass-2 verdict:** Both stated goals are **implemented and architecturally sound**.

1. **`team_invites` repair** — Targeted `033` migration, schema detection, admin API + CLI fallback, and helper tests mirror the proven `031` pattern. Catch-path recovery addresses the historical gap where targeted migrations only ran after a successful full migration.

2. **Roster UI** — Re-invite, Delete, and Request removal are correctly relocated into the member edit card with existing permission gates; the roster table retains Edit only. Self/new-member exclusions behave as specified.

**Residual risk** is low for the primary `team_invites` schema error and roster-button regression, concentrated in: (a) missing API-layer tests for `033`, (b) un-repaired `deletion_requests` if `027` was never applied, and (c) UX visibility of action feedback at page top vs. card-bottom actions. None block merge for the scoped fix; manual checklist items 1–7 should pass before calling production repaired.