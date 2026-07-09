# Tests Specialist Review — team_invites Migration + Team Roster UI

**Status:** open  
**Scope:** Migration `033_team_invites_table.sql` repair path, admin migrate integration, CLI fallback, roster action relocation to member edit card  
**Implementation:** `agent-tools/grok-impl-summary-a1ba6084.md`  
**Primary files:** `lib/admin-migrate-team-invites.ts`, `supabase/migrations/033_team_invites_table.sql`, `app/api/admin/migrate/route.ts`, `scripts/apply-migrations.mjs`, `app/profile/page.tsx`  
**Test files reviewed:**

| File | Style | Tests |
|------|-------|-------|
| `lib/admin-migrate-team-invites.test.ts` | Unit (mocked deps) | 5 |
| `lib/admin-migrate-permissions.test.ts` | Unit (parity reference for 031) | 5 |
| `lib/migrations.test.ts` | SQL/manifest inspection | 20 |
| `app/api/admin/migrate/route.test.ts` | Route integration (mocked DB/auth) | 21 |
| `app/profile/profile-ui.test.ts` | Static source inspection | 40 |
| `lib/team-invites.test.ts` | Unit | 9 |
| `lib/team-invite-helpers.test.ts` | Unit + fetch mock | 5 |
| `app/api/team-invites/route.test.ts` | Route integration | 5 |

**Related (not in impl summary suite):** `lib/member-profile-permissions.test.ts` (`canDeleteMember` only; no `canRequestMemberRemoval`)

**Do not fix in this review** — assessment only.

---

## Executive summary

The `team_invites` repair migration follows the established **031 permissions pattern** at the helper layer: idempotent SQL, `apply*IfNeeded` gate, and five unit tests mirroring `admin-migrate-permissions.test.ts`. Migration **033** is registered in the manifest and asserted in `migrations.test.ts`. Roster UI relocation is guarded by an updated **`profile-ui.test.ts`** slice that keeps Re-invite / Delete / Request removal inside `memberEditCardSlice` and out of `teamRosterSectionSlice`.

**Main risks:**

1. **`app/api/admin/migrate/route.test.ts` has rich 031 fallback coverage but zero 033 / `team_invites` integration tests** — the highest-value wiring added in this change is untested at the route layer.
2. **`scripts/apply-migrations.mjs` has no automated tests** — duplicate detection logic (`isTeamInvitesTablePossiblyMissing`) can drift from `lib/admin-migrate-team-invites.ts`.
3. **`teamInvitesTableMissing` ignores `team_invites.status`** even though `SCHEMA_CHECKS` includes `status` — partial schema corruption may not trigger repair.
4. **Roster UI tests confirm placement via string presence**, not guard expressions (`showMemberCardActions`, self/new-member exclusions, Permit Clerk vs Owner delete split).
5. **`canRequestMemberRemoval` has no unit tests** — Permit Clerk “Request removal” card action relies on untested permission helper.
6. **No render/integration test** for edit card → re-invite/delete flows (accepted project limitation; manual checklist is primary QA).

**Verified locally:** 100 tests passed across the 8 files above (impl summary cited 83 in 6 files — excludes `route.test.ts` and `team-invite-helpers.test.ts`).

Estimated coverage: **~60% of critical paths** (helper + SQL strong; route/CLI integration and roster guard logic weak).

---

## 1. Migration 033 — `team_invites` repair

### What is covered

| Case | Test location |
|------|---------------|
| `033_team_invites_table.sql` in `MIGRATION_FILES` | `migrations.test.ts` |
| SQL contains `CREATE TABLE IF NOT EXISTS team_invites` | `migrations.test.ts` (027 + 033) |
| SQL references `027_team_invites_and_deletion_requests.sql` | `migrations.test.ts` (033) |
| SQL ends with `NOTIFY pgrst, 'reload schema'` | `migrations.test.ts` (033) |
| `getMigration033Sql()` export wired | `migrations.test.ts` |
| `teamInvitesTableMissing` for `organization_id` / `invite_token` keys | `admin-migrate-team-invites.test.ts` |
| Inconclusive `team_invites` table check → possibly missing | Same |
| Skip when schema complete | Same |
| Run SQL when table missing; `applied: true` after re-check | Same |
| Run SQL when inconclusive; `applied: true` after re-check | Same |

### Gaps

| Priority | Gap | Risk | Suggested test |
|----------|-----|------|----------------|
| **P0** | **No route tests for 033 fallback** — POST does not assert second `runMigrationSql` call with 033 SQL, `teamInvitesMigrationAttempted` / `teamInvitesMigrationApplied`, or catch-path recovery (031 has 4 dedicated tests) | Live DB repair silently regresses; primary fix unguarded | Mirror `applies migration 031 when permissions column remains missing` for `team_invites` |
| **P0** | **GET does not assert `team_invites` in `requiredColumns` or `migration033Sql` in response** | Admin UI cannot verify repair SQL exposure | GET with `mockSchemaComplete`: expect `team_invites.organization_id` in `requiredColumns`, `migration033Sql` contains `CREATE TABLE IF NOT EXISTS team_invites` |
| **P1** | **`teamInvitesTableMissing` omits `team_invites.status`** — `SCHEMA_CHECKS` lists `status` but helper only checks `organization_id` and `invite_token` | Table exists with missing `status` column → migration skipped, API still fails | Unit: `teamInvitesTableMissing(['team_invites.status'])` → `true`; or document intentional (CREATE TABLE IF NOT EXISTS won't add columns) |
| **P1** | **`applied: false` when SQL runs but schema still broken** | Partial apply reported as success path untested | Unit: `applyTeamInvitesMigrationIfNeeded` with after-check still missing → `{ attempted: true, applied: false }` |
| **P1** | **033 SQL content depth** — no assertions for RLS policies, indexes, `ENABLE ROW LEVEL SECURITY` | Repair migration could ship table without policies | Extend `migrations.test.ts` 033 block: `idx_team_invites_token`, `"Org managers can view team invites"` |
| **P2** | **`scripts/apply-migrations.mjs` untested** | CLI path diverges from API helper | Extract shared detector or add small Node test for `isTeamInvitesTablePossiblyMissing` message matching |
| **P2** | **Catch-path `teamInvites` error swallowed** — route logs `POST team_invites fallback` but no test | Failed 033 in catch block invisible to consumers | Route test: full migration throws, 033 throws → `teamInvitesMigrationAttempted` true, `applied` false |

### Migration repair matrix

| Scenario | Helper unit | Route GET | Route POST | CLI script |
|----------|-------------|-----------|------------|------------|
| Table fully missing | ✅ | ❌ | ❌ | ❌ |
| Inconclusive table check | ✅ | ❌ | ❌ | ❌ |
| Schema complete (skip) | ✅ | ❌ | ❌ | ❌ |
| Missing after targeted 033 | ❌ | ❌ | ❌ | ❌ |
| Full migration throws → 033 fallback | ❌ | ❌ | ❌ | ❌ |
| Only `status` column missing | ❌ (detector gap) | ❌ | ❌ | ❌ |

---

## 2. Admin migrate route — parity with 031

### What is covered (031 reference — not part of this change but sets the bar)

| Case | Test |
|------|------|
| GET flags missing `team_member_profiles.permissions` | `route.test.ts` |
| GET inconclusive `team_member_profiles` | `route.test.ts` |
| POST applies 031 after full migration when permissions still missing | `route.test.ts` |
| POST 031 on inconclusive check | `route.test.ts` |
| POST recovers via 031 when full migration throws | `route.test.ts` |
| Response fields `permissionsMigrationAttempted` / `Applied` | `route.test.ts` |

### Gaps specific to `team_invites`

| Priority | Gap | Suggested test |
|----------|-----|----------------|
| **P0** | Entire 031-equivalent suite for 033 | Copy 031 test structure; mock `team_invites` select errors |
| **P1** | GET missing `team_invites.organization_id` → `missingColumns` contains key | Mock `from('team_invites')` schema-cache error |
| **P1** | GET inconclusive `team_invites` → `inconclusiveChecks: ['team_invites']` | Permission-denied style error |
| **P2** | POST response includes `migration033Sql` on `needsManualRun` | No-DB-connection POST body assertion |

---

## 3. Team Roster UI — action relocation

### What is covered

| Case | Test |
|------|------|
| `Member actions` section in member edit card | `profile-ui.test.ts` — `supports save and invite, re-invite...` |
| `Re-invite`, `allowCardReinvite`, `allowCardDelete` in `memberEditCardSlice` | Same |
| `Request removal` label in member card | Same |
| `showMemberCardActions` symbol in page | Same |
| `Re-invite` / `Request removal` **not** in `teamRosterSectionSlice` | Same |
| Roster Actions column still has `Edit` | Same (`rosterSection).toContain('Edit')`) |
| `canReinviteMember`, `handleReinviteMember`, `createTeamInviteViaApi` wired | Same (global source) |
| `confirmDeleteMember`, delete modal strings | `profile-ui.test.ts` — `confirms delete...` |
| `canReinviteMember` rules (contact, not owner/self) | `team-invite-helpers.test.ts` |
| `canDeleteMember` (owner vs driver) | `member-profile-permissions.test.ts` |
| Re-invite API error path | `team-invite-helpers.test.ts` — `createTeamInviteViaApi` |

### Gaps

| Priority | Gap | Risk | Suggested test |
|----------|-----|------|----------------|
| **P1** | **`rosterSection` does not assert absence of `Delete`** — only Re-invite / Request removal excluded | Delete button could reappear in table undetected | `expect(rosterSection).not.toContain('Deleting...')` and `.not.toContain('Delete')` |
| **P1** | **`showMemberCardActions` guard not sliced** — impl requires `editingMember != null`, `editingTarget.kind !== 'self'`, `!isNewTeamMemberTarget` | Self-edit or new-member flows could show Member actions | UI slice around `const showMemberCardActions` with three conditions |
| **P1** | **`editingMember` resolution untested** — `teamMembers.find` + `memberListKey` | Wrong member targeted for card actions | `expect(source).toMatch(/editingMemberKey != null[\s\S]*memberListKey/)` |
| **P1** | **Permit Clerk mutual exclusion** — `allowCardRequestRemoval && !allowCardDelete` in JSX | Both Delete and Request removal visible | `memberCard` slice: `allowCardRequestRemoval && !allowCardDelete` |
| **P1** | **`canRequestMemberRemoval` untested** | Permit Clerk card action may show/hide incorrectly | Unit tests in `member-profile-permissions.test.ts` (Permit Clerk actor, deletable target) |
| **P2** | **`allowCardRequestRemoval` symbol not asserted** — only button label | Rename/refactor breaks guard silently | `expect(source).toContain('allowCardRequestRemoval')` |
| **P2** | **`handleReinviteMember(editingMember)` from card** — not sliced | Re-invite could wire wrong member | `memberCard` contains `handleReinviteMember(editingMember)` |
| **P2** | **`deleteCandidateIsRequest` flow from card** | Request removal vs delete modal conflation | Slice: Request removal sets `setDeleteCandidateIsRequest(true)` |
| **P2** | **Stale test name** — `renders team roster with add, edit, and delete actions` still titled “delete” but roster no longer has delete | Misleading maintenance signal | Rename to `add and edit only`; add negative Delete assertion |
| **P3** | **`editingMemberInviteContact` + `resolveMemberInviteContact` wiring in page** | Re-invite disabled when contact missing | Slice: `resolveMemberInviteContact(editingMember, orgMemberRows, teamRosterRows)` |
| **P3** | **Disabled states** — `reinvitingMemberKey === editingMemberKey`, `deletingId === editingMember.id` | Double-submit / UX | memberCard slice for `disabled={` guards |

### Roster UI visibility matrix

| Actor / target | Expected UI | Source tested | Guard sliced |
|----------------|-------------|---------------|--------------|
| Owner edits other member | Re-invite + Delete in card | ✅ placement | ❌ |
| Permit Clerk edits other | Request removal (not Delete) | ⚠️ label only | ❌ |
| Edit self | No Member actions | ❌ | ❌ |
| + Add New Member | No Member actions; Save and Invite instead | ⚠️ partial (`showSaveAndInviteButton`) | ❌ |
| Roster table row | Edit only | ✅ | ✅ (partial) |
| Member without email/phone | No Re-invite | ❌ | ❌ |

---

## 4. Team invites API & helpers (regression context)

### What is covered

Existing suite remains green; not modified by this change but provides baseline when migration applied:

| Case | Test |
|------|------|
| Invite token generation, link building, validation | `team-invites.test.ts` |
| POST auth, Owner role rejection | `route.test.ts` |
| `resolveInviteRoleFromMemberRoles`, `resolveMemberInviteContact` | `team-invite-helpers.test.ts` |

### Gaps (unchanged, relevant post-migration)

| Priority | Gap | Note |
|----------|-----|------|
| **P2** | No test simulating PostgREST “relation team_invites does not exist” | Would document pre-033 failure mode |
| **P3** | Accept flow (`app/api/team-invites/accept/route.test.ts`) not in cited suite | Out of scope unless expanding CI bundle |

---

## 5. Test quality & methodology

### Strengths

- **Symmetry with 031** — `admin-migrate-team-invites.test.ts` is a deliberate copy of the permissions helper test shape; easy to maintain.
- **Idempotent SQL guarded** — manifest + `getMigration033Sql` + `CREATE TABLE IF NOT EXISTS` assertions prevent orphan files.
- **Roster regression slice** — explicit negative assertions that Re-invite / Request removal left the table section.
- **Invite permission helpers** — `canReinviteMember` has focused unit tests independent of the 3k-line page.
- **Profile UI documents RTL limitation** in file header (accepted project pattern).

### Weaknesses

1. **Route integration stops at 031** — new `applyTeamInvitesMigrationIfNeeded` wiring in `route.ts` is production-critical but test-free.
2. **Two implementations of “possibly missing”** — TypeScript helper vs `.mjs` string matching; no contract test between them.
3. **Status column blind spot** in `teamInvitesTableMissing` vs three-column `SCHEMA_CHECKS`.
4. **UI tests = string archaeology** — placement verified; role-based visibility and guard boolean logic not sliced.
5. **`canRequestMemberRemoval` zero coverage** — new card action depends on it.
6. **Impl summary manual checklist (8 steps)** has no automated counterpart.

---

## 6. Recommended test additions (minimal high-ROI set)

If adding only **8 tests**:

1. **Route POST:** Missing `team_invites` after full migration → second SQL call with 033 repair marker; `teamInvitesMigrationApplied: true`.
2. **Route POST:** Full migration throws → 033 fallback attempted (mirror 031 recovery test).
3. **Route GET:** `migration033Sql` present; `requiredColumns` includes `team_invites.organization_id`.
4. **Route GET:** Mock missing `team_invites` → `needsMigration: true`, `missingColumns` contains `team_invites.invite_token` or table key.
5. **Unit:** `applyTeamInvitesMigrationIfNeeded` returns `{ attempted: true, applied: false }` when after-check still fails.
6. **Unit:** `teamInvitesTableMissing(['team_invites.status'])` — either expect `true` (and fix helper) or document why `false` is acceptable.
7. **UI slice:** `showMemberCardActions` three-part guard + `rosterSection.not.toContain('Delete')`.
8. **Unit:** `canRequestMemberRemoval` — Permit Clerk can request, Owner uses delete path (`canDeleteMember` true → request false).

---

## 7. Suggested follow-up checklist

- [ ] Add 033 parity tests to `app/api/admin/migrate/route.test.ts` (mirror existing 031 block).
- [ ] Extend `migrations.test.ts` 033 assertions for indexes + RLS policy names.
- [ ] Add `canRequestMemberRemoval` tests to `member-profile-permissions.test.ts`.
- [ ] Tighten `profile-ui.test.ts` roster test: rename, assert Delete absent from roster slice, slice `showMemberCardActions` guards.
- [ ] Resolve or test `team_invites.status` detector gap in `teamInvitesTableMissing`.
- [ ] Add CLI smoke test or extract shared schema-missing detector used by `.mjs` and TS.
- [ ] Run impl summary manual roster checklist (steps 1–8) before closing ticket.
- [ ] (Future) RTL harness for edit card → re-invite → success message once adopted project-wide.

---

## Verdict

**Approve helper + SQL unit layer; do not treat green suite as proof of live DB repair or roster role-gating.**

The new `applyTeamInvitesMigrationIfNeeded` helper and migration 033 registration are **adequately tested in isolation** and follow a proven pattern. The **largest gap** is **route-level integration**: `route.test.ts` thoroughly exercises migration 031 but has **no equivalent for 033**, despite `route.ts` now calling `applyTeamInvitesMigrationIfNeeded` in success and catch paths. Roster UI tests **correctly lock action placement** (card vs table) but **do not slice permission guards** that drive Owner vs Permit Clerk behavior or self/new-member exclusions.

**Status:** open — coverage gaps documented; no code changes made.