# Forced Carrier Owner — Fix Round 3

## Summary

Addressed final re-review open bugs: forced-owner self-saves now use the admin client for **all** save scopes (`full`, `member_only`, `carrier_only`) when `SUPABASE_SERVICE_ROLE_KEY` is configured, and throw a clear error when promotion/bootstrap requires admin but the service role key is missing.

## Changes

### 1. `lib/team-member-profiles-api.ts`

- **`forcedCarrierOwnerNeedsAdminPromotion`** — Detects when a forced-owner self-save must promote `is_primary_owner` or bootstrap an org (null profile, no `organization_id`, or org-linked non-primary row).
- **Admin client for all forced-owner self-saves** — `upsertClient` selects `supabaseAdmin` whenever `forcedCarrierOwner && hasAdminAccess && supabaseAdmin`, regardless of `saveScope`. Fixes full-scope **Save Profile** bootstrap path that previously left `ensureOrganizationBootstrap` on the authed client (RLS failure on `organization_memberships`).
- **Hard fail without service role** — When promotion/bootstrap is required and admin is unavailable, throws: `Carrier save requires SUPABASE_SERVICE_ROLE_KEY on server for account promotion.` Replaces the round-2 dev-only `console.warn`.

### 2. Tests — `lib/team-member-profiles-api.test.ts`

- Mutable `adminAccessState` mock for toggling `hasAdminAccess` / `supabaseAdmin` per test.
- **New:** forced owner `full` save on null-profile bootstrap uses admin upsert + admin org bootstrap.
- **New:** forced owner `full` save promoting org-linked non-primary Owner/Admin uses admin upsert.
- **New:** throws when promotion/bootstrap needed but admin access missing (`carrier_only` and `full`).
- Updated bootstrap gate source assertions for new admin-selection and error-throw patterns.

## Design decisions

1. **Admin for all forced-owner self-saves when available** — Even already-primary forced owners use admin when configured; harmless and keeps one selection rule.
2. **Throw only when admin is required** — Forced owners who are already primary owners can still save via authed client if service role key is absent.
3. **Error replaces dev warning** — Production deployments missing `SUPABASE_SERVICE_ROLE_KEY` now get an explicit 500 message instead of silent fallback into trigger/RLS failures.

## Test results

```
npx vitest run lib/forced-carrier-owner.test.ts lib/team-member-profiles-api.test.ts app/profile/profile-ui.test.ts
```

| File | Tests |
|------|-------|
| `lib/forced-carrier-owner.test.ts` | 4 passed |
| `lib/team-member-profiles-api.test.ts` | 24 passed |
| `app/profile/profile-ui.test.ts` | 35 passed |
| **Total** | **63/63 passed** |

## Files changed

| File | Change |
|------|--------|
| `lib/team-member-profiles-api.ts` | All-scope admin client + promotion gate + throw |
| `lib/team-member-profiles-api.test.ts` | Full-scope admin tests + missing-admin error tests |
| `agent-tools/grok-review-02a74f17-final.md` | Round 3 issues marked fixed |
| `agent-tools/grok-review-02a74f17.md` | Round 3 issues added and fixed |
| `agent-tools/grok-impl-summary-02a74f17.md` | This document |

## Prior rounds (reference)

- **Round 1:** UI bypasses, admin upsert for forced `carrier_only` member_profiles promotion.
- **Round 2:** `ensureOrganizationBootstrap` reuses `upsertClient`; Save Profile / `isFieldDisabled` UI parity; dev warning for missing service role.