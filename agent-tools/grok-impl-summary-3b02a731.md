# Connect Member Profiles to Permit Agent — Implementation Summary

## Overview

Connected saved team member profiles to the Permit Agent / New Route Analysis form (`app/permit-test/page.tsx`). In **Carrier Mode**, users can select a driver from the team roster and immediately auto-fill carrier and driver fields for permit workflows.

## Files Created

### `lib/permit-profile-autofill.ts`
Pure helper module for permit form autofill:
- **`PermitCarrierDriverFormFields`** — typed target fields (carrier + driver + `dotNumber`/`mcNumber` API aliases)
- **`memberProfileToPermitAutofill(profile, options?)`** — maps rows to form patch; fills carrier from `carrierSource` when driver row lacks carrier data
- **`mergePermitAutofillPatch(existing, patch)`** — preserves existing carrier fields when patch carrier values are empty
- **`resolveOrgCarrierProfileForAutofill(actor, orgMembers)`** — picks org carrier source (actor or first member with carrier data)
- **`buildDriverSelectOptions(teamMembers)`** — dropdown options with `display_name` + role hint
- **`resolveDriverProfileForSelection(...)`** — resolves full row by `id` or `user_id` for autofill
- **`permitFormToLoadDetailsCarrierFields(...)`** — extracts `dotNumber` / `mcNumber` for agent/API payloads
- **`SERVICE_MODE_TODO`** comment stub for future carrier-first → driver filtering by `effectiveOrganizationId`

### `lib/permit-profile-autofill.test.ts`
Unit tests for mapping, options builder, selection resolution, key helpers, and API field extraction.

### `app/permit-test/permit-profile-ui.test.ts`
Source-inspection tests (project pattern) verifying UI wiring, team data load, carrier-mode gating, API payload fields, and service-mode stub.

## Files Modified

### `app/permit-test/page.tsx`
- Added **`CarrierContextBar`** in header area (alongside existing `ActiveCarrierBanner`)
- Loads full **`member_profiles`** row + team roster via **`loadPermitTeamData`** (reuses `buildTeamMemberList` / `isPrimaryOwner` pattern from profile page)
- Extended **`formData`** with carrier/driver fields via `EMPTY_PERMIT_CARRIER_DRIVER_FIELDS`
- New **"Carrier & Driver"** section at top of form with:
  - **Select Driver** dropdown (Carrier Mode only)
  - Empty state linking to `/profile` when no team members
  - Editable carrier + driver inputs (auto-filled on selection change via `handleDriverSelect`)
  - Deselecting driver clears carrier/driver fields; driver-only selection preserves org carrier data
- **`dotNumber` / `mcNumber`** passed through:
  - `/api/optimize-route` (auto route analysis + change route OR-Tools path)
  - `/api/analyze-permit` (change route quick path)
- **`carrierDriver`** snapshot included in both `/api/permit-requests` save payloads (inside `cargo`)
- Service Mode comment stub in UI for future Select Carrier → Select Driver flow

## Field Mapping (profile → permit form)

| Profile field | Permit form field |
|---------------|-------------------|
| `company_name` | `companyName` |
| `usdot_number` | `usdotNumber` + `dotNumber` |
| `mc_number` | `mcNumber` |
| `ein` | `ein` |
| `carrier_address` | `carrierAddress` |
| `carrier_phone` | `carrierPhone` |
| `carrier_email` | `carrierEmail` |
| `insurance_contact` | `insuranceContact` |
| `driver_full_name` | `driverFullName` |
| `cdl_number` | `cdlNumber` |
| `cdl_state` | `cdlState` |
| `driver_phone` | `driverPhone` |
| `driver_email` | `driverEmail` |
| `date_of_birth` | `dateOfBirth` |
| `emergency_contact` | `emergencyContact` |

## Fix Round 1 (review 3b02a731)

- Deselect clears `selectedDriverKey` and resets carrier/driver fields
- Driver-only autofill keeps org carrier (company, USDOT, MC, etc.) via `carrierSource` + `mergePermitAutofillPatch`
- UI payload tests scoped to `analyzePayload` / `changePayload` / `analyze-permit` blocks (no false positive from save snapshot)

## Tests Run

```bash
npx vitest run lib/permit-profile-autofill.test.ts app/permit-test/permit-profile-ui.test.ts
```

**Result:** all tests passed (fix round 1)

## Notes

- Existing permit-test flows (rig picker, routing, geocoding, OR-Tools, save/history) unchanged
- Non-primary users see only their own profile in the driver list (same as profile Team Roster behavior)
- Manual edits to auto-filled fields remain possible after selection