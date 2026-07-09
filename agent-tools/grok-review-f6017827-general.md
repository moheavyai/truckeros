# Code Review: Dev Account Switcher + `team_member_profiles.permissions`

**Review ID:** f6017827  
**Verdict:** **Approve with minor fixes** — Core requirements are met (auth-gated dev switch, owner switch-back, org fallback for team members, idempotent `permissions` migration, admin/script fallback paths). Two operational gaps should be addressed before relying on this in all environments: conflicting migration `031` filenames and asymmetric `031` fallback between `apply-migrations.mjs` and `POST /api/admin/migrate` when the full consolidated migration throws.

---

## Focus Area Verification

| Area | Result | Notes |
|------|--------|-------|
| Dev switch-user requires auth | ✅ Pass | Bearer token required (`route.ts:34–37`); `getUser()` validates session (`route.ts:48–55`). |
| Owner email always switchable from team-member sessions | ✅ Pass | `isDevSwitchEmailAllowed` short-circuits for `DEV_BASE_OWNER_EMAIL` (`dev-account-switch.ts:82`); allowlist seeds owner (`dev-account-switch.ts:46`); org resolution no longer requires `member_profiles` (`route.ts:66–70`). |
| DevAccountSwitcher controlled select | ⚠️ Partial | Empty disabled option removed; `value` always matches an `<option>` (`DevAccountSwitcher.tsx:122–125, 189–200`). Fallback to owner when current email ∉ `options` can desync from the “viewing as” label (see issue below). |
| “Switch back to owner” button | ✅ Pass | Shown for non-owner sessions (`DevAccountSwitcher.tsx:128–129, 202–213`); calls same `handleSwitch` path; clears `localStorage` persona on owner target (`DevAccountSwitcher.tsx:162–163`). |
| Migration 031 + admin migrate fallback | ⚠️ Partial | `031_team_member_profiles_permissions.sql` is idempotent; `SCHEMA_CHECKS` and POST success-path fallback work (`route.ts:52–54, 279–283`). POST catch path does not apply `031` when full migration throws (see bug below). |
| New Team Member save writes `permissions` | ✅ Pass | Profile UI always includes `permissions` in roster save payload (`page.tsx:1024–1029`); API writes when actor can manage permissions (`team-member-profiles-api.ts:492–494`); insert test covers payload (`team-member-profiles-api.test.ts:1221–1246`). Schema default `{mode:global}` matches migration. |

---

## Issues

### 1

- **Severity:** bug
- **File:Line:** `scripts/apply-migration-031.mjs:29–31`, `supabase/migrations/031_owner_bootstrap_membership_rls.sql:1`, `supabase/migrations/031_team_member_profiles_permissions.sql:1`
- **Description:** Two unrelated migrations share the `031` prefix. The standalone script `apply-migration-031.mjs` applies `031_owner_bootstrap_membership_rls.sql` (org-membership RLS policy), while the manifest, `getMigration031Sql()`, and `apply-migrations.mjs` use `031_team_member_profiles_permissions.sql`. Running `node scripts/apply-migration-031.mjs` will not add the `permissions` column and may give a false sense that “migration 031” is applied.
- **Suggestion:** Rename one migration to the next free number (e.g. `032_owner_bootstrap_membership_rls.sql`), update `apply-migration-031.mjs` to target the permissions file (or rename the script to match its actual SQL), and delete or relocate the orphaned file so only one canonical `031` exists.
- **Status:** open

### 2

- **Severity:** bug
- **File:Line:** `app/api/admin/migrate/route.ts:269–307`
- **Description:** `POST` applies the targeted `031` fallback only when the full consolidated migration **succeeds** but `team_member_profiles.permissions` is still missing (`279–283`). If `runMigrationSql(MIGRATION_SQL)` throws (e.g. migration `030` data constraint failure, as noted in the impl summary), execution jumps to the `catch` block and never attempts `MIGRATION_031_SQL`. This diverges from `scripts/apply-migrations.mjs:117–127`, which applies the permissions fix after a full-migration failure when `team_member_profiles` schema check was already failing.
- **Suggestion:** In the `catch` block (or a shared helper), re-check schema status and run `MIGRATION_031_SQL` when `team_member_profiles.permissions` is missing—mirroring the script’s targeted fallback—before returning `needsManualRun`.
- **Status:** open

### 3

- **Severity:** suggestion
- **File:Line:** `components/DevAccountSwitcher.tsx:122–125`, `components/DevAccountSwitcher.tsx:127`
- **Description:** `selectValue` falls back to `DEV_BASE_OWNER_EMAIL` when the signed-in email is not yet in `options` (e.g. roster still loading or RLS-limited fetch). Meanwhile `viewingAs` uses `storedPersona || normalizedCurrentEmail`, so the banner can read “viewing as driver@…” while the `<select>` displays the owner address. This is confusing and could cause an unintended owner switch if the user changes the dropdown before options finish loading.
- **Suggestion:** Prefer `normalizedCurrentEmail` (when present) for `selectValue` even if not yet in `options`, or add a transient “loading accounts…” placeholder option; align `viewingAs` and `selectValue` to the same precedence rules.
- **Status:** open

### 4

- **Severity:** suggestion
- **File:Line:** `components/DevAccountSwitcher.tsx:127`, `components/DevAccountSwitcher.tsx:42–45`
- **Description:** `viewingAs` prefers `storedPersona` from `localStorage` over the live session email. `dev-test-persona-email` is only cleared when switching back to owner (`DevAccountSwitcher.tsx:162–163`), not on sign-out or normal login. A developer who signs in directly (without the switcher) can see a stale “viewing as” label from a prior session.
- **Suggestion:** Clear or ignore `storedPersona` when it does not match `normalizedCurrentEmail`, and clear the key on sign-out if a global auth listener is available.
- **Status:** open

### 5

- **Severity:** suggestion
- **File:Line:** `app/api/admin/migrate/route.test.ts:304–376`
- **Description:** Tests cover schema detection for missing `permissions` on GET and successful full POST apply, but there is no test asserting that POST runs `getMigration031Sql()` when the full migration succeeds with permissions still missing, nor that POST applies `031` when the full migration throws. The script path has been manually verified; the API path lacks automated coverage for the new fallback logic.
- **Suggestion:** Add POST tests: (a) mock `runMigrationSql` success + schema still missing `permissions` → second call with `031` SQL; (b) mock first `runMigrationSql` rejection + permissions missing → `031` still applied in recovery path once issue #2 is fixed.
- **Status:** open

### 6

- **Severity:** suggestion
- **File:Line:** `app/api/dev/switch-user/route.test.ts:55–64`
- **Description:** Route tests cover missing bearer token (401) and allowlist behavior, but not an invalid/expired token where `getUser()` returns an error. The handler maps that to 401 (`route.ts:53–55`), which is correct, but untested.
- **Suggestion:** Add a test with a bearer token present and `getUser` returning `{ error, user: null }` → expect 401.
- **Status:** open

### 7

- **Severity:** suggestion
- **File:Line:** `lib/dev-account-switch.ts:78–86`, `app/api/dev/switch-user/route.ts:78–83`
- **Description:** `isDevSwitchEmailAllowed` always permits `DEV_BASE_OWNER_EMAIL` for any authenticated dev user, regardless of organization membership. This matches the stated product requirement for dev switch-back, but means any dev-session bearer token can request an owner magic link if the switcher is enabled (including via `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER=true` outside `NODE_ENV=development`).
- **Suggestion:** Document this explicitly in dev-mode docs/comments; consider restricting owner magic-link generation to sessions that were originally owner-switched or that share an org with the owner when the flag is used in shared/staging environments.
- **Status:** open

### 8

- **Severity:** nit
- **File:Line:** `lib/migration-manifest.json:15–19`, `supabase/migrations/027_team_invites_and_deletion_requests.sql:7–8`, `supabase/migrations/031_team_member_profiles_permissions.sql:4–5`
- **Description:** `permissions` DDL now appears in both migration `027` (manifest) and `031` (manifest). Both use `ADD COLUMN IF NOT EXISTS`, so apply is safe but redundant; consolidated runs execute the same DDL twice.
- **Suggestion:** Acceptable for the targeted-fix strategy; optionally add a one-line comment in `031` that it is a repair migration for DBs where `027` never fully applied, to avoid future confusion about duplication.
- **Status:** open

### 9

- **Severity:** nit
- **File:Line:** `components/DevAccountSwitcher.tsx:69–72`, `lib/dev-account-switch.ts:28–31`
- **Description:** PostgREST `.or()` filters interpolate `actorEmail` directly into the filter string. `normalizeInviteEmail` mitigates most issues, but unusual characters could theoretically break filter parsing.
- **Suggestion:** Use parameterized RPC or separate `.eq()` queries combined client-side if email edge cases become a concern; low priority for normalized invite emails.
- **Status:** open

### 10

- **Severity:** nit
- **File:Line:** `app/profile/profile-ui.test.ts:669–686`
- **Description:** DevAccountSwitcher coverage is source-text assertion only (file contains strings like `Switch back to owner`, `team_member_profiles`). No behavioral/render test for `selectValue`, button visibility, or `handleSwitch` flows.
- **Suggestion:** Add a shallow React Testing Library test for option ordering, controlled `value`, and `canSwitchBackToOwner` button visibility when `currentEmail` is a non-owner address.
- **Status:** open

---

## Positive Observations

- **Auth model improvement:** Replacing `getAuthenticatedMemberProfile` with token + `resolveDevSwitchOrganizationId` correctly unblocks roster-only team members without weakening the bearer-token gate.
- **Allowlist hardening:** Admin client for org roster lookups (`dev-account-switch.ts:53–63`) addresses RLS gaps when building the email list.
- **Idempotent migration:** `031_team_member_profiles_permissions.sql` correctly uses `ADD COLUMN IF NOT EXISTS`, `NOT NULL DEFAULT`, and `NOTIFY pgrst`.
- **Unit test quality:** `lib/dev-account-switch.test.ts` and the new switch-back-to-owner route test (`route.test.ts:142–190`) directly exercise the critical paths.
- **New member save:** With the column present, explicit `permissions` in the insert payload is validated by `team-member-profiles-api.test.ts`; UI always sends `memberPermissions` on roster saves.

---

## Test Evidence Reviewed

Impl summary reports 117 tests passing across 6 files. Reviewed test sources confirm coverage for allowlist, org resolution, owner fast-path, switch-back route, permissions schema flag on GET migrate, and roster insert-with-permissions. Gaps noted in issues #5, #6, and #10.

---

## Summary

The implementation fixes the reported production-adjacent dev issues: team members can switch back to the hardcoded owner, the dev switcher no longer breaks on missing `member_profiles`, and the `permissions` column can be applied safely. **Ship after resolving migration `031` naming collision (issue #1) and aligning admin POST fallback with the script (issue #2).** Remaining items are UX polish, security documentation for dev-only owner bypass, and test coverage improvements.