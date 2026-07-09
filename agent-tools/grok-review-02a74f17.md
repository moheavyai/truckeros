# Merged Review: Forced Carrier Owner (02a74f17)

**Round 1** — 6 reviewers (3 general, security, tests)  
**Round 2** — Re-review after fix round 1

## Open Issues (must fix)

### 1 [bug] showEditCarrierButton blocks forced owner
- **File:** `app/profile/page.tsx:1165-1170`
- **Fix:** `(canWriteProfile || forcedCarrierOwner) && canManageCarrier && ...`
- **Status:** fixed

### 2 [bug] DB trigger blocks is_primary_owner promotion on org-linked UPDATE
- **File:** `supabase/migrations/020_member_profiles_privileged_columns.sql:60-62` vs `prepareMemberProfileSave`
- **Fix:** Use `supabaseAdmin` service-role upsert for forced-owner `carrier_only` saves when promotion needed (auth.uid() bypass in triggers)
- **Status:** fixed

### 3 [bug] Carrier fields silently reverted when promotion fails (trigger 023)
- **Related to #2** — non-primary org-linked forced owner UPDATE reverts company_name
- **Status:** fixed (via #2 admin upsert)

### 4 [suggestion] Add tests: null profile bootstrap, Viewer forced-owner API, ensureOrganizationBootstrap calls
- **Status:** fixed

### 5 [suggestion] handleSave lacks forced-owner bypass for Save Profile
- **File:** `app/profile/page.tsx:909-911`
- **Fix:** Mirror carrier save bypass for self member saves when forcedCarrierOwner
- **Status:** fixed

### 6 [security] Hardcoded email backdoor — ACCEPTED per user request
- **Status:** wontfix (intentional)

## Round 2 Issues

### 7 [bug] ensureOrganizationBootstrap fails RLS after successful admin upsert
- **File:** `lib/team-member-profiles-api.ts:279`
- **Fix:** Pass `upsertClient` (admin when forced-owner carrier_only used admin upsert) to `ensureOrganizationBootstrap` so organizations/organization_memberships writes bypass RLS
- **Status:** fixed

### 8 [suggestion] Admin upsert fallback leaves org-linked forced owner on pre-fix failure mode
- **File:** `lib/team-member-profiles-api.ts`
- **Fix:** Throw when promotion/bootstrap requires admin and `SUPABASE_SERVICE_ROLE_KEY` is unset
- **Status:** fixed (round 3)

### 9 [nit] Save Profile button / field disable omit forcedCarrierOwner
- **File:** `app/profile/page.tsx:508`, `app/profile/page.tsx:1365`
- **Fix:** `(canWriteProfile || forcedCarrierOwner)` parity on Save Profile `disabled` guard and `isFieldDisabled`
- **Status:** fixed

## Round 3 Issues (final re-review)

### 10 [bug] Forced-owner full save bypasses admin client on null-profile bootstrap
- **File:** `lib/team-member-profiles-api.ts:256-259`
- **Fix:** Use `supabaseAdmin` for all forced-owner self-saves when admin is available, not only `carrier_only`
- **Status:** fixed

### 11 [bug] Forced-owner org-linked promotion fails without service role key
- **File:** `lib/team-member-profiles-api.ts`
- **Fix:** `forcedCarrierOwnerNeedsAdminPromotion` + throw `Carrier save requires SUPABASE_SERVICE_ROLE_KEY on server for account promotion.`
- **Status:** fixed

## Summary
All actionable bugs and suggestions resolved through fix round 3. Security backdoor is by design.