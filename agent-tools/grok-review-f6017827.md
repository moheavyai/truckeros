# Re-Review — Effort 4 (f6017827)

**Date:** 2026-07-08  
**Scope:** Dev account switcher + `team_member_profiles.permissions` repair migration  
**Verdict:** All 30 prior review issues are properly fixed. No regressions found. Four minor follow-ups remain.

---

## Re-Review Summary

Independent verification of the implementer's review pass:

| Area | Result |
|------|--------|
| Migration numbering (`031` permissions / `032` bootstrap RLS) | ✅ Fixed — single canonical `031`, bootstrap renamed to `032`, manifest + scripts aligned |
| Admin migrate `031` recovery (success + catch paths) | ✅ Fixed — `lib/admin-migrate-permissions.ts` shared helper; structured response fields |
| Dev switcher persona/session, security, org resolution | ✅ Fixed — session preferred, owner bypass gated to `isDevEnvironment()`, redirect host restricted |
| Roster permissions write gate (primary owner) | ✅ Fixed — `createOrUpdateRosterMemberForUser` writes permissions for primary owner |
| Test coverage (route, helper, migration, UI source) | ✅ Expanded — 136 tests across 7 files, all passing |

### Test verification (re-run)

```text
npx vitest run lib/dev-account-switch.test.ts lib/admin-migrate-permissions.test.ts \
  app/api/dev/switch-user/route.test.ts app/api/admin/migrate/route.test.ts \
  lib/team-member-profiles-api.test.ts lib/migrations.test.ts app/profile/profile-ui.test.ts

→ 7 files, 136 tests passed
```

### Prior issues disposition

All 30 issues from the first review pass are **verified fixed**. They are not re-listed here per re-review instructions.

---

## New Issues (Post-Fix)

### Issue 31 — Severity: suggestion
- **File**: `scripts/apply-migrations.mjs:127-151`
- **Description**: Targeted `031` permissions SQL runs only in the `catch` block when the full consolidated migration throws. The API route (`app/api/admin/migrate/route.ts:317-323`) also runs `applyTeamMemberPermissionsMigrationIfNeeded` after a **successful** full migration when the schema check still reports `permissions` missing (e.g. PostgREST cache lag). The CLI script has no equivalent post-success fallback, so `node scripts/apply-migrations.mjs` can exit non-zero even when a second targeted apply would succeed.
- **Suggestion**: After successful `client.query(sql)`, re-check schema and apply `permissionsFixSql` when `permissions` is still missing — mirror `applyTeamMemberPermissionsMigrationIfNeeded`.
- **Status**: fixed
- **Response**: Added `applyPermissionsFixIfNeeded()` in `scripts/apply-migrations.mjs`; runs after successful full migration and in catch path using shared `isTeamMemberPermissionsPossiblyMissing()` detection.

### Issue 32 — Severity: suggestion
- **File**: `lib/admin-migrate-permissions.ts:22-24`, `app/api/admin/migrate/route.ts:122-129`
- **Description**: When a schema check returns `inconclusive: true` (unrecognized Supabase error, no column name in message), `getSchemaStatus()` omits that table from `missingColumns`. `applyTeamMemberPermissionsMigrationIfNeeded` then skips targeted `031` because `permissionsColumnMissing([])` is false — even if `team_member_profiles.permissions` is actually absent. This is the correct tradeoff vs. false-positive DDL (issue 20), but leaves a gap for ambiguous errors.
- **Suggestion**: Treat `team_member_profiles` inconclusive checks as "permissions possibly missing" (attempt `031` or surface `inconclusiveChecks` in POST response with `permissionsMigrationAttempted: false` and explicit guidance to run manual `migration031Sql`).
- **Status**: fixed
- **Response**: Added `permissionsColumnPossiblyMissing()` — treats `team_member_profiles` in `inconclusiveChecks` as trigger for targeted `031`; `needsMigration` now includes inconclusive checks.

### Issue 33 — Severity: suggestion
- **File**: `app/api/admin/migrate/route.test.ts`
- **Description**: `checkTableColumns` inconclusive path (`columnsExist: null`, `inconclusiveChecks` populated) has no test coverage. `needsMigration` can be `false` while `columnsExist` is `false`, which may confuse admin UI consumers.
- **Suggestion**: Add GET/POST tests mocking an unrecognized `team_member_profiles` error (e.g. generic RLS failure) and assert `inconclusiveChecks`, `columnsExist`, and `needsMigration` values.
- **Status**: fixed
- **Response**: Added GET test for inconclusive `team_member_profiles` (`needsMigration: true`, empty `missingColumns`) and POST test verifying `031` attempt on inconclusive check.

### Issue 34 — Severity: suggestion
- **File**: `app/api/dev/switch-user/route.ts:18-37`, `app/api/dev/switch-user/route.test.ts`
- **Description**: `appBaseUrl` rejects non-local `x-forwarded-host` when `NEXT_PUBLIC_APP_URL` is unset (issue 11 fix), but no route test exercises this path. Regression could re-open redirect manipulation on shared dev hosts.
- **Suggestion**: Add test: unset `NEXT_PUBLIC_APP_URL`, send `x-forwarded-host: evil.example.com`, assert 500 with safe message and no `generateLink` call.
- **Status**: fixed
- **Response**: Added route test asserting 500 with `NEXT_PUBLIC_APP_URL` message and no `generateLink` when `x-forwarded-host` is non-local.

---

## Notes (No Action Required)

- **`viewingAs` logic** (`components/DevAccountSwitcher.tsx:173-180`): Inner `if (storedPersona && storedPersona !== normalizedCurrentEmail)` branch is redundant — both branches return `normalizedCurrentEmail`. Behavior is correct; could be simplified to a single return.
- **Roster `isPrimaryOwner` gate** (`lib/team-member-profiles-api.ts:494`): Explicit `|| isPrimaryOwner(actorProfile)` is defensive; `canManageMemberPermissions` already returns true for `is_primary_owner` via `hasOwnerOrAdminRole`. Harmless clarity improvement.
- **`getMigration032Sql()`**: Exposed in `lib/migrations.ts` and covered by tests; not surfaced in admin migrate manual payload (only `migration031Sql`). Acceptable because `032` is included in consolidated `sql`.

---

## Conclusion

The implementer correctly addressed all 30 original findings. Migration numbering, admin migrate resilience, dev switcher security, persona/session handling, and test coverage are in good shape. Remaining items are parity and edge-case hardening — none block merge for the stated goals (owner switch-back + permissions column repair).

---

## Re-Review Follow-Up Implementation Summary (Issues 31–34)

### Changes

| File | Change |
|------|--------|
| `scripts/apply-migrations.mjs` | Post-success `applyPermissionsFixIfNeeded()`; catch path uses same helper |
| `lib/admin-migrate-permissions.ts` | `permissionsColumnPossiblyMissing()` for inconclusive `team_member_profiles` |
| `lib/admin-migrate-permissions.test.ts` | Inconclusive-trigger test (+2 tests) |
| `app/api/admin/migrate/route.ts` | `needsMigration` includes inconclusive checks |
| `app/api/admin/migrate/route.test.ts` | GET/POST inconclusive coverage (+2 tests) |
| `app/api/dev/switch-user/route.test.ts` | Non-localhost redirect rejection test (+1 test) |

### Test results

```text
npx vitest run lib/dev-account-switch.test.ts lib/admin-migrate-permissions.test.ts \
  app/api/dev/switch-user/route.test.ts app/api/admin/migrate/route.test.ts \
  lib/team-member-profiles-api.test.ts lib/migrations.test.ts app/profile/profile-ui.test.ts

→ 7 files, 141 tests passed
```

All 34 review issues (30 original + 4 re-review) are now **fixed**.