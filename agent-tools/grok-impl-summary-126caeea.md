# Profile Page UX & Role Logic — Implementation Summary

## Files Changed

| File | Change |
|------|--------|
| `app/profile/page.tsx` | Landing UX (Carrier + Team Roster), conditional member edit card, driver approval flow, carrier merge on save |
| `lib/profile-field-permissions.ts` | **New** — role/field helpers, restricted-field detection |
| `lib/profile-field-permissions.test.ts` | **New** — unit tests |
| `lib/profile-change-requests.ts` | **New** — submit/list change requests |
| `app/api/profile-change-requests/route.ts` | **New** — GET (admin pending) / POST (driver submit) |
| `supabase/migrations/022_profile_change_requests.sql` | **New** — `profile_change_requests` table + RLS |
| `lib/profile-persistence.ts` | `mergeCarrierFieldsOntoProfile` to prevent carrier revert |
| `lib/profile-persistence.test.ts` | Tests for carrier merge |
| `lib/member-profile.ts` | Landing/edit-card helpers, save button labels |
| `lib/member-profile.test.ts` | Tests for new helpers |
| `lib/team-member-profiles-api.ts` | Server-side driver restricted-field stripping on self-save |
| `app/profile/profile-ui.test.ts` | Updated for new layout and driver flow |

## Design Decisions

### 1. Carrier save persistence (no revert)
- After **Save Carrier Info**, profile state uses `mergeCarrierFieldsOntoProfile(refreshed, result.savedProfile)` so API-returned carrier columns win over a potentially stale post-save Supabase read.
- Existing `resolveRefreshedOwnProfile` (API-first) retained; merge adds a second guard on carrier columns specifically.

### 2. Simplified landing view

| View | Content |
|------|---------|
| **Landing** | Carrier Information card + Team Roster table |
| **+ Add New Member** | Opens **New Team Member** edit card (not inline on landing) |
| **Edit (roster row)** | Opens member edit card for that person |
| **Bootstrap (no profile)** | Carrier card + member edit card for first-time setup |

- Removed the large always-visible **Team Members** section and dropdown selector.
- **+ Add New Member** lives in the Team Roster header; **Save New Member** is the top-right submit on the new-member card.
- **User Roles** moved to the bottom of the member edit card (no separate “User Roles” heading).
- After saving a new roster member, UI returns to landing (roster refreshed).

### 3. Role-based field edit logic

| Role | Profile page behavior |
|------|----------------------|
| **Owner/Admin (primary owner)** | Full edit + carrier global edits (unchanged) |
| **Driver** | May edit contact fields directly (`driver_phone`, `driver_email`, `emergency_contact`) |
| **Driver restricted** | `driver_full_name`, `cdl_number`, `cdl_state`, `date_of_birth` — editable in UI with **“Requires Admin approval”** banner; on save, restricted deltas go to `profile_change_requests` while allowed fields persist immediately |
| **Server** | `selfSaveFormForActor` strips restricted driver field changes before upsert (defense in depth) |

### 4. Profile change requests
- Drivers POST to `/api/profile-change-requests` with form + `baseline_profile`.
- Primary owners can GET pending requests for their org (approval UI not built in this pass).
- Migration `022_profile_change_requests.sql` must be applied before the API works in production.

## Test Results

```
node node_modules/vitest/vitest.mjs run \
  app/profile/profile-ui.test.ts \
  lib/member-profile.test.ts \
  lib/member-profile-permissions.test.ts \
  lib/profile-persistence.test.ts \
  lib/profile-field-permissions.test.ts
```

**111/111 passing** (profile-ui 27, member-profile 54, member-profile-permissions 15, profile-persistence 8, profile-field-permissions 7)

## Limitations / Out of Scope

- **Load details** and **routing envelope** are not on the profile page (they live on the dashboard / routing surfaces). Helpers `DRIVER_EDITABLE_LOAD_DETAIL_FIELD_KEYS` and `DRIVER_EDITABLE_ROUTING_FIELD_KEYS` are stubbed in `profile-field-permissions.ts` for future use.
- **Admin approval UI** for pending `profile_change_requests` is API-only (GET list); no in-app approve/reject workflow yet.
- Migration `022` is not yet added to `lib/migration-manifest.json` (manual apply or manifest update needed for automated migrate scripts).
- Profile UI tests remain source-inspection only (no RTL render harness).