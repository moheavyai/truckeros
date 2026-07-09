# Merged Review Round 1: Permit Profile Autofill (3b02a731)

## Open bugs (must fix)

### 1 [bug] Deselect driver does not clear autofill
- **File:** `app/permit-test/page.tsx` — `handleDriverSelect`
- **Fix:** When empty key selected, reset carrier/driver fields to `EMPTY_PERMIT_CARRIER_DRIVER_FIELDS`
- **Status:** fixed

### 2 [bug] Driver-only selection wipes carrier fields
- **File:** `lib/permit-profile-autofill.ts` — `memberProfileToPermitAutofill`
- **Fix:** Merge carrier fields from org carrier source (actor profile or first profile with carrier data) when selected driver row lacks carrier columns; only overwrite non-empty profile values OR use `mergePermitAutofillPatch(existing, patch)` that preserves existing carrier when patch carrier is empty
- **Status:** fixed

### 3 [suggestion] Fix false-positive UI test for analyze payload dotNumber
- **File:** `app/permit-test/permit-profile-ui.test.ts`
- **Status:** fixed

### 4 [suggestion] Add unit tests for deselect + carrier preservation
- **Status:** fixed

## Accepted / wontfix this round
- RLS org-wide read (pre-existing) — document only
- Service Mode full implementation — future effort (stub present)

## Fix round 1 summary (2026-07-07)

- `handleDriverSelect` now clears `selectedDriverKey` and resets to `EMPTY_PERMIT_CARRIER_DRIVER_FIELDS` on deselect
- Added `mergePermitAutofillPatch`, `resolveOrgCarrierProfileForAutofill`, and `carrierSource` option on `memberProfileToPermitAutofill`
- UI tests now slice `analyzePayload`, `changePayload`, and `analyze-permit` blocks specifically (avoids false positive from `carrierDriver` save snapshot)
- Unit tests cover carrier preservation, carrierSource fill, and deselect reset behavior