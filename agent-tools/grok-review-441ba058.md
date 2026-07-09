# Merged Review — IMPL_ID 441ba058

## Issue 1 — Severity: bug, Status: fixed
Summary shown only when driverFullName trim; should show when selectedDriverKey set using formatDriverSummaryLine

**Response:** Summary row now gates on `selectedDriverKey` only and always renders `formatDriverSummaryLine(pickPermitCarrierDriverFields(formData))` when a driver is selected.

## Issue 2 — Severity: suggestion, Status: fixed
Carrier mode subtitle copy — update to driver-focused message

**Response:** Carrier mode subtitle updated to: "Select a saved driver — carrier details are applied automatically for permits."

## Issue 3 — Severity: suggestion, Status: fixed
Service mode section copy — don't mention team member select when no picker

**Response:** Service mode subtitle updated to: "Enter carrier and driver details manually for this permit request." Removed team-member picker language from service mode.

## Issue 4 — Severity: suggestion, Status: fixed
validateForm: require selectedDriverKey in carrier mode

**Response:** `validateForm` adds `newErrors['driver'] = 'Please select a driver'` when `workspaceMode === 'carrier' && !selectedDriverKey`.

## Issue 5 — Severity: suggestion, Status: fixed
Validate selectedDriverKey against driverSelectOptions after load; clear if stale

**Response:** `useEffect` on `[driverSelectOptions, selectedDriverKey]` clears key, picker, and `EMPTY_PERMIT_CARRIER_DRIVER_FIELDS` when the composite key is no longer in options after roster reload.

## Issue 6 — Severity: suggestion, Status: fixed
Reset selectedDriverKey + carrier fields when workspaceMode changes

**Response:** `useEffect` on `[workspaceMode]` resets `selectedDriverKey`, `showDriverPicker`, and carrier/driver form fields.

## Issue 7 — Severity: nit, Status: fixed
Carrier mode section title → "Driver" or "Driver for this load"

**Response:** Carrier mode heading set to **Driver for this load**; service mode keeps **Carrier & Driver**.

## Issue 8 — Severity: nit, Status: fixed
Add partial-field formatDriverSummaryLine tests

**Response:** Added tests for name-only, state-only CDL, and CDL number without state in `lib/permit-profile-autofill.test.ts`.

## Issue 9 — Severity: suggestion, Status: fixed
UI tests: negative service gating, driverSelectionKey on options, summary wiring

**Response:** `permit-profile-ui.test.ts` updated with service-mode negative gating, `driverSelectionKey(option)` assertion, `pickPermitCarrierDriverFields(formData)` summary wiring, validateForm driver requirement, and stale-selection/workspace reset checks.

## Issue 10 — Severity: nit, Status: fixed
Add loading state for team roster like rig loading

**Response:** Added `loadingDrivers` state in `loadPermitTeamData` (mirrors `loadingRigs`) and **Loading drivers…** message in carrier-mode summary row.