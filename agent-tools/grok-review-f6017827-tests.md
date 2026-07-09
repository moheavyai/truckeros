# Test Coverage Review: Dev Account Switcher + `team_member_profiles.permissions`

**Scope:** `agent-tools/grok-impl-summary-f6017827.md`  
**Implementation:** `components/DevAccountSwitcher.tsx`, `lib/dev-account-switch.ts`, `app/api/dev/switch-user/route.ts`, `app/api/admin/migrate/route.ts`, `scripts/apply-migrations.mjs`, `lib/team-member-profiles-api.ts`  
**Date:** 2026-07-08

---

## Test Run (verified)

```bash
npx vitest run lib/dev-account-switch.test.ts app/api/dev/switch-user/route.test.ts app/api/admin/migrate/route.test.ts lib/team-member-profiles-api.test.ts lib/migrations.test.ts app/profile/profile-ui.test.ts
```

**Result:** **117/117 passing**

| File | Tests | Behavioral vs source-grep |
|------|-------|---------------------------|
| `lib/dev-account-switch.test.ts` | 5 | 5 behavioral (mocked Supabase) |
| `app/api/dev/switch-user/route.test.ts` | 5 | 5 behavioral, but org/allowlist helpers fully mocked |
| `app/api/admin/migrate/route.test.ts` | 17 | 17 behavioral (mocked admin + `runMigrationSql`) |
| `lib/team-member-profiles-api.test.ts` | 33 | 32 behavioral + 1 new insert-permissions test |
| `lib/migrations.test.ts` | 18 | 18 SQL/manifest string assertions |
| `app/profile/profile-ui.test.ts` | 39 | ~39 source-inspection (`readFileSync` + `toContain`) |

---

## Coverage Assessment

### Well covered (behavioral)

| Area | Evidence |
|------|----------|
| Owner always allowed (`isDevSwitchEmailAllowed`) | `lib/dev-account-switch.test.ts:33-37` |
| Allowlist seeds owner + actor without org DB calls | `lib/dev-account-switch.test.ts:39-48` |
| Admin client used for org roster allowlist when provided | `lib/dev-account-switch.test.ts:51-95` |
| Org resolution: `member_profiles` first, roster fallback | `lib/dev-account-switch.test.ts:97-144` |
| Switch-user happy path + 401/403/404 guards | `app/api/dev/switch-user/route.test.ts` |
| GET migrate detects missing `team_member_profiles.permissions` | `app/api/admin/migrate/route.test.ts:115-138` |
| Roster insert includes `permissions` payload | `lib/team-member-profiles-api.test.ts:1221-1247` |
| Migration 031 SQL + manifest entry | `lib/migrations.test.ts:245-251` |

### Source-grep only (limited behavioral value)

| Area | Evidence |
|------|----------|
| Dev switcher wired in header | `app/profile/profile-ui.test.ts:669-686` |
| Switch-back button string present | `app/profile/profile-ui.test.ts:684` |
| Roster table referenced in switcher source | `app/profile/profile-ui.test.ts:685` |

Per `app/profile/profile-ui.test.ts:1-6`, runtime UI behavior (button visibility, controlled select value, redirect, localStorage) is explicitly out of scope until RTL is adopted.

---

## Open Issues

### 1. Owner fast-path not exercised at API layer when allowlist omits owner

| Field | Value |
|-------|-------|
| **Severity** | bug |
| **File:line** | `app/api/dev/switch-user/route.test.ts:158-159` |
| **Description** | The “team member switches back to primary owner” test mocks `fetchDevSwitchAllowlistEmails` to return a `Set` that **includes** `andrehampton1@outlook.com`. The fix’s critical behavior is `isDevSwitchEmailAllowed` permitting the base owner even when the org-derived allowlist does not. That bypass is unit-tested in `lib/dev-account-switch.test.ts:33-37` but never wired through the POST handler with an allowlist that excludes the owner. |
| **Suggestion** | Re-run the switch-back test with `fetchDevSwitchAllowlistEmails` mocked to `new Set(['driver@example.com'])` only; assert `POST` returns 200 and `generateLink` is called for the owner email. |
| **Status** | open |

---

### 2. Team member without `member_profiles` row not tested through switch-user route

| Field | Value |
|-------|-------|
| **Severity** | bug |
| **File:line** | `app/api/dev/switch-user/route.test.ts:10-16` |
| **Description** | Route tests partially mock `@/lib/dev-account-switch`, stubbing `resolveDevSwitchOrganizationId` and `fetchDevSwitchAllowlistEmails`. The original production failure was team-member sessions blocked because `getAuthenticatedMemberProfile` required a `member_profiles` row. Org resolution fallback is tested in `lib/dev-account-switch.test.ts:115-144`, but no route test proves a roster-only actor can complete a switch without mocking away org resolution. |
| **Suggestion** | Add a route test that uses `importOriginal` for `resolveDevSwitchOrganizationId` (or unmocked module), with `createAuthedSupabaseClient` returning a client whose `member_profiles` query returns null and `team_member_profiles` returns `organization_id`. Assert 200 for an allowlisted target. |
| **Status** | open |

---

### 3. No regression guard that switch-user dropped `getAuthenticatedMemberProfile`

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:line** | `app/api/dev/switch-user/route.test.ts:1` |
| **Description** | `app/api/dev/switch-user/route.ts` no longer imports `getAuthenticatedMemberProfile`, but tests do not assert this contract. A future refactor could reintroduce the member-profile gate and block roster-only users while all existing mocks still pass. |
| **Suggestion** | Add a source assertion in `route.test.ts` that `route.ts` does not reference `getAuthenticatedMemberProfile`, or add an integration test where `getAuthenticatedMemberProfile` would throw and the route still succeeds. |
| **Status** | open |

---

### 4. DevAccountSwitcher UI behaviors beyond string presence are untested

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:line** | `app/profile/profile-ui.test.ts:669-686` |
| **Description** | Dev switcher coverage is four `toContain` checks on `DevAccountSwitcher.tsx` source. Missing assertions for: `selectValue` fallback to `DEV_BASE_OWNER_EMAIL` when current email not in options (`DevAccountSwitcher.tsx:122-125`), `canSwitchBackToOwner` gating (`:128-129`), `localStorage.removeItem(DEV_TEST_PERSONA_STORAGE_KEY)` on owner switch (`:162-163`), roster org fallback query (`linked_user_id` / `driver_email.or`, `:68-76`), and owner-first `(owner)` label (`:197`). |
| **Suggestion** | Add targeted source slices (same pattern as other `profile-ui` tests) for each behavior, or extract `buildDevSwitcherOptions` (`DevAccountSwitcher.tsx:16-31`) to `lib/dev-account-switch.ts` and unit-test option ordering/deduping. |
| **Status** | open |

---

### 5. `buildDevSwitcherOptions` pure logic has no unit tests

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File:line** | `components/DevAccountSwitcher.tsx:16-31` |
| **Description** | Owner-first ordering, deduplication, and inclusion of stored persona/current email are implemented in a local helper with no direct tests. Regressions (e.g. owner not first, duplicate options) would only surface via manual UI testing. |
| **Suggestion** | Export to a testable module or duplicate test cases in `lib/dev-account-switch.test.ts` after extraction. |
| **Status** | open |

---

### 6. POST migrate targeted 031 fallback is untested

| Field | Value |
|-------|-------|
| **Severity** | bug |
| **File:line** | `app/api/admin/migrate/route.test.ts:304-320` |
| **Description** | `app/api/admin/migrate/route.ts:279-283` runs `runMigrationSql(MIGRATION_031_SQL)` when `team_member_profiles.permissions` remains missing after the consolidated migration. Existing POST tests cover full apply success, partial success for other columns, and thrown errors—but none simulate “consolidated SQL applied, permissions still missing, then 031 applied.” |
| **Suggestion** | Mock `runMigrationSql` to resolve, mock `getSchemaStatus` to return missing `team_member_profiles.permissions` on first call and complete schema on second; assert `runMigrationSql` called twice and second arg contains `ADD COLUMN IF NOT EXISTS permissions`. |
| **Status** | open |

---

### 7. GET migrate does not assert `migration031Sql` in response

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:line** | `app/api/admin/migrate/route.test.ts:90-112` |
| **Description** | `GET` handler returns `migration031Sql` (`route.ts:205`) for manual remediation, but tests only assert `requiredColumns` includes `team_member_profiles.permissions`. Clients relying on the 031 SQL payload are unverified. |
| **Suggestion** | In the “schema is complete” GET test, add `expect(body.migration031Sql).toContain('ADD COLUMN IF NOT EXISTS permissions')`. |
| **Status** | open |

---

### 8. `scripts/apply-migrations.mjs` 031 fallback has no automated tests

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:line** | `scripts/apply-migrations.mjs:120-127` |
| **Description** | The script’s targeted permissions fix (apply 031 when full consolidated SQL fails and `team_member_profiles` schema check was not ok) is documented as the production remediation path but has zero unit/integration tests. Regression would only be caught by manual `node scripts/apply-migrations.mjs` runs. |
| **Suggestion** | Extract fallback decision into a testable function (e.g. `shouldApplyPermissionsFix(beforeSchema, migrationError)`) or add a small mocked pg-client test file. |
| **Status** | open |

---

### 9. Roster **update** path with permissions payload is untested

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:line** | `lib/team-member-profiles-api.test.ts:1147-1214` |
| **Description** | `createOrUpdateRosterMemberForUser` sets up `mockRosterUpdate` but only the insert branch is tested (`:1221-1247`). The update branch (`team-member-profiles-api.ts:496-519`) that writes `permissions` on existing roster rows is unverified. “Save New Member” insert fix is covered; editing an existing member’s permissions is not. |
| **Suggestion** | Add test calling `createOrUpdateRosterMemberForUser` with `id: 'roster-1'` and `permissions`; assert `mockRosterUpdate` payload includes parsed permissions. |
| **Status** | open |

---

### 10. `member_profiles` row with null `organization_id` not covered in org resolution

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:line** | `lib/dev-account-switch.test.ts:115-118` |
| **Description** | Roster fallback test uses `member_profiles` returning `data: null`. Implementation checks `memberProfile?.organization_id` (`dev-account-switch.ts:21`), so a row with `{ organization_id: null }` should also fall through to `team_member_profiles`. That intermediate state is untested. |
| **Suggestion** | Add case: `mockFromChain({ data: { organization_id: null }, error: null })` for `member_profiles`, roster returns `org-roster`; expect `org-roster`. |
| **Status** | open |

---

### 11. Org resolution without actor email (linked_user_id only) untested

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:line** | `lib/dev-account-switch.test.ts:97-144` |
| **Description** | `resolveDevSwitchOrganizationId` uses `eq('linked_user_id', userId)` when `actorEmail` is missing (`dev-account-switch.ts:32-34`). All tests pass a non-empty email. Team members with null/empty session email would hit the alternate query path with no coverage. |
| **Suggestion** | Add test with `actorEmail: null` or `undefined`, assert roster query uses `linked_user_id` filter only. |
| **Status** | open |

---

### 12. Allowlist RLS-gap scenario (no admin client, empty authed results) untested

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:line** | `lib/dev-account-switch.test.ts:51-95` |
| **Description** | Design calls for `supabaseAdmin` bypass when building org email lists (`fetchDevSwitchAllowlistEmails` with `adminClient`). Tests cover admin-client success and null-org short-circuit, but not the failure mode where `adminClient` is omitted and the authed client returns empty roster/member rows (simulating RLS blocking). Route passes `adminClient: supabaseAdmin` (`route.ts:75`), so this is lower risk for switch-user, but the helper’s degraded path is unverified. |
| **Suggestion** | Test `fetchDevSwitchAllowlistEmails` with org id, no `adminClient`, authed `from` returning `{ data: [], error: null }` for both tables; assert allowlist is owner + actor only. |
| **Status** | open |

---

### 13. `isDevSwitchEmailAllowed` negative case missing at unit layer

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File:line** | `lib/dev-account-switch.test.ts:33-37` |
| **Description** | Unit tests assert owner is always allowed but do not assert a non-owner email absent from the allowlist is rejected. Route test covers 403 (`route.test.ts:66-96`) but with mocked allowlist helper, not the real `isDevSwitchEmailAllowed` + `fetchDevSwitchAllowlistEmails` combination. |
| **Suggestion** | Add `expect(isDevSwitchEmailAllowed('stranger@example.com', new Set(['driver@example.com']))).toBe(false)`. |
| **Status** | open |

---

### 14. Profile UI dev-switcher `team_member_profiles` assertion is too shallow

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File:line** | `app/profile/profile-ui.test.ts:685` |
| **Description** | `expect(switcherSource).toContain('team_member_profiles')` passes if the string appears anywhere (e.g. roster email load) but does not verify the org-resolution fallback block (`!orgId` branch with `linked_user_id` / `driver_email` OR). A refactor that removed fallback while keeping roster list load would still pass. |
| **Suggestion** | Assert source slice around `if (!orgId)` includes `.or(` and `linked_user_id.eq.${session.user.id}`. |
| **Status** | open |

---

### 15. No live/integration test for permissions column after migration apply

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File:line** | `lib/team-member-profiles-api.live.test.ts:1` |
| **Description** | Implementation summary documents live verification via `node scripts/apply-migrations.mjs`, but no automated live test asserts `team_member_profiles.permissions` exists or that insert-with-permissions succeeds against a real DB. `lib/team-member-profiles-api.live.test.ts` exists for other flows but does not cover this regression. |
| **Suggestion** | Extend live test suite (gated by env) to insert a roster row with `permissions` after schema check, or assert column via admin `select('permissions')`. |
| **Status** | open |

---

## Summary by Severity

| Severity | Open |
|----------|------|
| bug | 3 |
| suggestion | 9 |
| nit | 3 |
| **Total open** | **15** |

---

## Verdict

**Conditional approve** — All 117 targeted tests pass and core helpers (`dev-account-switch`, permissions insert, GET schema detection, migration 031 SQL) have solid **behavioral** unit coverage.

Gaps that matter most before relying on CI alone:

1. **Owner switch-back at API layer** when allowlist excludes owner (#1) — the primary fix path is only half-proven (unit yes, route no).
2. **Roster-only team member** through `/api/dev/switch-user` without mocked org resolution (#2) — the original blocker scenario.
3. **POST migrate 031 fallback** (#6) — mirrors the manual script path that actually fixed production schema.

UI switch-back remains **source-grep only** (#4, #14); acceptable per project convention but insufficient to catch controlled-select or localStorage regressions.

Manual smoke test from implementation summary (owner → team member → switch back; roster save with permissions) remains necessary for end-to-end confidence.