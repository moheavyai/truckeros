# General Review Pass 2: Permit Profile Autofill

**Scope:** `lib/permit-profile-autofill.ts`, `app/permit-test/page.tsx`, related tests  
**Reference:** `agent-tools/grok-impl-summary-3b02a731.md`  
**Focus:** Edge cases (non-primary owner driver, roster-only members, empty fields), service mode stub structure, regression risk to existing permit flows  
**Date:** 2026-07-07  
**Reviewer:** Independent pass 2 (no fixes applied)

---

## Implementation Verification

| Area | Status | Evidence |
|------|--------|----------|
| Pure autofill helper module | **Implemented** | `lib/permit-profile-autofill.ts` — mapping, options, selection resolution, API field extraction |
| Carrier Mode driver dropdown + autofill | **Implemented** | `page.tsx:2242–2268` gated on `workspaceMode === 'carrier'`; `handleDriverSelect` at `244–257` |
| Team data load mirrors profile page | **Implemented** | `loadPermitTeamData` (`97–125`) uses `isPrimaryOwner` + `buildTeamMemberList` |
| `dotNumber` / `mcNumber` in route APIs | **Implemented** | `permitFormToLoadDetailsCarrierFields` spread into optimize-route (`1299`) and analyze-permit change-route (`1719`, `1778`) |
| `carrierDriver` snapshot on save | **Implemented** | Both save paths (`1474–1492`, `1609–1627`) |
| Service mode stub | **Partial** | Lib comment (`permit-profile-autofill.ts:130`); UI comment (`page.tsx:2272`); no behavior yet |
| Unit + source-inspection tests | **Present** | `lib/permit-profile-autofill.test.ts`, `app/permit-test/permit-profile-ui.test.ts` |

**Tests (per impl summary):** `npx vitest run lib/permit-profile-autofill.test.ts app/permit-test/permit-profile-ui.test.ts lib/member-profile-permissions.test.ts` — **33/33 passed** (not re-run in this review session).

---

## Edge Case Analysis

### Non-primary owner / driver

| Scenario | Behavior | Assessment |
|----------|----------|------------|
| Non-primary user opens permit form | `loadPermitTeamData` loads only `[ownProfile]` (`103–104`); `buildTeamMemberList` returns self only (`member-profile-permissions.ts:129–131`) | **Correct** — matches profile Team Roster visibility |
| Non-primary selects self in dropdown | `memberProfileToPermitAutofill` maps driver fields; carrier columns empty if absent on profile (unit test `driverProfile` case) | **Correct** for data model; carrier DOT/MC must be typed manually |
| Non-primary in Service Mode | Dropdown hidden; manual carrier/driver inputs still visible | **Acceptable** interim state |
| Viewer-only non-primary | Same self-only list; can autofill own profile if fields exist | **OK** — no extra exposure |

**Gap:** Non-primary drivers who operate under the org’s USDOT but do not store carrier fields on their own profile have no way to auto-fill org carrier identifiers. This mirrors profile-page permissions and is likely intentional, but permit workflows may expect org-level carrier data regardless of who is driving.

### Roster-only members (`team_member_profiles`)

| Scenario | Behavior | Assessment |
|----------|----------|------------|
| Primary owner sees roster entries | Roster appended after org members; linked roster rows deduped (`member-profile-permissions.ts:137–139`) | **Correct** |
| Select roster driver | `resolveDriverProfileForSelection` returns roster row (`157–158`); autofill maps `MemberProfileFields` | **Correct** |
| Roster row with driver-only data | Patch includes explicit `''` for all empty carrier keys (same as `driverProfile` unit test pattern) | **Works**, but see Finding #1 |
| Roster row with optional `company_name` / carrier fields | Would autofill whatever is on the roster row | **OK** — type allows it |

**Gap:** No dedicated unit test for `TeamMemberProfile` → autofill (roster fixture exists in `resolveDriverProfileForSelection` test only).

### Empty / partial fields

| Scenario | Behavior | Assessment |
|----------|----------|------------|
| `null` / `undefined` profile | `memberProfileToPermitAutofill` returns `{}` | **Correct** |
| Whitespace-only DB values | `trimField` normalizes to `''` | **Correct** |
| Resolved selection is `null` | Patch `{}`; prior form values **unchanged** while dropdown shows new selection | **Bug** — see Finding #3 |
| Deselect driver (`value=""`) | `parseDriverSelectionKey('')` → `null`; early return; **fields not cleared** | **Bug** — see Finding #2 |
| API payload with empty DOT/MC | `permitFormToLoadDetailsCarrierFields` omits empty keys | **Correct** — no regression to route APIs |

---

## Service Mode Stub Structure

Current state is **comment-only**, split across two locations:

| Location | Content |
|----------|---------|
| `lib/permit-profile-autofill.ts:130` | `SERVICE_MODE_TODO: add selectCarrier first, then filter drivers by effectiveOrganizationId` |
| `app/permit-test/page.tsx:2272` | `SERVICE_MODE_TODO: Select Carrier dropdown first, then populate Select Driver from chosen carrier` |

**What exists today in Service Mode:**
- `CarrierContextBar` allows mode switch (`page.tsx:2088`)
- Carrier & Driver **manual inputs** render (not gated on `workspaceMode`)
- **No** Select Driver dropdown
- **No** team data load keyed to `activeOrganizationId` / `resolveEffectiveOrganizationId`

**Stub adequacy:** Sufficient as a breadcrumb for the next phase, but incomplete for implementation handoff:
- No shared symbol (constant/type) linking lib and UI stubs
- `loadPermitTeamData` always uses `ownProfile.organization_id`, not effective org — will need refactor before Service Mode autofill
- UI stub not covered by `permit-profile-ui.test.ts` (only lib stub is asserted)

---

## Regression Risk — Existing Permit Flows

| Surface | Risk | Verdict |
|---------|------|---------|
| Route analysis (`runRouteAnalysis` → `/api/optimize-route`) | Additive spread of optional `dotNumber`/`mcNumber`; APIs already accept them (`optimize-route/route.ts:72–73`) | **Low** |
| Change-route quick path (`/api/analyze-permit`) | Same additive spread | **Low** |
| Form validation (`validateForm`) | No new required fields; carrier/driver not validated | **Low** |
| Route fingerprint / auto re-analysis | Fingerprint excludes carrier fields (`1255–1264`) — changing driver/carrier does not re-trigger analysis | **Low** (likely intended) |
| Save payloads (`/api/permit-requests`) | New nested `cargo.carrierDriver` object; server passes body through | **Low** — additive JSON |
| Auth / equipment / geocoding / rig flows | No edits to those code paths | **None observed** |
| Primary-owner mount cost | Two extra Supabase queries on auth (`107–114`) | **Low** — scoped to primary owners |
| `formData` size | +16 string fields via spread | **Low** |
| Page complexity | ~200 lines UI + state; file already ~3.5k lines | **Medium maintainability** — pre-existing concern |

**Overall regression risk: Low** for routing, geocoding, OR-Tools, and save/history. New behavior is mostly additive.

---

## Findings

### 1
- **Severity:** bug
- **File:line:** `app/permit-test/page.tsx:244–257`, `lib/permit-profile-autofill.ts:67–92`
- **Description:** Selecting a **driver-only** `member_profile` or a **roster-only** `team_member_profile` after a profile with carrier data **wipes all carrier fields** (company, USDOT, MC, EIN, address, etc.). `memberProfileToPermitAutofill` always emits every key with `''` for missing carrier columns, and `handleDriverSelect` merges the full patch into `formData`. This is the common primary-owner flow: pick org carrier context (self/owner), then pick a different driver for the load.
- **Suggestion:** Split autofill into carrier vs driver patches, or preserve non-empty carrier fields when the selected profile has empty carrier columns (e.g. merge driver fields only for `team_member_profile` / non-owner `member_profile`). Add a unit test for owner → driver-only switch.
- **Status:** open

### 2
- **Severity:** bug
- **File:line:** `app/permit-test/page.tsx:244–247`, `2261`
- **Description:** Choosing the blank option **"— Select a driver —"** sets `selectedDriverKey` to `''` but does **not** reset carrier/driver form fields. Saved `carrierDriver.selectedDriverKey` can be empty while field values still reflect the prior selection.
- **Suggestion:** On empty selection, reset carrier/driver fields to `EMPTY_PERMIT_CARRIER_DRIVER_FIELDS` (or last explicit user baseline).
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `app/permit-test/page.tsx:244–257`, `lib/permit-profile-autofill.ts:135–161`
- **Description:** If `resolveDriverProfileForSelection` returns `null` (stale key, partial org load, race), the dropdown updates but autofill patch is `{}`, leaving inputs out of sync with the visible selection.
- **Suggestion:** On unresolved selection, clear autofill fields or revert dropdown; optionally log/toast.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `app/permit-test/page.tsx:97–125`
- **Description:** `loadPermitTeamData` runs once on auth and is not tied to `workspaceMode` or `activeOrganizationId`. Service Mode users working on a linked carrier cannot autofill that carrier’s team today (dropdown hidden anyway), but the data layer is not ready for the stubbed carrier-first flow.
- **Suggestion:** When implementing Service Mode, load team data from `resolveEffectiveOrganizationId(...)` and re-fetch on `truckeros:active-organization` events.
- **Status:** open (expected for stub phase)

### 5
- **Severity:** nit
- **File:line:** `app/permit-test/permit-profile-ui.test.ts:81–88`, `app/permit-test/page.tsx:2272`
- **Description:** Service mode stub is tested only in the lib file. The UI comment at `page.tsx:2272` is not asserted, unlike other wiring checks.
- **Suggestion:** Add `expect(source).toContain('SERVICE_MODE_TODO')` (or match the carrier-first comment) in `permit-profile-ui.test.ts`.
- **Status:** open

### 6
- **Severity:** nit
- **File:line:** `lib/permit-profile-autofill.test.ts:60–106`
- **Description:** No unit test for `memberProfileToPermitAutofill(rosterProfile)` or for whitespace trimming on partial roster rows.
- **Suggestion:** Add a roster fixture test mirroring the `driverProfile` driver-only case.
- **Status:** open

### 7
- **Severity:** nit
- **File:line:** `lib/permit-profile-autofill.ts:130`, `app/permit-test/page.tsx:2272`
- **Description:** Duplicate `SERVICE_MODE_TODO` comments in lib and page with slightly different wording; no exported constant or shared doc block for implementers.
- **Suggestion:** Export e.g. `SERVICE_MODE_AUTOFILL_TODO` from the lib and reference it in a single comment near `loadPermitTeamData`.
- **Status:** open

### 8
- **Severity:** nit
- **File:line:** `app/permit-test/page.tsx:150–157`
- **Description:** Users without a `member_profiles` row never call `loadPermitTeamData`; dropdown empty state shows, but there is no distinct copy for “complete your profile first” vs “add team members.”
- **Suggestion:** Differentiate `!ownProfile` vs `ownProfile && teamMembers.length === 0` in the empty state.
- **Status:** open

---

## Test Coverage Gaps (edge-case focus)

| Gap | Priority |
|-----|----------|
| Owner → driver-only selection clears carrier fields | High (Finding #1) |
| Deselect driver does not clear fields | Medium (Finding #2) |
| `memberProfileToPermitAutofill` for `TeamMemberProfile` | Low |
| Service Mode UI stub assertion | Low |
| Non-primary permit page integration (source or E2E) | Low |

Existing tests cover: full owner mapping, driver-only mapping, null profile, selection resolution (including roster), API field extraction, and static UI wiring.

---

## Summary

| Severity | Count |
|----------|-------|
| bug | 2 |
| suggestion | 2 |
| nit | 4 |
| **Total open** | **8** |

**Pass-2 verdict:** The feature is **well-structured** (pure lib, profile-page parity for team list permissions, additive API/save changes) and **low regression risk** to existing permit routing and save flows. The main functional gaps are **autofill merge semantics**: switching to a driver-only profile incorrectly clears org carrier data (Finding #1), and deselecting the driver leaves stale field values (Finding #2). Service mode remains appropriately stubbed; data loading will need `effectiveOrganizationId` before autofill can work there.

**Recommend:** Address Findings #1 and #2 before treating autofill as production-ready for primary-owner “pick driver for this load” workflows. Safe to merge for manual-entry and single-selection flows if the carrier-wipe behavior is documented as a known limitation.