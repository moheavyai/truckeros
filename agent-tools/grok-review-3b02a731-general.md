# Member Profiles → Permit Agent Driver Selector — General Review

**Scope:** `lib/permit-profile-autofill.ts`, `app/permit-test/page.tsx`, `app/permit-test/permit-profile-ui.test.ts`, `lib/permit-profile-autofill.test.ts`  
**Reference:** `agent-tools/grok-impl-summary-3b02a731.md`  
**Focus:** Select Driver dropdown, autofill correctness, Carrier Mode gating, API field mapping (`dotNumber`/`mcNumber`), UX  
**Tests (per impl summary):** 33/33 passing — `lib/permit-profile-autofill.test.ts`, `app/permit-test/permit-profile-ui.test.ts`, `lib/member-profile-permissions.test.ts`

---

## Executive Summary

The implementation is **well-structured**: autofill logic is isolated in a pure helper module, team roster loading reuses the profile page’s `buildTeamMemberList` / `isPrimaryOwner` pattern, and `dotNumber`/`mcNumber` are threaded consistently into optimize-route, analyze-permit, and permit-request save payloads.

**Carrier Mode gating** for the Select Driver dropdown is correct (`workspaceMode === 'carrier'`). **API mapping** (`usdot_number` → `usdotNumber` + `dotNumber`, `permitFormToLoadDetailsCarrierFields` fallback) is sound.

The main gaps are **autofill semantics for multi-member orgs** (driver-only rows wipe carrier fields) and **reset behavior** when clearing the dropdown. Service Mode is intentionally stubbed but the visible copy/UI do not yet reflect that. No code changes made in this review.

**Ship recommendation:** Acceptable for single-user / owner-as-driver flows. Address open bugs (#1–#2) before treating multi-driver carrier org autofill as production-ready.

---

## Verified Working

| Area | Status | Evidence |
|------|--------|----------|
| Pure autofill module | **Good** | `lib/permit-profile-autofill.ts` — typed fields, trim normalization, composite selection keys |
| Field mapping profile → form | **Good** | 16 fields mapped; `usdot_number` duplicated to `usdotNumber` + `dotNumber` (`lib/permit-profile-autofill.ts:72-79`) |
| Team roster load (parity with profile page) | **Good** | `loadPermitTeamData` mirrors `loadTeamData` — primary owner loads org `member_profiles` + `team_member_profiles`; non-primary gets self only (`app/permit-test/page.tsx:97-123`) |
| Carrier Mode dropdown gating | **Good** | `{workspaceMode === 'carrier' && (...)}` wraps Select Driver (`app/permit-test/page.tsx:2242-2270`) |
| Immediate autofill on change | **Good** | `handleDriverSelect` → `resolveDriverProfileForSelection` → `memberProfileToPermitAutofill` → `setFormData` merge (`app/permit-test/page.tsx:244-257`) |
| USDOT manual edit keeps API alias in sync | **Good** | USDOT input sets both `usdotNumber` and `dotNumber` (`app/permit-test/page.tsx:2288-2293`) |
| API payload extraction | **Good** | `permitFormToLoadDetailsCarrierFields` prefers `dotNumber`, falls back to `usdotNumber`, omits blanks (`lib/permit-profile-autofill.ts:165-175`) |
| Route analysis payloads | **Good** | Spread into `analyzePayload`, `changePayload`, and analyze-permit change-route body (`app/permit-test/page.tsx:1299, 1719, 1778`) |
| Save snapshot | **Good** | Full `carrierDriver` object + `selectedDriverKey` in both save handlers (`app/permit-test/page.tsx:1474-1492, 1609-1627`) |
| Selection resolution | **Good** | `member_profile` matches `id` or `user_id`; actor fallback; `team_member_profile` roster lookup (`lib/permit-profile-autofill.ts:143-159`) |
| Empty state UX | **Good** | Links to `/profile` when `driverSelectOptions.length === 0` (`app/permit-test/page.tsx:2247-2253`) |
| Service Mode stub documented | **Good** | `SERVICE_MODE_TODO` in lib + UI comment (`lib/permit-profile-autofill.ts:130`, `app/permit-test/page.tsx:2272`) |
| Unit tests (lib) | **Good** | Mapping, options, resolution, key round-trip, API field helper covered (`lib/permit-profile-autofill.test.ts`) |

---

## Open Issues

### 1
- **Severity:** bug
- **File:line:** `app/permit-test/page.tsx:244-257`
- **Description:** Choosing the placeholder option **"— Select a driver —"** (`value=""`) sets `selectedDriverKey` to `''` but **does not clear** previously auto-filled carrier/driver fields. `parseDriverSelectionKey('')` returns `null` and `handleDriverSelect` returns early without resetting `formData`.
- **Impact:** Stale permit identity data can remain in the form and flow into route analysis saves after the user believes they cleared the selection.
- **Suggestion:** When `compositeKey` is empty (or `parseDriverSelectionKey` is null), merge `EMPTY_PERMIT_CARRIER_DRIVER_FIELDS` into `formData` (or reset only carrier/driver keys).
- **Status:** open

### 2
- **Severity:** bug
- **File:line:** `lib/permit-profile-autofill.ts:75-92`, `app/permit-test/page.tsx:255-256`
- **Description:** Autofill **always overwrites all 16 fields** from the selected profile row. Driver-only `member_profiles` and roster-only `team_member_profiles` typically have **empty carrier columns**, so selecting a driver after an owner (or after manual carrier entry) **wipes** `companyName`, `usdotNumber`, `dotNumber`, `mcNumber`, carrier contacts, etc.
- **Impact:** Primary-owner workflow “pick carrier context once, then switch drivers” fails; the most common multi-driver permit scenario produces incomplete carrier data unless the user re-types carrier fields after every driver change.
- **Suggestion:** Split autofill into driver vs carrier patches; when the selected row lacks carrier data, retain existing carrier fields (or merge org-level carrier from `ownProfile` / primary owner row). Alternatively, populate carrier from organization primary owner whenever a driver-only row is selected.
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `app/permit-test/page.tsx:2237-2239, 2272`
- **Description:** In **Service Mode**, the Carrier & Driver section remains visible with copy *"Select a saved team member to auto-fill carrier and driver details"*, but the Select Driver dropdown is hidden. Users must manually type all fields with no team-based autofill and no link to the active carrier from `CarrierContextBar` / `ActiveCarrierBanner`.
- **Suggestion:** Adjust section helper text by mode (e.g. Service Mode: *"Enter carrier and driver details for the selected carrier"*), or implement the documented `SERVICE_MODE_TODO` carrier-first → driver-filtered flow.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `app/permit-test/page.tsx:2244-2245`, `lib/permit-profile-autofill.ts:95-107`
- **Description:** Dropdown label is **"Select Driver"**, but options include **all org members and roster entries** (Owner / Admin, Permit Clerk, Viewer, etc.) via `buildTeamMemberList`. Role hint in label helps, but the control name implies drivers only.
- **Suggestion:** Rename to **"Select team member"** or filter options to driver-eligible roles if permit workflow should exclude non-drivers.
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `app/permit-test/page.tsx:136-172, 191-240`
- **Description:** On auth load, carrier/driver fields start empty even when `ownProfile` is loaded. Non-primary users get a one-item dropdown (self) but still must manually select to autofill. Primary owners with a full profile must also select themselves to populate fields.
- **Suggestion:** Optionally auto-select `ownProfile` (or sole dropdown option) on first load in Carrier Mode, or pre-merge `memberProfileToPermitAutofill(ownProfile)` into initial `formData` when profile loads.
- **Status:** open

### 6
- **Severity:** suggestion
- **File:line:** `app/permit-test/page.tsx:163-168`
- **Description:** `onAuthStateChange` updates `user` but **does not reload** `loadPermitTeamData`. Team roster changes made on `/profile` in another tab (or after navigating back) are not refreshed until full page remount.
- **Suggestion:** Re-fetch team data on focus (`visibilitychange` / `router` events) or when returning from `/profile`; at minimum reload on auth user id change.
- **Status:** open

### 7
- **Severity:** suggestion
- **File:line:** `app/permit-test/permit-profile-ui.test.ts`
- **Description:** UI coverage is **static source inspection** only (same project pattern as `profile-ui.test.ts`). Tests verify string presence but not runtime behavior (gating, autofill merge, empty reset, service mode).
- **Suggestion:** Add component/integration tests for `handleDriverSelect` behavior (mock org context + roster state), or extract handler logic to a testable pure function.
- **Status:** open

### 8
- **Severity:** suggestion
- **File:line:** `lib/permit-profile-autofill.test.ts`
- **Description:** No test for the **driver-only selection wiping carrier fields** scenario (issue #2), and no test asserting that empty selection should clear fields (issue #1). `buildDriverSelectOptions` does not assert composite `driverSelectionKey` format used by the `<select>`.
- **Suggestion:** Add cases: owner → driver switch retains or intentionally replaces carrier; empty key clears patch.
- **Status:** open

### 9
- **Severity:** nit
- **File:line:** `app/permit-test/page.tsx:92, 2257`
- **Description:** `selectedDriverKey` can reference a roster entry that was deleted on `/profile` while the permit page stays mounted; the `<select>` shows blank selected value but **autofilled fields persist**.
- **Suggestion:** Validate `selectedDriverKey` against current `driverSelectOptions` after `loadPermitTeamData`; clear key + fields when option no longer exists.
- **Status:** open

### 10
- **Severity:** nit
- **File:line:** `agents/permit-agent.ts:63-64`, `app/api/analyze-permit/route.ts:69-70`
- **Description:** `dotNumber` / `mcNumber` are accepted in `LoadDetails` and API routes but **not consumed** in permit analysis logic today (routing/rules unchanged). Values are still valuable for save snapshots and future agent use.
- **Suggestion:** No change required for this feature; document as persistence/metadata fields until agent consumes them.
- **Status:** open

### 11
- **Severity:** nit
- **File:line:** `app/permit-test/page.tsx:1255-1264`
- **Description:** Auto route-analysis fingerprint excludes carrier/driver fields, so changing driver/carrier identifiers does not re-trigger OR-Tools. Low impact today because DOT/MC do not affect routing math.
- **Suggestion:** Include `permitFormToLoadDetailsCarrierFields(formData)` in fingerprint if carrier identity should invalidate cached analysis in the future.
- **Status:** open

---

## Focus Area Notes

### Select Driver dropdown
- Composite key `source:id` correctly disambiguates `member_profile` vs `team_member_profile` rows.
- Permissions align with profile Team Roster: non-primary users see only self; primary owner sees full org + unlinked roster entries.
- Empty roster shows helpful CTA to `/profile`.

### Autofill correctness
- Trimming and null-safe mapping are solid for **single full profile** rows.
- **Multi-row org behavior** is the weak point: per-row autofill treats each profile as the sole source of truth (issue #2).
- Manual edits after autofill are preserved until the next selection — correct merge semantics.

### Carrier Mode gating
- Dropdown correctly hidden outside Carrier Mode.
- `CarrierContextBar` + `ActiveCarrierBanner` provide workspace context; only the dropdown is gated, not the editable fields (intentional — allows manual entry in Service Mode).

### API field mapping (`dotNumber` / `mcNumber`)
- Form maintains parallel `usdotNumber` (display) and `dotNumber` (API alias).
- `permitFormToLoadDetailsCarrierFields` correctly dedupes and omits whitespace-only values.
- Save payload stores both `usdotNumber` and `dotNumber` for audit/history — good redundancy.

### UX
- Section placement at top of form is appropriate for permit intake.
- All carrier + driver inputs remain editable post-autofill — good.
- Service Mode copy and missing autofill path are the main UX debt (issue #3).
- No loading indicator while `loadPermitTeamData` runs; dropdown may briefly show empty state on slow networks (minor).

---

## Summary by Severity

| Severity | Open |
|----------|------|
| bug | 2 |
| suggestion | 6 |
| nit | 3 |
| **Total open** | **11** |

---

## Verdict

**Architecture and API wiring are sound** for the stated Carrier Mode MVP. The helper module and team-data loading pattern match existing profile conventions, and `dotNumber`/`mcNumber` propagation is consistent across analysis and save paths.

**Blockers for multi-driver production use:** issues **#1** (clear selection leaves stale data) and **#2** (driver-only rows clear carrier context). Fix those before calling autofill “correct” for typical carrier orgs.

**Recommended manual smoke:**
1. Primary owner: select self → verify carrier + driver fill → select driver-only member → confirm whether carrier fields should persist (currently they clear).
2. Select driver → choose placeholder → confirm fields should reset (currently they do not).
3. Carrier Mode vs Service Mode: confirm dropdown visibility and whether Service Mode copy matches available actions.
4. Save permit request → inspect `cargo.carrierDriver` and API payloads for `dotNumber`/`mcNumber`.