# Merged Re-review Round 2

## Review Issues

### Issue 1 [Security] — bug
- **File**: supabase/migrations (member_profiles RLS/trigger)
- **Description**: Direct Supabase self-UPDATE bypasses API — drivers can change roles, carrier, restricted fields via PostgREST.
- **Suggestion**: Add DB trigger on member_profiles BEFORE UPDATE: for non-primary-owner drivers, block changes to user_roles, carrier fields, restricted identity fields unless via service role.
- **Status**: fixed
- **Resolution**: Added `023_member_profiles_self_service_field_guard.sql` with `enforce_member_profile_self_service_restricted_fields` trigger; listed in `lib/migration-manifest.json`.

### Issue 2 [General] — suggestion
- **File**: app/profile/page.tsx
- **Description**: No driver-facing pending-changes list or cancel/withdraw.
- **Suggestion**: Show driver's own pending requests with status.
- **Status**: fixed
- **Resolution**: Added "Your Pending Profile Changes" section with status display and Withdraw action; DELETE RLS policy in migration 023.

### Issue 3 [General] — suggestion
- **File**: app/profile/page.tsx:626
- **Description**: Unsafe TeamMemberProfile cast TS2352.
- **Suggestion**: Fix typing.
- **Status**: fixed
- **Resolution**: Added `teamMemberProfileFromSaveResponse` type guard in `lib/profile-persistence.ts`; `saveViaApi` uses it instead of unsafe cast.

### Issue 4 [General] — nit
- **File**: app/profile/page.tsx
- **Description**: Restricted-warning banner missing aria-live.
- **Suggestion**: Add role="status" aria-live="polite".
- **Status**: fixed
- **Resolution**: Added `aria-live="polite"` to driver restricted-warning banner.

### Issue 5 [General] — nit
- **File**: app/profile/page.tsx
- **Description**: user state typed as any.
- **Suggestion**: Use User type from supabase.
- **Status**: fixed
- **Resolution**: `useState<User | null>(null)` with import from `@supabase/supabase-js`.

### Issue 6 [General] — nit
- **File**: lib/profile-change-requests.ts
- **Description**: POST sends full form snapshot.
- **Suggestion**: Send only restricted field deltas.
- **Status**: fixed
- **Resolution**: Client sends `buildRestrictedChangeRequestPayload(changes)`; server parses via `parseRestrictedChangeRequestBody`.

### Issue 7 [General] — nit
- **File**: migration 022
- **Description**: RLS UPDATE policy missing explicit WITH CHECK.
- **Suggestion**: Add WITH CHECK clause.
- **Status**: fixed
- **Resolution**: Migration 023 recreates primary-owner UPDATE policy with matching `WITH CHECK`.

### Issue 8 [Tests] — suggestion
- **File**: lib/profile-field-permissions.test.ts
- **Description**: Missing dual-role, all restricted keys, whitespace, null actor tests.
- **Suggestion**: Add edge case tests.
- **Status**: fixed
- **Resolution**: Added dual-role, per-key, whitespace normalization, and null-actor bootstrap tests.

### Issue 9 [Tests] — suggestion
- **File**: lib/profile-change-requests.test.ts, route.test.ts
- **Description**: List/review/submit gaps + 401/403 mapping untested.
- **Suggestion**: Add tests.
- **Status**: fixed
- **Resolution**: Extended lib tests for list/review/withdraw/submit errors; route tests for POST 401, GET/POST 403.

### Issue 10 [Tests] — suggestion
- **File**: lib/team-member-profiles-api.test.ts
- **Description**: driver carrier_only skip, non-driver passthrough untested.
- **Suggestion**: Add tests.
- **Status**: fixed
- **Resolution**: Added carrier_only baseline-skip and non-driver passthrough cases.

### Issue 11 [Tests] — nit
- **File**: app/profile/profile-ui.test.ts
- **Description**: Missing formForSave baseline, reviewSuffix, showLandingView, isFieldDisabled assertions.
- **Suggestion**: Add source tests.
- **Status**: fixed
- **Resolution**: Added handleSave ordering, reviewSuffix, showLandingView, isFieldDisabled, and driver pending-list source tests.

### Issue 12 [Tests] — nit
- **File**: app/profile/profile-ui.test.ts
- **Description**: RTL harness tech debt — document accepted limitation test.
- **Suggestion**: Add accepted limitation test.
- **Status**: fixed (accepted limitation documented)
- **Resolution**: Enhanced RTL limitation test asserting file-header documentation and absence of render harness imports.

---

## Test Run (verified)

```bash
node node_modules/vitest/vitest.mjs run \
  app/profile/profile-ui.test.ts \
  lib/member-profile.test.ts \
  lib/member-profile-permissions.test.ts \
  lib/profile-persistence.test.ts \
  lib/profile-field-permissions.test.ts \
  lib/profile-change-requests.test.ts \
  lib/team-member-profiles-api.test.ts \
  app/api/profile-change-requests/route.test.ts \
  lib/migrations.test.ts
```

**Result:** 164/164 passing

| File | Tests |
|------|-------|
| `profile-ui.test.ts` | 32 |
| `member-profile.test.ts` | 55 |
| `member-profile-permissions.test.ts` | 15 |
| `profile-persistence.test.ts` | 10 |
| `profile-field-permissions.test.ts` | 11 |
| `profile-change-requests.test.ts` | 19 |
| `team-member-profiles-api.test.ts` | 5 |
| `route.test.ts` | 7 |
| `migrations.test.ts` | 10 |

## Summary

| Severity | Open | Fixed |
|----------|------|-------|
| bug | 0 | 1 |
| suggestion | 0 | 5 |
| nit | 0 | 6 |
| **Total** | **0** | **12** |

**Verdict:** All 12 issues resolved. Apply migration `023_member_profiles_self_service_field_guard.sql` before production deploy.