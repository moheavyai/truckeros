## Review Issues (Round 2)

### Issue 21 [General] — Severity: bug
- **File**: app/equipment/page.tsx:102-104
- **Description**: fetchCarrierPrimaryOwnerUserId returns {userId,error} but equipment page sets whole result object as carrierPrimaryOwnerUserId
- **Suggestion**: Use result.userId like permit-test; surface result.error
- **Status**: fixed
- **Response**: Equipment page now uses `result.userId` and `result.error` with `loadingPrimaryOwner` state, matching permit-test pattern.

### Issue 22 [General] — Severity: suggestion
- **File**: app/equipment/page.tsx
- **Description**: Missing primary owner loading/error banners on equipment page
- **Suggestion**: Port permit-test primary owner UI
- **Status**: fixed
- **Response**: Added “Resolving carrier equipment owner…” and primary-owner error banner below `ActiveCarrierBanner`.

### Issue 23 [General] — Severity: suggestion
- **File**: app/equipment/page.tsx
- **Description**: Read-only service mode still shows Edit/Delete/New controls on trailers/rigs
- **Suggestion**: Hide/disable all mutation controls when isServiceModeReadOnly
- **Status**: fixed
- **Response**: Wrapped/hid Edit, Delete, New, Save, Build New Rig, Edit in Builder, Make Default, and editor forms behind `!isServiceModeReadOnly`; function guards remain as defense-in-depth.

### Issue 24 [General-3] — Severity: suggestion
- **File**: lib/organization-context.ts, components/CarrierSelector.tsx
- **Description**: Carrier picker and auto-select include Viewer/Driver-only memberships not eligible for service mode reads
- **Suggestion**: Filter to isServiceModeEligibleCarrier only for picker list and auto-select
- **Status**: fixed
- **Response**: Exported `filterServiceModeCarriers`; used in `CarrierContextBar`, `serviceModeCarriers` memo, auto-select, and `accessibleOrganizationIds`.

### Issue 25 [Security] — Severity: suggestion
- **File**: lib/organization-context.ts:167-168
- **Description**: Persisted service mode from localStorage not reverted when user becomes ineligible
- **Suggestion**: On load, if service mode && !canEnterServiceMode, force carrier mode
- **Status**: fixed
- **Response**: Added effect that calls `applyWorkspaceMode('carrier')` when `workspaceMode === 'service' && !canEnterServiceMode`.

### Issue 26 [General] — Severity: nit
- **File**: app/permit-test/page.tsx:2596
- **Description**: Empty rig state links to add equipment even in read-only service mode
- **Suggestion**: Service-mode appropriate copy
- **Status**: fixed
- **Response**: Service mode shows “No saved rig for this carrier.” without Equipment edit link; carrier mode keeps add link.

### Issue 27 [General-3] — Severity: nit
- **File**: app/permit-test/page.tsx:2309-2314
- **Description**: Permit-test header missing Equipment nav link
- **Suggestion**: Add /equipment link
- **Status**: fixed
- **Response**: Added Equipment nav link to permit-test custom header.

### Issue 28 [Security] — Severity: suggestion
- **File**: lib/permit-requests.ts
- **Description**: cargo.organizationId not validated server-side against service-mode membership
- **Suggestion**: Validate organizationId in sanitizeCargoSnapshot or save handler when present
- **Status**: fixed
- **Response**: Added `validateCargoOrganizationId` and `sanitizeCargoSnapshotForUser`; save handler strips unauthorized `organizationId` values before insert.

### Issue 29 [Tests] — Severity: suggestion
- **File**: lib/service-mode-scope.test.ts
- **Description**: fetchCarrierPrimaryOwnerUserId untested
- **Suggestion**: Add mocked unit tests for success/error/missing owner paths
- **Status**: fixed
- **Response**: Added three mocked tests for success, query error, and missing primary owner.

### Issue 30 [Tests] — Severity: suggestion
- **File**: app/permit-test/permit-profile-ui.test.ts
- **Description**: autoSelectRigDoneRef reset on primary owner resolve not asserted
- **Suggestion**: Add source slice
- **Status**: fixed
- **Response**: Added source-inspection test matching `result.userId` → `autoSelectRigDoneRef.current = false`.

---

## Implementation Summary (Round 2 Fixes)

### Files changed
- `lib/service-mode-scope.ts` — `filterServiceModeCarriers` export
- `lib/organization-context.ts` — eligible-carrier filtering, ineligible service-mode revert
- `components/CarrierContextBar.tsx` — filtered carrier list for picker
- `app/equipment/page.tsx` — primary owner fix, loading/error UI, full read-only mutation hiding
- `app/permit-test/page.tsx` — Equipment nav, service-mode empty rig copy
- `lib/permit-requests.ts` — server-side `organizationId` validation
- Tests: `lib/service-mode-scope.test.ts`, `lib/permit-requests.test.ts`, `app/permit-test/permit-profile-ui.test.ts`, `app/equipment/equipment-scope-ui.test.ts`, `components/carrier-context-ui.test.ts`

### Test results
```
✓ 5 test files, 45 tests passed
```

### Security note
`cargo.organizationId` is now validated server-side against own org, created org, or Permit Clerk / Owner / Admin membership before persistence. Invalid values are stripped rather than rejected outright to avoid breaking saves.