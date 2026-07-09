## Review Issues (Round 2)

### Issue 16 [General] — Severity: bug
- **File**: app/permit-test/page.tsx:1587,1692,2681-2687
- **Description**: numberOfPiecesDraft only commits to formData on onBlur; save handlers use formData without flushing draft, so approve-without-blur persists stale piece count
- **Suggestion**: Resolve pieces synchronously at save time via resolvePiecesForSubmit(formData, draft) and pass into buildPermitCargoSnapshot; add test
- **Status**: fixed
- **Response**: Added `resolvePiecesForSubmit` in `lib/load-details-options.ts`. Both `handleApproveAndSave` and `handleApproveSpecificOption` now resolve draft → `resolvedPieces`, clear draft, sync `formData`, and pass `cargoFormData` (with resolved count) into `buildPermitCargoSnapshot`. Unit test covers draft-over-committed precedence.

### Issue 17 [General-2] — Severity: suggestion
- **File**: lib/portal-review-display.ts:108-114
- **Description**: formatLoadReviewDetails sanitizes invalid numberOfPieces: 0 to 1 and displays "1 piece" instead of omitting like invalid enums
- **Suggestion**: Omit piece count when raw value is missing or invalid (0, non-finite); update test
- **Status**: fixed
- **Response**: Added display-only `formatNumberOfPiecesLabel` (omits invalid/missing, no coercion). `formatLoadReviewDetails` now uses it instead of `sanitizeNumberOfPieces`. Updated test: `numberOfPieces: 0` → `null`, `hasContent: false` when all subfields invalid.

### Issue 18 [General] — Severity: nit
- **File**: app/permit-test/page.tsx:2710-2725
- **Description**: Move fieldset lacks aria-label parity with Loaded fieldset
- **Suggestion**: Add aria-label="Move type" on Move fieldset
- **Status**: fixed
- **Response**: Added `aria-label="Move type"` on the Move `<fieldset>`. Source-inspection test asserts both aria labels.

---

## Round 2 Test Results

```
✓ lib/load-details-options.test.ts (6 tests)
✓ lib/permit-cargo-snapshot.test.ts (3 tests)
✓ lib/permit-requests.test.ts (6 tests)
✓ lib/portal-review-display.test.ts (12 tests)
✓ app/permit-test/load-details-ui.test.ts (4 tests)

Test Files  5 passed (5)
Tests       31 passed (31)
```

Command: `npx vitest run lib/load-details-options.test.ts lib/permit-cargo-snapshot.test.ts lib/permit-requests.test.ts lib/portal-review-display.test.ts app/permit-test/load-details-ui.test.ts`