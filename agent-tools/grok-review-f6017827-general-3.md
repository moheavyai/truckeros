# Code Review: Dev Account Switcher + `team_member_profiles.permissions` — General Pass 3

**Review ID:** f6017827  
**Scope:** All files in `agent-tools/grok-impl-summary-f6017827.md`  
**Reference:** `agent-tools/grok-impl-summary-f6017827.md`  
**Prior reviews:** `grok-review-f6017827-general.md`, `grok-review-f6017827-general-2.md`  
**Focus:** Independent second-pass verification of bugs, regressions, and incomplete fixes  
**Status:** Review only — no code changes made

---

## Verification Summary

| Area | Result | Notes |
|------|--------|-------|
| Team member can call switch-user without `member_profiles` | ✅ Pass | `resolveDevSwitchOrganizationId` + token auth replace `getAuthenticatedMemberProfile` (`route.ts:47–70`) |
| Owner email always permitted | ✅ Pass | `isDevSwitchEmailAllowed` fast-path (`dev-account-switch.ts:82–85`); allowlist seeds owner (`dev-account-switch.ts:46`) |
| Controlled `<select>` value | ✅ Pass | Empty disabled option removed; `buildDevSwitcherOptions` always includes `normalizedCurrent` when present (`DevAccountSwitcher.tsx:23–24, 122–125`) |
| Switch back to owner UI | ✅ Pass | Button + owner-first options; `localStorage` cleared on owner switch (`DevAccountSwitcher.tsx:162–163, 202–213`) |
| Idempotent `permissions` migration | ✅ Pass | `031_team_member_profiles_permissions.sql` uses `ADD COLUMN IF NOT EXISTS` + `NOTIFY pgrst` |
| Script targeted `031` fallback | ✅ Pass | `apply-migrations.mjs:117–127` applies `031` when full migration throws and `team_member_profiles` check failed |
| API targeted `031` fallback | ❌ Fail | `POST /api/admin/migrate` only runs `031` on **success** path (`route.ts:279–283`); catch path skips it (`route.ts:293–307`) |
| Roster save writes `permissions` | ✅ Pass | `createOrUpdateRosterMemberForUser` persists permissions when actor may manage (`team-member-profiles-api.ts:492–494`); insert test added |
| Core unit tests | ✅ Pass | 117 tests reported passing across 6 files; happy paths for switch-back, org resolution, schema detection confirmed in source |

**Pass 3 conclusion:** Core dev-switch and permissions DDL goals are met. Two operational gaps remain blocking parity between CLI and API migration recovery, plus a stale-persona UX bug. Several test and consistency gaps persist.

---

## Issues

### 1

- **Severity:** bug
- **File:line:** `scripts/apply-migration-031.mjs:29–31`, `supabase/migrations/031_owner_bootstrap_membership_rls.sql:1`, `supabase/migrations/031_team_member_profiles_permissions.sql:1`, `lib/migration-manifest.json:19`
- **Description:** Two unrelated SQL files share the `031` prefix. The standalone script applies `031_owner_bootstrap_membership_rls.sql` (org-membership bootstrap RLS), while the manifest, `getMigration031Sql()`, and `apply-migrations.mjs` use `031_team_member_profiles_permissions.sql`. Running `node scripts/apply-migration-031.mjs` does **not** add the `permissions` column. The bootstrap RLS file is also **not** in `migration-manifest.json`, so it is never applied by consolidated migrations.
- **Suggestion:** Renumber/rename one migration (e.g. `032_owner_bootstrap_membership_rls.sql`), add it to the manifest if still needed, and repoint `apply-migration-031.mjs` to the permissions file (or rename the script to match its SQL). Ensure exactly one canonical `031` for permissions.
- **Status:** open

### 2

- **Severity:** bug
- **File:line:** `app/api/admin/migrate/route.ts:276–307`
- **Description:** Targeted `MIGRATION_031_SQL` runs only when the full consolidated migration **succeeds** but `team_member_profiles.permissions` is still missing (`279–283`). When `runMigrationSql(MIGRATION_SQL)` throws — the documented production-adjacent case (migration `030` `member_profiles_user_roles_check` failure) — execution enters the `catch` block and never attempts `031`. This diverges from `scripts/apply-migrations.mjs:117–127`, which recovers permissions in that scenario. Operators using the admin UI/`POST /api/admin/migrate` get `needsManualRun: true` without automated recovery.
- **Suggestion:** Extract a shared helper (used by API route and script) that, on full-migration failure, checks schema status and runs `MIGRATION_031_SQL` when `team_member_profiles.permissions` is missing. Return structured fields (`permissionsMigrationAttempted`, `permissionsMigrationApplied`) in the JSON response.
- **Status:** open

### 3

- **Severity:** bug
- **File:line:** `components/DevAccountSwitcher.tsx:42–45`, `components/DevAccountSwitcher.tsx:127`, `components/DevAccountSwitcher.tsx:186`
- **Description:** `viewingAs` prefers `storedPersona` from `localStorage` over the live session email (`storedPersona || normalizedCurrentEmail`). `dev-test-persona-email` is cleared only when switching back to owner via `handleSwitch` (`162–163`), not on direct sign-in or sign-out. A developer who signs in as the owner without using the switcher can see a stale banner (e.g. "viewing as driver@…") while the session and dropdown reflect the owner — misleading test-mode state.
- **Suggestion:** On mount, if `normalizedCurrentEmail === DEV_BASE_OWNER_EMAIL`, clear `DEV_TEST_PERSONA_STORAGE_KEY`. Derive `viewingAs` from session email when it disagrees with `storedPersona`, or ignore `storedPersona` when it does not match the current session.
- **Status:** open

### 4

- **Severity:** bug
- **File:line:** `lib/team-member-profiles-api.ts:468–470`, `lib/team-member-profiles-api.ts:492–494`
- **Description:** `createOrUpdateRosterMemberForUser` allows roster saves when `isPrimaryOwner(actorProfile)` **or** `canManageMemberPermissions(actorProfile)` (`468–470`), but attaches `payload.permissions` only when `canManageMemberPermissions` is true (`492–494`). `canManageMemberPermissions` checks Owner/Admin roles only (`member-profile-permissions.ts:115–118`), not `is_primary_owner`. A primary owner whose `user_roles` lack Owner/Admin (bootstrap/legacy rows) can save roster members while client-sent `permissions` are silently dropped, falling back to the DB default.
- **Suggestion:** Align the write gate with the entry gate: `(canManageMemberPermissions(actorProfile) || isPrimaryOwner(actorProfile))` when setting `payload.permissions`.
- **Status:** open

### 5

- **Severity:** suggestion
- **File:line:** `app/api/admin/migrate/route.test.ts:304–376`
- **Description:** POST tests cover successful full migration and generic `runMigrationSql` failure, but not the new `031` recovery logic: (a) full migration succeeds, permissions still missing → second `runMigrationSql` with `031` SQL; (b) full migration throws, permissions missing → targeted `031` applied (once issue #2 is fixed).
- **Suggestion:** Add mocked POST tests for both recovery paths; assert call count and SQL content include `ADD COLUMN IF NOT EXISTS permissions`.
- **Status:** open

### 6

- **Severity:** suggestion
- **File:line:** `components/DevAccountSwitcher.tsx:53–108` vs `lib/dev-account-switch.ts:40–76`
- **Description:** Client `loadTeamEmails` uses the authenticated Supabase client (RLS-constrained); server `fetchDevSwitchAllowlistEmails` uses `supabaseAdmin` when available. Dropdown options and server allowlist can diverge — sparse dropdown with 403 on switch, or visible emails the server would reject if RLS hides roster rows the admin client sees.
- **Suggestion:** Add a dev-only `GET /api/dev/switch-allowlist` that returns the server-built set, or document dropdown as best-effort. Optionally surface a non-blocking warning when roster fetch returns empty but org resolved.
- **Status:** open

### 7

- **Severity:** suggestion
- **File:line:** `components/DevAccountSwitcher.tsx:53–108`
- **Description:** `loadTeamEmails` does not inspect `{ error }` from Supabase queries. RLS denials, network failures, and schema errors fail silently; `teamEmails` stays empty. Switching still works for owner + current user via `buildDevSwitcherOptions`, but the dropdown is misleadingly sparse with no user-visible hint.
- **Suggestion:** Check errors on org/roster/member queries; set `error` or a separate `loadWarning` when fetches fail.
- **Status:** open

### 8

- **Severity:** suggestion
- **File:line:** `components/DevAccountSwitcher.tsx:16–30`, `components/DevAccountSwitcher.tsx:26–27`
- **Description:** `buildDevSwitcherOptions` adds `storedPersona` to the dropdown even when that email is not in the current org roster. A stale persona from a prior session appears as a selectable option; choosing it triggers a 403 from the server allowlist check with only the generic error string.
- **Suggestion:** Include `storedPersona` in options only when it is in `teamEmails` or matches `normalizedCurrentEmail`; otherwise omit from the select while still handling `localStorage` cleanup separately.
- **Status:** open

### 9

- **Severity:** suggestion
- **File:line:** `lib/dev-account-switch.ts:78–86`, `app/api/dev/switch-user/route.ts:78–83`, `lib/dev-mode.ts:15–18`
- **Description:** `isDevSwitchEmailAllowed` always permits `DEV_BASE_OWNER_EMAIL` for any authenticated user. Combined with `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER=true` enabling the switcher outside `NODE_ENV !== 'production'`, any bearer-token holder on a shared/staging host can request an owner magic link. Intentional for local dev, but a footgun if the public flag is set broadly.
- **Suggestion:** Restrict owner bypass to `isDevEnvironment()` only (not the public override), or require actor org overlap with owner. Document the risk beside `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER`.
- **Status:** open

### 10

- **Severity:** suggestion
- **File:line:** `lib/dev-account-switch.ts:36–37`, `components/DevAccountSwitcher.tsx:78–79`
- **Description:** Org resolution uses `.limit(1).maybeSingle()` with no `ORDER BY`. If a user has multiple `team_member_profiles` rows across orgs (test data or bad linkage), an arbitrary org is chosen, producing an incomplete or wrong allowlist.
- **Suggestion:** After `member_profiles` lookup, prefer the roster row matching `linked_user_id`, then most recently updated; or return a clear error when multiple orgs match.
- **Status:** open

### 11

- **Severity:** suggestion
- **File:line:** `components/DevAccountSwitcher.tsx:131–134`, `components/DevAccountSwitcher.tsx:191`
- **Description:** `handleSwitch` does not guard against in-flight requests at the top of the function. `switchingEmail` disables controls after the first `setSwitchingEmail`, but rapid double-clicks before React re-renders can enqueue multiple magic-link requests.
- **Suggestion:** Return early when `switchingEmail` is already set; optionally use `AbortController` for stale fetches.
- **Status:** open

### 12

- **Severity:** suggestion
- **File:line:** `app/api/dev/switch-user/route.ts:57–60`
- **Description:** Target email uses `String(body.email).trim().toLowerCase()` while allowlist code uses `normalizeInviteEmail` everywhere else. Equivalent today, but diverges if normalization gains validation or rejection.
- **Suggestion:** Use `normalizeInviteEmail(body.email)` and return 400 when null.
- **Status:** open

### 13

- **Severity:** suggestion
- **File:line:** `app/api/dev/switch-user/route.ts:57`, `app/api/dev/switch-user/route.ts:107–110`
- **Description:** `await request.json()` is not wrapped in a narrow try/catch. Malformed JSON throws into the generic catch and returns 500 rather than 400.
- **Suggestion:** Parse JSON separately; return `{ success: false, error: 'Invalid JSON body' }` with status 400.
- **Status:** open

### 14

- **Severity:** suggestion
- **File:line:** `app/api/dev/switch-user/route.test.ts:55–64`
- **Description:** Route tests cover missing bearer (401) and allowlist (403), but not invalid/expired token where `getUser()` returns `{ error, user: null }` → 401 (`route.ts:53–55`).
- **Suggestion:** Add a test with bearer present and failed `getUser`.
- **Status:** open

### 15

- **Severity:** suggestion
- **File:line:** `app/api/admin/migrate/route.ts:98–109`
- **Description:** `checkTableColumns` infers missing columns by substring-matching names in PostgREST error messages. Unrecognized errors (permission denied, timeout) mark **all** checked columns as missing, which can mislead operators about root cause.
- **Suggestion:** For unrecognized messages, return `columnsExist: false` with `missingColumns: []` and `error: 'Schema check inconclusive'`.
- **Status:** open

### 16

- **Severity:** suggestion
- **File:line:** `lib/team-member-profiles-api.test.ts:1221–1247`
- **Description:** Roster insert test covers explicit `permissions` payload only. No test for save without `body.permissions` relying on DB default `{ mode: 'global' }` after migration `031`.
- **Suggestion:** Add test asserting insert without `permissions` succeeds and returned row matches default (or insert omits column and DB default applies).
- **Status:** open

### 17

- **Severity:** suggestion
- **File:line:** `scripts/apply-migrations.mjs:107–112`, `lib/migrations.ts:84–86`
- **Description:** `apply-migrations.mjs` hardcodes the path to `031_team_member_profiles_permissions.sql` instead of importing `getMigration031Sql()` or reading from the manifest entry. If the file is renamed in the manifest only, the script fallback breaks silently.
- **Suggestion:** Load `031` SQL via the same manifest helper the API uses, or derive filename from `migration-manifest.json`.
- **Status:** open

### 18

- **Severity:** suggestion
- **File:line:** `components/DevAccountSwitcher.tsx:53–115`, `lib/dev-account-switch.ts:10–38`
- **Description:** Org-resolution and roster-email loading logic is duplicated between the client component and `lib/dev-account-switch.ts`. Future RLS or query changes require two edits and can drift.
- **Suggestion:** Extract shared `resolveDevSwitchOrganizationId` usage into a thin client helper, or add a dev-only API for allowlist options.
- **Status:** open

### 19

- **Severity:** nit
- **File:line:** `supabase/migrations/027_team_invites_and_deletion_requests.sql:7–8`, `supabase/migrations/031_team_member_profiles_permissions.sql:4–5`
- **Description:** `permissions` DDL appears in both `027` (manifest) and `031` (manifest). Both use `ADD COLUMN IF NOT EXISTS`; consolidated runs execute redundant DDL. Acceptable for targeted repair, but easy to confuse maintainers.
- **Suggestion:** Add a comment in `031` referencing `027` as canonical and noting `031` is a repair migration for DBs where `027` never applied.
- **Status:** open

### 20

- **Severity:** nit
- **File:line:** `lib/dev-mode.ts:2`
- **Description:** `DEV_BASE_OWNER_EMAIL` is hardcoded to a personal Outlook address across client, server, and tests. Couples all dev environments to one identity.
- **Suggestion:** Support `process.env.DEV_BASE_OWNER_EMAIL` / `NEXT_PUBLIC_DEV_BASE_OWNER_EMAIL` with current value as fallback.
- **Status:** open

### 21

- **Severity:** nit
- **File:line:** `lib/dev-account-switch.ts:29–31`, `components/DevAccountSwitcher.tsx:71–72`
- **Description:** PostgREST `.or()` filter strings interpolate `userId` and `driver_email` directly. UUIDs are safe; emails with filter metacharacters could theoretically break parsing. `normalizeInviteEmail` trims/lowercases only.
- **Suggestion:** Use separate `.eq()` queries or escape filter values; low priority for normalized invite emails.
- **Status:** open

### 22

- **Severity:** nit
- **File:line:** `app/profile/profile-ui.test.ts:669–686`
- **Description:** DevAccountSwitcher coverage is source-text inspection only (strings like `Switch back to owner`, `team_member_profiles`). No render/behavior test for option ordering, controlled `value`, button visibility, or `handleSwitch` flows.
- **Suggestion:** Add a shallow React Testing Library test with mocked `fetch` and `createClient`.
- **Status:** open

---

## Clarifications (Pass 3 vs Prior Reviews)

### `selectValue` during roster load — not a regression

Prior review #3 (`general.md`) flagged `selectValue` falling back to owner while roster loads. Pass 3 re-verification: `buildDevSwitcherOptions` **always** adds `normalizedCurrentEmail` to the option set (`DevAccountSwitcher.tsx:23–24`) regardless of `teamEmails` load state. Therefore, when the user is logged in with an email, `selectValue` matches the session email immediately; fallback to `DEV_BASE_OWNER_EMAIL` applies only when `normalizedCurrentEmail` is falsy (`122–125`). The real desync is **`viewingAs` vs session** (issue #3 above), not the controlled select during load.

### `viewingAs` stale persona — elevated to bug

Pass 2 (#16) treated persona/session mismatch as unlikely after failed switches. Pass 3 identifies a reproducible case: **direct owner sign-in with uncleared `localStorage`** from a prior impersonation session. This is user-visible incorrect state without functional block — classified as **bug** (issue #3).

---

## Positive Observations

1. **Auth regression fixed:** Token + `resolveDevSwitchOrganizationId` correctly unblocks roster-only team members without removing the bearer-token gate.
2. **Admin allowlist:** Server-side `adminClient` for roster lookups (`dev-account-switch.ts:53–63`) closes RLS gaps when building allowlists.
3. **Idempotent repair migration:** `031` DDL is safe to re-run; `NOTIFY pgrst` addresses schema-cache errors that motivated the change.
4. **UI switch-back affordances:** Owner-first options, explicit button, and persona cleanup on owner target cover the reported switch-back failure mode.
5. **Test quality:** `lib/dev-account-switch.test.ts` and `route.test.ts:142–190` directly exercise owner fast-path and team-member switch-back; GET migrate test flags missing `permissions` (`route.test.ts:115–138`).

---

## Summary Counts

| Severity | Count |
|----------|-------|
| bug | 4 |
| suggestion | 14 |
| nit | 3 |
| **Total** | **21** |

**Highest priority:** Resolve migration `031` naming collision (#1), align `POST /api/admin/migrate` with script `031` fallback on full-migration failure (#2), fix stale `viewingAs` persona (#3), and align primary-owner permission write gate (#4).

---

## Recommended Manual Verification

1. Team member → **Switch back to owner** → confirm owner session and cleared `dev-test-persona-email`.
2. Switch to team member → sign out → sign in directly as owner → confirm banner does **not** show stale persona (currently expected to **fail** until #3 is fixed).
3. `POST /api/admin/migrate` on DB where consolidated migration fails at `030` with `permissions` missing — compare with `node scripts/apply-migrations.mjs` (API expected to **not** recover until #2 is fixed).
4. Profile → **+ Add New Member** → save with custom permissions → confirm row persists without PostgREST schema-cache error.
5. `node scripts/apply-migration-031.mjs` — confirm it does **not** add `permissions` (naming collision #1).

---

*End of review. All issues marked **open**; no code changes made.*