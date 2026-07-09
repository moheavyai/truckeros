# Merged Review — IMPL_ID 989a5774

## Issue 1 [General] — Severity: bug
- **File**: app/permit-test/page.tsx:1541–1674
- **Description**: handleApproveSpecificOption saves + opens portals but does NOT navigate to portal-assist?requestId=...&step=review
- **Suggestion**: Mirror handleApproveAndSave navigation after successful save
- **Status**: fixed
- **Response**: Added `requestId` extraction and `router.push(\`/portal-assist?requestId=${requestId}&step=review\`)` after successful save in `handleApproveSpecificOption`, matching `handleApproveAndSave`. Also sets `setSavedRequestId(requestId)`.

## Issue 2 [General-2] — Severity: bug
- **File**: app/api/portal-submissions/route.ts
- **Description**: human_approved trusted from client POST body; ignoreDuplicates silently drops approval updates
- **Suggestion**: Server-set human_approved only on dedicated approve action; upsert approval fields on conflict
- **Status**: fixed
- **Response**: Replaced `insert` + `ignoreDuplicates` with `upsert` on `(permit_request_id, state_code)`. `human_approved` is now server-controlled: `true` only when `record_approval === true` or when preserving an existing approved row. Client `body.human_approved` is ignored. Portal Assist approve gate sends `record_approval: true`.

## Issue 3 [General] — Severity: suggestion
- **File**: lib/portal-review-display.ts
- **Description**: formatLoadReviewDetails uses envelope only; should prefer cargo.load when present
- **Suggestion**: Prefer cargo.load fields, fallback to request envelope; add test
- **Status**: fixed
- **Response**: Added `resolveLoadDimensions()` to prefer `cargo.load` (`weightLbs`, `lengthFt`, etc. with snake_case fallbacks) over request envelope fields. Test added in `portal-review-display.test.ts`.

## Issue 4 [General-3] — Severity: suggestion
- **File**: app/portal-assist/page.tsx
- **Description**: Carrier/Driver sections hidden when empty; demo lacks carrierDriver
- **Suggestion**: Show placeholder when empty; add carrierDriver to demo request
- **Status**: fixed
- **Response**: CARRIER INFO and DRIVER sections always render; empty state shows italic placeholder text. Demo request `cargo.carrierDriver` populated with sample carrier/driver data.

## Issue 5 [Tests] — Severity: suggestion
- **File**: lib/portal-review-display.test.ts
- **Description**: Missing snake_case, partial field, driver null tests
- **Suggestion**: Add tests per PRD-1, PRD-2, PRD-3
- **Status**: fixed
- **Response**: Added snake_case carrier test (PRD-1), partial carrier fields test (PRD-2), driver-null/empty test (PRD-3), plus `cargo.load` preference and `hasContent` tests.

## Issue 6 [Tests] — Severity: suggestion
- **File**: app/portal-assist/portal-assist-ui.test.ts
- **Description**: Missing approved=1, launch hint suppression, DRIVER label, right-column no Regenerate tests
- **Suggestion**: Add PAU-1 through PAU-5 assertions
- **Status**: fixed
- **Response**: Added tests for `approved=1` param, `launchHint && !isReviewStep`, DRIVER label, right-column `{!request && (` guard, `approvalError` separation, confirm dialog, placeholders, demo carrierDriver, `record_approval`, parse error copy, and `handleApproveSpecificOption` navigation.

## Issue 7 [General-2] — Severity: suggestion
- **File**: app/portal-assist/page.tsx:411–415
- **Description**: Approval gate errors shown via credentialError
- **Suggestion**: Use approvalError rendered in approval panel
- **Status**: fixed
- **Response**: Added `approvalError` state; `handleApproveGate` uses `setApprovalError` for validation and API failures. Error rendered in approval panel via `ErrorDisplay`. Cleared in `applyPortalState`.

## Issue 8 [General] — Severity: nit
- **File**: app/portal-assist/page.tsx
- **Description**: Parse error mentions 'Generate / Regenerate Prefill' — no Generate button
- **Suggestion**: Update copy to match Regenerate Prefill in Final Review
- **Status**: fixed
- **Response**: Parse error updated to `"Load a request and click 'Regenerate Prefill' in Final Review first."`

## Issue 9 [General] — Severity: nit
- **File**: lib/portal-review-display.ts
- **Description**: LoadReviewDetails.hasContent always true, unused
- **Suggestion**: Compute from meaningful fields or remove
- **Status**: fixed
- **Response**: `hasContent` now computed from weight, dimensions, overhang, or cargo description presence. Test verifies `false` when all fields empty.

## Issue 10 [General-2] — Severity: suggestion
- **File**: lib/portal-assistant.ts
- **Description**: generatePortalPrefill does not include carrier/driver from cargo.carrierDriver
- **Suggestion**: Add carrier/driver fields to generatedFields for portal mapping display
- **Status**: fixed
- **Response**: Added `carrier_company`, `carrier_usdot`, `carrier_mc`, `carrier_phone`, `carrier_email`, `driver_name`, `driver_cdl`, `driver_cdl_state`, `driver_phone` to `generatedFields` from `cargo.carrierDriver`. Test added in `portal-assistant.test.ts`.

## Issue 11 [General-3] — Severity: suggestion
- **File**: app/portal-assist/page.tsx
- **Description**: Regenerate after approval resets state without warning
- **Suggestion**: Confirm dialog when isApproved before regenerating
- **Status**: fixed
- **Response**: `handleRegeneratePrefill` shows `window.confirm` when `isApproved` before calling `applyPortalState`.

---

## Updated Implementation Summary (review fixes — IMPL_ID 989a5774)

### Files changed (review fix pass)

| File | Change |
|------|--------|
| `app/permit-test/page.tsx` | `handleApproveSpecificOption` navigates with `step=review` |
| `app/api/portal-submissions/route.ts` | Server-controlled `human_approved` + upsert on conflict |
| `app/api/portal-submissions/route.test.ts` | **New** — API security/upsert tests |
| `app/portal-assist/page.tsx` | `approvalError`, placeholders, demo carrierDriver, confirm dialog, `record_approval` |
| `lib/portal-review-display.ts` | `cargo.load` preference, computed `hasContent` |
| `lib/portal-review-display.test.ts` | Expanded coverage (snake_case, partial, hasContent, cargo.load) |
| `lib/portal-assistant.ts` | Carrier/driver fields in `generatePortalPrefill` |
| `lib/portal-assistant.test.ts` | Carrier/driver prefill test |
| `app/portal-assist/portal-assist-ui.test.ts` | PAU-1–5 + review-fix assertions |

### Test results

```
npm test
Test Files  51 passed | 2 skipped (53)
Tests       544 passed | 4 skipped (548)
```

All 11 review issues resolved.