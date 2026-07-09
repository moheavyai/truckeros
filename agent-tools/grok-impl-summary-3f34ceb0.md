# Implementation Summary — Load Details cargo fields (IMPL_ID: 3f34ceb0)

## Files changed

| File | Change |
|------|--------|
| `app/permit-test/page.tsx` | formData fields, compact UI row, cargo payload updates |
| `lib/load-details-options.ts` | **New** — types, option constants, `clampNumberOfPieces` helper |
| `lib/load-details-options.test.ts` | **New** — unit tests for constants and clamp helper |
| `app/permit-test/load-details-ui.test.ts` | **New** — source-inspection tests for page wiring |

## What was added/modified

### 1. `formData` state (`app/permit-test/page.tsx`)

Added three fields with defaults:

- `numberOfPieces: 1` (number)
- `loadedArrangement: 'side-by-side'` (`'side-by-side' | 'end-to-end' | 'stacked'`)
- `moveType: 'hauled'` (`'hauled' | 'self-propelled' | 'towed'`)

Defaults/constants live in `lib/load-details-options.ts` to keep `page.tsx` lean and testable.

### 2. Load Details UI row

Inserted immediately under the **Description** input (before Manufacturer / Make-Model), as a full-width (`md:col-span-2`) compact row:

- **No. of Pieces** — narrow number input (`w-14`), `min={1}`, clamped via `clampNumberOfPieces` on change and blur
- **Loaded:** — inline radio group (`side-by-side`, `end-to-end`, `stacked`)
- **Move:** — inline radio group (`hauled`, `self-propelled`, `towed`)

Layout: `flex flex-wrap items-center gap-x-4 gap-y-2` inside a light bordered panel (`border rounded p-2 bg-gray-50`), matching existing `text-xs` label styling. Wraps naturally on small screens.

### 3. Cargo payload on permit submit

Both `cargo` objects (analyze + change/save flows, ~lines 1571 and 1706) now include:

```ts
numberOfPieces: formData.numberOfPieces,
loadedArrangement: formData.loadedArrangement,
moveType: formData.moveType,
```

These persist in `permit_requests.cargo` JSON alongside existing description/manufacturer/load dimension fields.

### 4. Types

No changes to `types/permit.ts` or `types/equipment.ts`. `SavePermitRequestInput.cargo` is already `Record<string, any>`. Typed unions exported from `lib/load-details-options.ts` for form state only.

## Design decisions

1. **Helper module over inline constants** — Mirrors `lib/permit-profile-autofill.ts` pattern; keeps option lists and clamp logic in one place with dedicated unit tests.
2. **Radio buttons, not dropdowns** — Per requirements; compact inline `<label>` + `<input type="radio">` since no existing radio styling was found in the codebase.
3. **Clamp on change and blur** — `numberOfPieces` cannot go below 1; non-finite values fall back to `1`.
4. **Defaults** — `side-by-side` and `hauled` chosen as the most common oversize load arrangements/move types.
5. **Dynamic option labels in JSX** — Options rendered via `.map()` over shared constants so labels stay DRY; UI tests assert the map wiring rather than hard-coded strings in `page.tsx`.

## Test results

```
✓ app/permit-test/load-details-ui.test.ts (4 tests)
✓ lib/load-details-options.test.ts (2 tests)

Test Files  2 passed (2)
Tests       6 passed (6)
```

Targeted run:

```bash
npx vitest run lib/load-details-options.test.ts app/permit-test/load-details-ui.test.ts
```

Full `npm test` suite: 2 pre-existing failures in `app/profile/profile-ui.test.ts` (unrelated to this change). All new load-details tests pass.