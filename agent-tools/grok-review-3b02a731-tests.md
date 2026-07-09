# Tests Specialist Review — Permit Profile Autofill

**Status:** open  
**Scope:** `lib/permit-profile-autofill.test.ts`, `app/permit-test/permit-profile-ui.test.ts`  
**Implementation:** `lib/permit-profile-autofill.ts`, `app/permit-test/page.tsx`  
**Related (out of scope but referenced):** `lib/member-profile-permissions.test.ts`, `app/api/analyze-permit/route.test.ts`, `app/api/optimize-route/route.test.ts`

**Do not fix in this review** — assessment only.

---

## Executive summary

The autofill feature has a **solid pure-function unit layer** for the happy-path mapping, driver resolution, and carrier-field extraction helpers. UI coverage follows the project’s accepted **source-inspection pattern** (same as `profile-ui.test.ts`) and confirms imports, carrier-mode gating, and coarse wiring.

**Main risks:**

1. **API payload wiring UI test is a false positive** — the `analyzePayload` ↔ `dotNumber` regex matches via the unrelated `carrierDriver` save block, not via `permitFormToLoadDetailsCarrierFields` spread.
2. **No end-to-end or handler-slice tests** for `handleDriverSelect`, `loadPermitTeamData`, or save/analyze payload assembly.
3. **Carrier mode gating is positive-only** — service mode absence of the dropdown is not asserted.
4. **Downstream API route tests** do not verify `dotNumber` / `mcNumber` reach `processPermitRequest`.

Estimated coverage: **~55% of critical paths** (helpers strong; integration and regression guards weak).

---

## Test inventory

| File | Tests | Style |
|------|-------|-------|
| `lib/permit-profile-autofill.test.ts` | 12 | Unit (vitest imports) |
| `app/permit-test/permit-profile-ui.test.ts` | 6 | Static source inspection |

---

## 1. Autofill mapping

### What is covered

| Case | Test |
|------|------|
| Full `member_profiles` row → all 16 form fields | `maps carrier and driver fields from a full profile row` |
| Driver-only row → empty carrier strings | `maps driver-only fields when carrier columns are empty` |
| `null` profile → `{}` | `returns empty patch for null profile` |
| `usdot_number` → `usdotNumber` + `dotNumber` | Implicit in full-profile test |
| `permitFormToLoadDetailsCarrierFields` fallback `usdotNumber` → `dotNumber` | `prefers dotNumber but falls back to usdotNumber` |
| Omit whitespace-only carrier IDs | `omits empty carrier identifiers` |

### Gaps (priority order)

| Priority | Gap | Risk | Suggested test |
|----------|-----|------|----------------|
| **P1** | **`trimField` / whitespace normalization** — implementation trims all mapped fields; no test for `"  123  "` → `"123"` or all-whitespace → `''` | Stale or padded DB values leak into forms/API | Unit: profile with padded `usdot_number`, `company_name`, etc. |
| **P1** | **`team_member_profiles` row mapping** — `memberProfileToPermitAutofill` accepts `MemberProfileFields`; `rosterProfile` fixture exists but is never passed to the mapper | Roster autofill path untested at mapper level | Unit: `memberProfileToPermitAutofill(rosterProfile)` with expected driver fields |
| **P2** | **`permitFormToLoadDetailsCarrierFields` when `dotNumber` ≠ `usdotNumber`** — test name says “prefers dotNumber” but only covers empty `dotNumber` | If fields diverge (manual edit bug), wrong value may ship to agent | Unit: `{ dotNumber: 'DOT-A', usdotNumber: 'DOT-B' }` → `dotNumber: 'DOT-A'` |
| **P2** | **Partial / sparse profiles** — `undefined` optional columns vs explicit `null` | Subtle empty-string vs missing-key behavior in spread patch | Unit: minimal object with only `driver_full_name` |
| **P3** | **`EMPTY_PERMIT_CARRIER_DRIVER_FIELDS` export** — used as form initializer in page; untested | Constant drift from type | Snapshot or shape test against `PermitCarrierDriverFormFields` keys |
| **P3** | **USDOT manual edit sync** — page `onChange` sets both `usdotNumber` and `dotNumber`; not covered anywhere | User edits USDOT but API still gets stale `dotNumber` | UI slice: assert paired assignment in USDOT input handler |

### Mapping coverage matrix

| Profile field | Form field | Unit tested |
|---------------|------------|-------------|
| `company_name` | `companyName` | ✅ (owner) |
| `usdot_number` | `usdotNumber`, `dotNumber` | ✅ (owner) |
| `mc_number` | `mcNumber` | ✅ (owner) |
| `ein` | `ein` | ✅ (owner) |
| `carrier_address` | `carrierAddress` | ✅ (owner) |
| `carrier_phone` | `carrierPhone` | ✅ (owner) |
| `carrier_email` | `carrierEmail` | ✅ (owner) |
| `insurance_contact` | `insuranceContact` | ✅ (owner) |
| `driver_full_name` | `driverFullName` | ✅ (owner + driver) |
| `cdl_number` | `cdlNumber` | ✅ |
| `cdl_state` | `cdlState` | ✅ |
| `driver_phone` | `driverPhone` | ✅ |
| `driver_email` | `driverEmail` | ✅ |
| `date_of_birth` | `dateOfBirth` | ✅ (owner only) |
| `emergency_contact` | `emergencyContact` | ✅ |
| Roster-only row | all | ❌ |

---

## 2. Driver select options

### What is covered

| Case | Test |
|------|------|
| Label format `display_name (Role)` | `builds labels with display name and role hint` |
| Prefer `Driver` role over first role | Same test (`Permit Clerk` member uses first role) |
| `driverSelectionKey` / `parseDriverSelectionKey` round-trip | `round-trips composite keys` |
| Invalid keys → `null` | `returns null for invalid keys` |
| Resolve `member_profile` by row `id` | `resolves member_profile rows from org members` |
| Actor fallback when org list empty | `falls back to actor profile when org list is partial` |
| Resolve `team_member_profile` from roster | `resolves team_member_profile rows from roster` |
| Unknown selection → `null` | `returns null for unknown selection` |

### Gaps

| Priority | Gap | Risk | Suggested test |
|----------|-----|------|----------------|
| **P1** | **Empty roster → empty options** — `buildDriverSelectOptions([])` | Empty-state UI depends on length; option builder edge case | Unit: `[]` → `[]` |
| **P1** | **Role fallback to `'Member'`** — `user_roles: []` or missing | Wrong label in dropdown | Unit: member with `user_roles: []` → `(Member)` |
| **P1** | **Permit page option `value` uses `driverSelectionKey(option)`** | Wrong key format breaks resolution | UI slice: assert `<option ... value={driverSelectionKey(option)}>` |
| **P2** | **`parseDriverSelectionKey` edge cases** — `member_profile:` (empty id), `bad:source:id`, id containing `:` | Malformed keys could resolve incorrectly | Unit: malformed keys → `null` |
| **P2** | **`resolveDriverProfileForSelection(null)`** | Empty dropdown selection | Unit: `null` → `null` |
| **P2** | **Match by `user_id` in org list** — fallback test uses actor; org-list match by `user_id` not isolated | Dropdown id might be `user_id` from list builder | Unit: selection `{ id: user_id, source: member_profile }` found in `orgMembers` |
| **P2** | **`handleDriverSelect('')` behavior** — `parseDriverSelectionKey('')` → early return; form not cleared | UX: re-selecting “— Select a driver —” may leave stale autofill | Handler slice or unit chain test |
| **P3** | **Integration with `buildTeamMemberList` on permit page** — filtering (non-primary → self only) lives in `member-profile-permissions.test.ts` but permit UI test only checks symbol presence | Permit page could stop calling `buildTeamMemberList` correctly | UI slice: `loadPermitTeamData` calls `buildTeamMemberList(profile, members, roster, userId)` |
| **P3** | **`isPrimaryOwner` gate in `loadPermitTeamData`** — non-owner should not fetch full org | Driver dropdown wrong for non-primary users | UI slice: `if (profile?.organization_id && isPrimaryOwner(profile))` before `from('member_profiles')` |
| **P3** | **Deduplication of linked roster rows** — covered in permissions tests, not permit contract | Regression if permit loads raw roster | Optional cross-module contract test |

---

## 3. Carrier mode gating

### What is covered

| Case | Test |
|------|------|
| `Select Driver` inside `workspaceMode === 'carrier'` | `shows Select Driver only in carrier mode...` |
| `handleDriverSelect` calls `memberProfileToPermitAutofill` | Same test (regex across handler body) |
| Empty state + `/profile` link | Same test |
| `SERVICE_MODE_TODO` in **lib** | `documents SERVICE_MODE_TODO for carrier-first driver filtering` |
| Imports `useOrganizationContext`, `CarrierContextBar` | Import test |

### Gaps

| Priority | Gap | Risk | Suggested test |
|----------|-----|------|----------------|
| **P1** | **Negative gating** — no assertion that `Select Driver` is **not** rendered for `workspaceMode === 'service'` (or non-carrier) | Dropdown could leak into service mode on refactor | UI slice: `Select Driver` only appears inside `workspaceMode === 'carrier'` block (count/brace matching), or explicit `service` mode comment path |
| **P1** | **Service mode UI stub in page** — `SERVICE_MODE_TODO` comment exists in `page.tsx` (line ~2272) but only **lib** stub is tested | Future service-mode work untracked in UI tests | UI: `readPermitPageSource()` contains `SERVICE_MODE_TODO` / Select Carrier |
| **P2** | **`useOrganizationContext(ownOrganizationId)`** — org id drives mode; not asserted | Wrong org → wrong mode → wrong UI | UI: assert `useOrganizationContext(ownOrganizationId)` |
| **P2** | **Carrier/driver inputs always visible** — intentional product behavior; untested | Accidental hiding in service mode | Document + optional assert inputs outside carrier-only block |
| **P3** | **No runtime render test** — accepted project limitation; permit UI test file does **not** document this limitation (profile tests do) | Future contributors may assume interaction coverage | Add header comment parity with `profile-ui.test.ts` |
| **P3** | **`CarrierContextBar` placement/behavior** | Cosmetic/regression | Low priority source slice |

### Gating logic map (untested on permit page)

```
loadPermitTeamData
  └─ isPrimaryOwner(profile) ? fetch full org + roster : members = [profile only]
buildTeamMemberList(profile, members, roster, userId)
  └─ non-primary → list length 1 (tested in permissions, not permit UI)
workspaceMode === 'carrier'
  └─ show Select Driver (positive source test only)
```

---

## 4. API payload wiring

### What is covered

| Case | Test |
|------|------|
| `permitFormToLoadDetailsCarrierFields` imported on page | Import + file-level `toContain` |
| `fetch('/api/analyze-permit')` and `fetch('/api/optimize-route')` present | UI test |
| `carrierDriver:` object in save flow | UI test (`companyName`, `driverFullName` only) |
| Helper unit tests for extraction logic | `permitFormToLoadDetailsCarrierFields` (2 tests) |

### Gaps

| Priority | Gap | Risk | Suggested test |
|----------|-----|------|----------------|
| **P0** | **False-positive route-analysis assertion** — `expect(source).toMatch(/analyzePayload[\s\S]*dotNumber|.../)` matches because `analyzePayload` (line ~1276) is followed later by `dotNumber: formData.dotNumber` in **save** payload (~1478), **not** because `permitFormToLoadDetailsCarrierFields` spreads into analyze/optimize bodies | Test gives false confidence; spread could be removed without failing this assertion | Replace with handler slices asserting `...permitFormToLoadDetailsCarrierFields(currentData)` inside `runRouteAnalysis` and both change-route branches |
| **P1** | **Three call sites not individually asserted** — (1) `runRouteAnalysis` → `optimize-route`, (2) change-route OR-Tools, (3) change-route `analyze-permit` quick path | One path could drop carrier fields | Three source slices or one test listing all three line patterns |
| **P1** | **`mcNumber` never asserted in UI test** — test title claims both fields | MC# regression unnoticed | Assert `permitFormToLoadDetailsCarrierFields` spread in each payload block (spread adds `mcNumber` at runtime) |
| **P1** | **`carrierDriver` snapshot incomplete** — save block has 16 fields + `selectedDriverKey`; test checks 2 fields | Permit history missing driver/carrier data | UI slice: full `carrierDriver` shape in **both** save handlers (`handleApproveSpecificOption` ~1609 and primary save ~1474) |
| **P1** | **API route tests omit carrier fields** — `analyze-permit/route.test.ts` and `optimize-route/route.test.ts` never POST `dotNumber`/`mcNumber` or assert `loadArg.dotNumber` | Server/agent may drop fields silently | Route test: body with `dotNumber`/`mcNumber` → `processPermitRequest` receives them |
| **P2** | **`buildLoadDetails` in optimize-route** — no test that `mcNumber`/`dotNumber` map into load details | OR-Tools path regression | Extend `buildLoadDetails` test or POST integration test |
| **P2** | **Auto route analysis uses `currentData` not `formData`** — subtle; if sync diverges, wrong carrier fields analyzed | Stale analysis | Document + test that `currentData` includes carrier fields from same shape |
| **P3** | **Agent layer** — `agents/permit-agent.ts` types include fields; no agent test | Downstream behavior unknown | Agent unit test when carrier context used in prompts/rules |

### Payload wiring map

| Exit point | Helper used | UI test verifies |
|------------|-------------|------------------|
| `runRouteAnalysis` → `/api/optimize-route` | `permitFormToLoadDetailsCarrierFields(currentData)` | ❌ (false positive only) |
| Change route OR-Tools → `/api/optimize-route` | `permitFormToLoadDetailsCarrierFields(formData)` | ❌ |
| Change route quick → `/api/analyze-permit` | `permitFormToLoadDetailsCarrierFields(formData)` | ❌ |
| Save (primary) → `/api/permit-requests` | `cargo.carrierDriver` (full snapshot) | ⚠️ partial |
| Save (approve option) → `/api/permit-requests` | `cargo.carrierDriver` (full snapshot) | ❌ |
| `/api/analyze-permit` route → agent | `body.dotNumber`, `body.mcNumber` | ❌ |
| `/api/optimize-route` route → agent | `body.dotNumber`, `body.mcNumber` | ❌ |

---

## 5. Test quality & methodology

### Strengths

- Pure helpers are **fast, deterministic, and well-factored** for unit testing.
- Fixtures mirror real `MemberProfile` / `TeamMemberProfile` shapes.
- `resolveDriverProfileForSelection` covers the main selection sources and failure mode.
- Reuses established **source-inspection** approach consistent with profile page tests.

### Weaknesses

1. **No RTL / render harness** — dropdown change, mode switch, and fetch payloads are never executed.
2. **Permit UI test lacks limitation disclaimer** present in `profile-ui.test.ts` header.
3. **Regex-based assertions** are brittle and can false-positive (confirmed for analyze payload).
4. **No handler slices** — `profile-ui.test.ts` uses `functionSlice` helpers extensively; permit tests use one section slice only.
5. **Cross-file reliance undocumented** — permit driver list behavior depends on `member-profile-permissions.test.ts` without an explicit “contract” comment in permit tests.

### Recommended test additions (minimal set)

If adding only **5 tests** for highest ROI:

1. Fix/replace false-positive UI assertion with `runRouteAnalysis` slice containing `permitFormToLoadDetailsCarrierFields`.
2. Unit: `memberProfileToPermitAutofill(rosterProfile)`.
3. Unit: `buildDriverSelectOptions` with empty roles → `(Member)`.
4. UI slice: `loadPermitTeamData` + `isPrimaryOwner` branch.
5. Route test: `analyze-permit` POST forwards `dotNumber` and `mcNumber` to `processPermitRequest`.

---

## 6. Suggested follow-up checklist

- [ ] Replace `analyzePayload`/`dotNumber` regex with explicit spread assertions (3 call sites).
- [ ] Assert full `carrierDriver` snapshot + `selectedDriverKey` in both save handlers.
- [ ] Add trim / roster / `dotNumber` preference unit cases.
- [ ] Add carrier-mode negative gating + page `SERVICE_MODE_TODO` UI assertion.
- [ ] Extend API route tests for carrier identifier propagation.
- [ ] Add permit UI test file header documenting source-only limitation.
- [ ] (Future) RTL harness for `handleDriverSelect` interaction once adopted project-wide.

---

## Verdict

**Approve helpers; do not rely on UI tests alone for API wiring.**

Unit tests adequately guard the autofill mapping and selection resolution **for primary-owner and member-profile rows**, but **roster rows, trimming, and field-preference edge cases** need work. UI tests confirm the feature is **wired into the page**, yet the strongest-looking API test (**route analysis payloads**) is **currently misleading**. Carrier mode gating is only half-tested (presence in carrier mode, not absence elsewhere). Downstream API routes are a clear hole in the test pyramid.

**Status:** open — coverage gaps documented; no code changes made.