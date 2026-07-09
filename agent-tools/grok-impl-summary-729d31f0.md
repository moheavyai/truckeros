# Service Mode Implementation Summary

## Overview

Service Mode is now fully functional: permit clerks can toggle workspace mode in the header, search/select carriers inline, and have drivers, equipment, rigs, and permit autofill scoped to the selected carrier organization.

## Files Changed

### New files
- `components/CarrierSelector.tsx` — Searchable carrier dropdown with summary chip (name, USDOT, role) and "Manage carriers" link
- `lib/service-mode-scope.ts` — Scoping helpers: `resolvePermitOrganizationId`, `resolveEquipmentScope`, `fetchCarrierPrimaryOwnerUserId`, `filterAccessibleCarriers`, `carrierSummaryLabel`
- `lib/service-mode-scope.test.ts` — Unit tests for scope helpers
- `components/carrier-context-ui.test.ts` — Source-inspection tests for header/service-mode UI
- `supabase/migrations/024_service_mode_membership_rls.sql` — Membership-based read RLS for service mode

### Updated files
- `components/CarrierContextBar.tsx` — Mode toggle + inline `CarrierSelector` in service mode (removed link-only carrier change)
- `components/ActiveCarrierBanner.tsx` — Confirms page scope; points to header picker; removed TODOs
- `components/AppHeader.tsx` — Shows **Carriers** nav link when `workspaceMode === 'service'`
- `components/AppHeader.test.ts` — Updated nav expectations
- `lib/organization-context.ts` — Auto-selects first accessible carrier when entering service mode without a valid selection
- `lib/member-profile-permissions.ts` — Added `buildOrganizationTeamMemberList` for full org roster in service mode
- `lib/permit-profile-autofill.ts` — Removed `SERVICE_MODE_TODO`; documented org-scoped roster loading
- `app/permit-test/page.tsx` — Full service-mode wiring (team, drivers, equipment, rigs, validation, UI)
- `app/permit-test/permit-profile-ui.test.ts` — Updated for service-mode driver picker + scoping
- `app/equipment/page.tsx` — Equipment/rig loads scoped by `effectiveOrganizationId`
- `lib/migration-manifest.json`, `lib/migrations.ts`, `lib/migrations.test.ts` — Registered migration 024

## Design Decisions

### 1. Carrier picker in header (not permit page)
Carrier selection lives in `CarrierContextBar` via `CarrierSelector`. Permit and equipment pages consume `effectiveOrganizationId` from `useOrganizationContext`. This avoids duplicate pickers and keeps context global.

### 2. Service mode permit UI mirrors carrier mode
Removed the manual carrier/driver form grid in service mode. Clerks select a carrier in the header, then use the same rig-style **Select Driver** picker with autofill from the carrier's `member_profiles` / `team_member_profiles`.

### 3. Organization scoping keys
- **Drivers / default driver storage**: `permitOrganizationId` = `effectiveOrganizationId` in service mode, `ownOrganizationId` in carrier mode
- **Team roster**: `loadPermitTeamData` queries by `effectiveOrganizationId` in service mode; uses `buildOrganizationTeamMemberList` (no primary-owner gate)
- **Equipment profiles**: filter by `organization_id` when in service mode
- **Rig configurations**: no `organization_id` column — loads primary owner's `user_id` rigs via `fetchCarrierPrimaryOwnerUserId`

### 4. Auto-select UX
- First accessible carrier auto-selected when switching to service mode with no valid stored selection
- Default driver auto-selected per organization (localStorage key uses `permitOrganizationId`)
- Rig selection resets when scoped carrier changes in service mode

### 5. RLS migration (024)
Extended SELECT policies so permit clerks with `organization_memberships` can read:
- `member_profiles` and `team_member_profiles` for linked orgs
- `equipment_profiles` by `organization_id`
- `rig_configurations` owned by primary owners of linked orgs

Writes remain unchanged (user-owned / primary-owner only).

## Schema Assumptions

| Table | Scoping approach |
|-------|------------------|
| `member_profiles` | `organization_id` + membership RLS |
| `team_member_profiles` | `organization_id` + membership RLS |
| `equipment_profiles` | `organization_id` column (nullable, backfilled in 021) + membership RLS |
| `rig_configurations` | `user_id` only — resolved via primary owner's `member_profiles.user_id` |
| `organizations` | Already readable via `auth_user_membership_org_ids()` (021) |

**Note:** Migration 024 must be applied to Supabase for clerk cross-carrier reads to work in production.

## Test Results

Affected tests (all passing):

```
✓ components/carrier-context-ui.test.ts (5)
✓ components/AppHeader.test.ts (4)
✓ app/permit-test/permit-profile-ui.test.ts (15)
✓ lib/migrations.test.ts (11)
✓ lib/service-mode-scope.test.ts (4)
✓ lib/organization-context.test.ts (8)
```

**47/47 passed** in targeted run.

Pre-existing failures in `app/profile/profile-ui.test.ts` (2 tests) are unrelated to this work.

## Carrier Mode Safety

Carrier mode behavior is preserved:
- `resolveEffectiveOrganizationId` still returns `ownOrganizationId` in carrier mode
- `loadPermitTeamData` still uses `isPrimaryOwner` gate for own org
- Driver picker, default driver, and validation unchanged for carrier users
- Switching to carrier mode clears `activeOrganizationId` (existing behavior)