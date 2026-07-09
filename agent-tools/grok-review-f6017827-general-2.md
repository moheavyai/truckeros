# Code Review: Effort 4 — Dev Account Switcher Owner Switch-Back + `team_member_profiles.permissions`

**Reviewer:** Grok (general pass 2)  
**Scope:** `DevAccountSwitcher.tsx`, `dev-account-switch.ts`, `switch-user/route.ts`, migration `031`, `admin/migrate/route.ts`, `team-member-profiles-api.ts` (roster save + permissions)  
**Summary ref:** `agent-tools/grok-impl-summary-f6017827.md`

---

## Overview

The owner switch-back flow is sound: server-side owner bypass in `isDevSwitchEmailAllowed`, org resolution via roster fallback, and UI affordances (owner-first options, explicit button, persona `localStorage` cleanup) align with the stated goals. The `permissions` column fix via idempotent migration `031` and schema checks is appropriate.

Several gaps remain around **admin migrate fallback parity**, **test coverage for the 031 apply path**, and **minor consistency/edge-case handling** in the dev switcher and roster save paths.

---

## Findings

### 1
| Field | Value |
|-------|-------|
| **Severity** | bug |
| **File:Line** | `app/api/admin/migrate/route.ts:269-307` |
| **Description** | Targeted migration `031` is only applied when `runMigrationSql(MIGRATION_SQL)` **succeeds** and the post-check still reports `team_member_profiles.permissions` missing. If the consolidated migration throws (the exact scenario documented in the impl summary — failure at migration `030` due to `member_profiles_user_roles_check`), execution jumps to the `catch` block and **never** attempts `MIGRATION_031_SQL`. `scripts/apply-migrations.mjs:117-127` has this fallback; the API route does not. |
| **Suggestion** | Mirror the script behavior: in the `catch` block (or before rethrowing), if schema status indicates `team_member_profiles.permissions` is missing, attempt `runMigrationSql(MIGRATION_031_SQL)` and re-check status. Alternatively, run the targeted `031` apply **before** or independently of the full consolidated migration when that column is the only blocker. |
| **Status** | open |

### 2
| Field | Value |
|-------|-------|
| **Severity** | bug |
| **File:Line** | `app/api/admin/migrate/route.ts:293-307` |
| **Description** | When `runMigrationSql` throws, the error response includes `getSchemaStatus()` from the catch path but does not surface whether a targeted `031` retry was attempted or would have helped. Operators hitting the documented `030` failure mode get `needsManualRun: true` with no automated recovery — inconsistent with the CLI script that recovers in that scenario. |
| **Suggestion** | Add targeted-031 fallback in the catch path and return structured fields (e.g. `permissionsMigrationAttempted`, `permissionsMigrationApplied`) so GET/POST responses distinguish “full migration failed, permissions fixed” from “everything failed.” |
| **Status** | open |

### 3
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `app/api/admin/migrate/route.test.ts:304-376` |
| **Description** | Tests cover successful full migration and failure when `runMigrationSql` throws, but there is **no test** asserting that `getMigration031Sql()` is invoked when permissions remain missing after a successful full run, nor a test for “full migration fails → targeted 031 applied.” The impl summary’s primary production pain case is untested at the API layer. |
| **Suggestion** | Add POST tests: (a) full migration succeeds, schema check still missing `permissions` → `runMigrationSql` called twice (full + 031); (b) full migration rejects, permissions column missing → 031 still attempted (once fallback is implemented). |
| **Status** | open |

### 4
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `components/DevAccountSwitcher.tsx:85-94` vs `lib/dev-account-switch.ts:53-64` |
| **Description** | Client-side `loadTeamEmails` uses the authenticated Supabase client (RLS-constrained). Server-side `fetchDevSwitchAllowlistEmails` uses `supabaseAdmin` when available. The dropdown options and server allowlist can diverge — a user may see an email in the dropdown that returns 403, or miss emails the server would permit. |
| **Suggestion** | Consider a dev-only API endpoint to fetch the allowlist (server builds it with admin client), or document that the dropdown is best-effort and 403 means “not in server allowlist.” Optionally log allowlist mismatches in dev. |
| **Status** | open |

### 5
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `lib/dev-account-switch.ts:78-86` / `app/api/dev/switch-user/route.ts:78-83` |
| **Description** | `isDevSwitchEmailAllowed` always permits `DEV_BASE_OWNER_EMAIL` regardless of organization membership. Combined with `isDevAccountSwitcherEnabled()` allowing `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER=true` outside `NODE_ENV !== 'production'`, any authenticated dev-switcher user who obtains a session can request a magic link for the hardcoded owner account. Intentional for local testing, but a footgun if the flag is set on a shared/staging host. |
| **Suggestion** | Restrict owner bypass to `isDevEnvironment()` only (not the public env override), or require the actor to share an `organizationId` with the owner in the allowlist. At minimum, document the risk next to `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER`. |
| **Status** | open |

### 6
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `lib/dev-account-switch.ts:36-37` / `components/DevAccountSwitcher.tsx:78-79` |
| **Description** | `resolveDevSwitchOrganizationId` and the UI roster fallback use `.limit(1).maybeSingle()` with no ordering. If a user is linked to multiple organizations (multiple roster rows or cross-org test data), an arbitrary org is chosen, which can produce an incomplete or wrong allowlist. |
| **Suggestion** | Prefer the org from `member_profiles` (already done first), then the most recently updated roster row, or fail with a clear error when multiple orgs match. |
| **Status** | open |

### 7
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `lib/dev-account-switch.ts:29-31` / `components/DevAccountSwitcher.tsx:71-72` |
| **Description** | PostgREST `.or()` filter strings interpolate `userId` and `driver_email` directly. UUIDs are safe; emails containing PostgREST filter metacharacters (e.g. commas, parentheses) could break or widen the filter. `normalizeInviteEmail` lowercases/trims but does not escape filter syntax. |
| **Suggestion** | Use separate `.eq()` queries combined in application code, or sanitize/escape values for PostgREST filter strings. |
| **Status** | open |

### 8
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `components/DevAccountSwitcher.tsx:53-108` |
| **Description** | `loadTeamEmails` ignores Supabase `error` responses from all queries. RLS denials, network errors, or schema issues fail silently, leaving `teamEmails` empty. Switching still works for owner + current user (via `buildDevSwitcherOptions`), but the dropdown may be misleadingly sparse with no user-visible hint. |
| **Suggestion** | Check `{ error }` on each query; set a non-blocking warning in the existing `error` state or a separate `loadWarning` when roster/org fetch fails. |
| **Status** | open |

### 9
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `components/DevAccountSwitcher.tsx:131-178` |
| **Description** | `handleSwitch` has no in-flight request guard beyond `switchingEmail` on the select/button. Rapid repeated clicks before `switchingEmail` is set, or overlapping requests if the first is slow, could trigger multiple magic-link generations and race the redirect. |
| **Suggestion** | Return early if `switchingEmail` is already set; optionally use `AbortController` to cancel stale fetches. |
| **Status** | open |

### 10
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `app/api/dev/switch-user/route.ts:57-60` |
| **Description** | Target email is normalized with `String(body.email).trim().toLowerCase()` while allowlist construction uses `normalizeInviteEmail` everywhere else. Behavior is equivalent for typical emails today, but diverges if `normalizeInviteEmail` gains validation or rejection logic later. |
| **Suggestion** | Use `normalizeInviteEmail` (or a shared `normalizeDevSwitchEmail`) in the route and reject null/empty after normalization. |
| **Status** | open |

### 11
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `app/api/dev/switch-user/route.ts:57` |
| **Description** | `await request.json()` is outside a try/catch that distinguishes malformed JSON. A bad body throws into the generic catch and returns 500 with a potentially leaky message rather than 400. |
| **Suggestion** | Parse JSON in a narrow try/catch and return `{ success: false, error: 'Invalid JSON body' }` with status 400. |
| **Status** | open |

### 12
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `lib/team-member-profiles-api.ts:492-494` |
| **Description** | Roster save only attaches `permissions` to the payload when `canManageMemberPermissions(actorProfile)` is true. `createOrUpdateRosterMemberForUser` also allows `isPrimaryOwner(actorProfile)` without Owner/Admin roles. A primary owner whose `user_roles` lack Owner/Admin would save roster members but **drop** client-sent `permissions`, silently falling back to the DB default. |
| **Suggestion** | Align permission-write gate with entry gate: use `(canManageMemberPermissions(actorProfile) || isPrimaryOwner(actorProfile))` when setting `payload.permissions`, matching `saveTeamMemberProfileForUser` semantics for membership sync. |
| **Status** | open |

### 13
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `lib/team-member-profiles-api.ts:522-526` |
| **Description** | Insert path omits `permissions` from the payload when `body.permissions` is undefined (relies on DB default). This is correct after migration `031`, but there is no unit test for the “save without explicit permissions” path — only the explicit-permissions insert is tested (`lib/team-member-profiles-api.test.ts:1221-1247`). |
| **Suggestion** | Add a test asserting insert succeeds without `body.permissions` and that the returned row has `{ mode: 'global' }` (or that insert payload omits `permissions` and DB default applies). |
| **Status** | open |

### 14
| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **File:Line** | `app/api/admin/migrate/route.ts:98-109` |
| **Description** | `checkTableColumns` infers missing columns by substring-matching column names in PostgREST error messages. Generic errors (e.g. permission denied, timeout) mark **all** checked columns as missing (`missingColumns: [...check.columns]`), which can misreport root cause. |
| **Suggestion** | Treat unrecognized errors separately (e.g. `columnsExist: false`, `missingColumns: []`, `error: 'Schema check inconclusive'`) so operators do not assume a missing column when the issue is connectivity/RLS. |
| **Status** | open |

### 15
| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File:Line** | `supabase/migrations/031_team_member_profiles_permissions.sql:4-10` |
| **Description** | Migration `031` duplicates the `permissions` DDL already present in `027_team_invites_and_deletion_requests.sql:7-11`. Idempotency is correct; the split is justified for targeted apply. No functional issue. |
| **Suggestion** | Add a one-line comment in `031` referencing `027` as the canonical definition to avoid future drift if the default JSON shape changes. |
| **Status** | open |

### 16
| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File:Line** | `components/DevAccountSwitcher.tsx:127` |
| **Description** | `viewingAs` prefers `storedPersona` over `normalizedCurrentEmail`. After a successful switch, `localStorage` and session align; after a failed switch that updated `localStorage` before redirect, label could disagree with session. Unlikely because `localStorage` is only written after a successful API response. |
| **Suggestion** | No change required; optional: derive display label from session email when it disagrees with stored persona. |
| **Status** | open |

### 17
| Field | Value |
|-------|-------|
| **Severity** | nit |
| **File:Line** | `lib/dev-mode.ts:2` |
| **Description** | `DEV_BASE_OWNER_EMAIL` is hardcoded to a personal Outlook address across client, server, and tests. Acceptable for a dev-only tool but couples all environments to one identity. |
| **Suggestion** | Consider `process.env.DEV_BASE_OWNER_EMAIL` with the current value as fallback for easier team onboarding. |
| **Status** | open |

---

## Positive Observations

- **Owner fast-path** (`isDevBaseOwnerEmail` / `isDevSwitchEmailAllowed`) cleanly fixes switch-back without weakening allowlist checks for non-owner targets.
- **Org resolution fallback** (`member_profiles` → `team_member_profiles`) is mirrored in UI and server, fixing the team-member-blocked-before-allowlist regression.
- **Controlled `<select>`** fix (removed empty disabled option, owner-first `buildDevSwitcherOptions`, valid `selectValue`) addresses the React controlled-component bug called out in the summary.
- **Migration `031`** is appropriately idempotent (`ADD COLUMN IF NOT EXISTS`) with `NOTIFY pgrst` for schema-cache refresh.
- **Roster insert with permissions** (`createOrUpdateRosterMemberForUser` lines 492-494, 522-526) correctly parses and persists permissions when the actor may manage them.
- **Test coverage** for core switch-back (`route.test.ts:142-190`, `dev-account-switch.test.ts`) and permissions column detection (`migrate/route.test.ts:115-138`) is solid for happy paths.

---

## Recommended Verification (manual)

1. Team member session → **Switch back to owner** → confirm magic-link lands on owner session and `dev-test-persona-email` is cleared.
2. Owner → switch to team member → switch back via dropdown `(owner)` option (not only the button).
3. `POST /api/admin/migrate` on a DB where consolidated migration fails at `030` but `permissions` is missing — confirm whether API recovers (currently expected to **fail**; compare with `node scripts/apply-migrations.mjs`).
4. Profile → **+ Add New Member** → save with default (global) permissions and with custom permissions → confirm row in `team_member_profiles` and no PostgREST schema-cache error.

---

## Summary Counts

| Severity | Count |
|----------|-------|
| bug | 2 |
| suggestion | 11 |
| nit | 3 |
| **Total** | **16** |

**Highest priority:** Align `app/api/admin/migrate/route.ts` POST handler with `scripts/apply-migrations.mjs` targeted `031` fallback when full migration fails (#1, #2, #3).