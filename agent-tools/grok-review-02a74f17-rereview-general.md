# Re-Review: Forced Carrier Owner (02a74f17) — After Fix Round 1

**Reviewer:** general  
**Scope:** Verify fixes in `grok-review-02a74f17.md`; report only new open issues.

---

## Prior Issues — Verification

| # | Issue | Verdict |
|---|-------|---------|
| 1 | `showEditCarrierButton` blocks forced owner | **Resolved** — guard is `(canWriteProfile \|\| forcedCarrierOwner) && canManageCarrier && …` (`app/profile/page.tsx:1166-1171`). |
| 2 | DB trigger blocks `is_primary_owner` promotion on org-linked UPDATE | **Resolved** — forced-owner `carrier_only` upsert selects `supabaseAdmin` when `hasAdminAccess && supabaseAdmin` (`lib/team-member-profiles-api.ts:256-259`). Service role bypasses `auth.uid()`-gated triggers (020/023). |
| 3 | Carrier fields silently reverted when promotion fails | **Resolved** — same admin upsert path as #2; trigger 023 no longer reverts `company_name` on promotion saves. |
| 4 | Add tests (null bootstrap, Viewer forced-owner API, bootstrap calls) | **Resolved** — `lib/team-member-profiles-api.test.ts` adds Viewer + null-profile cases; `app/profile/profile-ui.test.ts` asserts UI/handler bypass. 19/19 API tests pass. |
| 5 | `handleSave` lacks forced-owner bypass | **Resolved** — `if (!user \|\| (!forcedCarrierOwner && !canWriteTeamData(ownProfile))) return` (`app/profile/page.tsx:911-912`). Reachable UI paths also have `canWriteProfile === true` (null profile bootstrap) or primary-owner state after carrier save. |
| 6 | Hardcoded email backdoor | **Accepted** — intentional per user; not tracked as open. |

---

## New Open Issues

### 1 [bug] `ensureOrganizationBootstrap` fails RLS after successful admin upsert

- **File:** `lib/team-member-profiles-api.ts:256-279`
- **Description:** Fix round 1 correctly promotes `member_profiles` via `supabaseAdmin`, but `ensureOrganizationBootstrap` still runs on the **authed user client** immediately after. RLS on `organizations` / `organization_memberships` uses `auth_user_is_primary_owner_of_org()`, which reads `organization_memberships.is_primary_owner` — not `member_profiles.is_primary_owner`.

  **Null-profile bootstrap:** `organizations` INSERT succeeds (`created_by_user_id = auth.uid()`), but first `organization_memberships` INSERT fails (chicken-and-egg: policy requires an existing primary-owner membership row).

  **Org-linked promotion (Viewer → primary):** `organizations` UPDATE and `organization_memberships` upsert both fail because the user is not yet primary owner in `organization_memberships` (migration 021 backfill left `is_primary_owner: false`).

  Result: admin upsert succeeds, `ensureOrganizationBootstrap` throws, API returns 500, client shows carrier-save error — while `member_profiles` may already be promoted. Tests mock org upserts to `{ error: null }` and do not exercise RLS (`lib/team-member-profiles-api.test.ts:217-218`, `:414`).
- **Suggestion:** Run `ensureOrganizationBootstrap` with `supabaseAdmin` when the preceding upsert used admin (forced-owner `carrier_only`), or extend membership RLS / helper to honor `member_profiles.is_primary_owner` for the caller's own row. Add a test that simulates RLS denial on the authed client and asserts admin fallback.
- **Status:** open

### 2 [suggestion] Admin upsert fallback leaves org-linked forced owner on pre-fix failure mode

- **File:** `lib/team-member-profiles-api.ts:256-259`, `lib/supabase.ts:37-43`
- **Description:** When `SUPABASE_SERVICE_ROLE_KEY` is unset (`hasAdminAccess === false`), forced-owner `carrier_only` falls back to the authed client — the exact path that triggers 020 (`Cannot change is_primary_owner on self-update`) and 023 carrier-field reverts for org-linked non-primary rows. Impl summary documents this as graceful fallback, but there is no user-facing error explaining the missing key.
- **Suggestion:** If `forcedCarrierOwner && saveScope === 'carrier_only' && existing.organization_id && !existing.is_primary_owner && !hasAdminAccess`, throw a explicit configuration error before upsert.
- **Status:** open

### 3 [nit] Save Profile button / field disable omit `forcedCarrierOwner` despite impl “UI parity” claim

- **File:** `app/profile/page.tsx:508`, `app/profile/page.tsx:1365`
- **Description:** `handleSave` and `showEditCarrierButton` include `forcedCarrierOwner` bypasses, but the Save Profile submit button (`disabled={isSaving \|\| !canWriteProfile \|\| isLoadingMember}`) and `isFieldDisabled` still gate solely on `canWriteProfile`. Not reachable in the current onboarding flow (member edit card is hidden when `!canWriteProfile`), but inconsistent with `grok-impl-summary-02a74f17.md` “UI parity” note and fragile if future UI exposes the card earlier.
- **Suggestion:** Use `(canWriteProfile \|\| forcedCarrierOwner)` on the submit button and in `isFieldDisabled` for self-edit paths, matching carrier controls.
- **Status:** open

---

## Summary

**Prior actionable issues:** 5/5 verified fixed at the code paths targeted in fix round 1.

**New open issues:** 3 (1 bug, 1 suggestion, 1 nit)

The highest-impact remaining gap is **#1**: admin upsert can promote `member_profiles`, but post-save org/membership sync still fails under production RLS, producing error responses and partial DB state. Fix round 1 tests pass because org-table writes are mocked without RLS enforcement.