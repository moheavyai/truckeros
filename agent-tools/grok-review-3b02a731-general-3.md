# Code Review: Permit Driver Selector + Autofill — General Pass 3

**Scope:** `lib/permit-profile-autofill.ts`, `lib/permit-profile-autofill.test.ts`, `app/permit-test/page.tsx`, `app/permit-test/permit-profile-ui.test.ts`  
**Reference:** `agent-tools/grok-impl-summary-3b02a731.md`  
**Focus:** Code quality, maintainability, naming, and whether the lib module is extensible for Service Mode  
**Status:** Review only — no fixes applied

---

## Verification Summary

| Area | Status |
|------|--------|
| **Pure lib extraction** | Mapping, dropdown options, selection resolution, and API field extraction live in `lib/permit-profile-autofill.ts` with no React/Supabase deps |
| **Carrier Mode gating** | Select Driver dropdown rendered only when `workspaceMode === 'carrier'` (`page.tsx:2242`) |
| **Immediate autofill** | `handleDriverSelect` → `parseDriverSelectionKey` → `resolveDriverProfileForSelection` → `memberProfileToPermitAutofill` → `setFormData` merge (`page.tsx:244–257`) |
| **Permission-aligned roster** | Reuses `buildTeamMemberList` / `isPrimaryOwner` from profile page (`page.tsx:106–122`) |
| **API payload wiring** | `permitFormToLoadDetailsCarrierFields` spread into optimize-route and analyze-permit payloads (`page.tsx:1299`, `1719`, `1778`) |
| **Save snapshot** | `carrierDriver` object with full field set + `selectedDriverKey` in both save paths (`page.tsx:1474–1492`, `1609–1627`) |
| **Service Mode stubs** | `SERVICE_MODE_TODO` comments in lib (`permit-profile-autofill.ts:130`) and page UI (`page.tsx:2272`) |
| **Unit tests** | Lib mapping, options, resolution, key helpers, API extraction covered (`permit-profile-autofill.test.ts`) |
| **UI wiring tests** | Source-inspection tests assert imports, team load, carrier gating, API fields, save snapshot (`permit-profile-ui.test.ts`) |

**Tests (per implementation summary):** 33 passing across `permit-profile-autofill.test.ts`, `permit-profile-ui.test.ts`, and `member-profile-permissions.test.ts`.

---

## Architecture Assessment

### Lib module (`lib/permit-profile-autofill.ts`)

The module is a **solid, testable foundation** for Carrier Mode:

```
TeamMemberListItem[]  →  buildDriverSelectOptions()  →  DriverSelectOption[]
DriverSelectionKey    →  resolveDriverProfileForSelection(orgMembers, roster, actor)
MemberProfileFields   →  memberProfileToPermitAutofill()  →  Partial<PermitCarrierDriverFormFields>
Form fields           →  permitFormToLoadDetailsCarrierFields()  →  { dotNumber?, mcNumber? }
```

**Strengths:**

- **Single responsibility:** Each export does one job; no UI or I/O.
- **Typed contracts:** `PermitCarrierDriverFormFields`, `DriverSelectOption`, `DriverSelectionKey` give clear boundaries.
- **Documented dual mapping:** USDOT → `usdotNumber` + `dotNumber` is explained in JSDoc (`permit-profile-autofill.ts:63–66`).
- **Composite selection keys:** `source:id` disambiguates `member_profile` vs `team_member_profile` rows with the same display name.
- **Defensive resolution:** `resolveDriverProfileForSelection` matches by `id` or `user_id` and falls back to `actorProfile` when org list is partial (`permit-profile-autofill.ts:143–152`) — mirrors profile-page edge cases.
- **`EMPTY_PERMIT_CARRIER_DRIVER_FIELDS`:** Keeps form defaults DRY when spread into `formData` (`page.tsx:239`).

**Service Mode extensibility (lib):** Mostly ready. The functions already accept **caller-supplied, org-scoped arrays** (`orgMembers`, `roster`, `teamMembers`), so Service Mode can filter/load data upstream without changing mapping logic. What is **not yet present** (and noted only as comments):

- `buildCarrierSelectOptions(accessibleCarriers)` or similar
- `filterTeamMembersForOrganization(teamMembers, organizationId)`
- `loadTeamDataForOrganization(supabase, organizationId, actorProfile)` (shared with profile page)
- `permitFormToCarrierDriverSnapshot(fields, selectedDriverKey?)` for save payloads

The gap is **orchestration and page wiring**, not the core mapping primitives.

### Page integration (`app/permit-test/page.tsx`)

Carrier Mode wiring is **correct and minimal**: load roster on auth, build options, handle selection, pass carrier IDs to route APIs, snapshot on save.

The page is already large (~3.5k lines). The new feature adds ~6 state variables, one Supabase loader, one handler, and a form section — reasonable footprint, but several patterns increase long-term cost (see Open Issues).

---

## End-to-End Flow (Carrier Mode)

```
Auth mount
  → load member_profiles row for session user
  → loadPermitTeamData(supabase, userId, profile)
      → if primary owner: fetch org member_profiles + team_member_profiles
      → buildTeamMemberList → teamMembers
  → buildDriverSelectOptions(teamMembers) → driverSelectOptions

User selects driver
  → handleDriverSelect(compositeKey)
      → resolveDriverProfileForSelection(selection, orgMemberRows, teamRosterRows, ownProfile)
      → memberProfileToPermitAutofill(profileRow)
      → merge patch into formData (manual edits allowed afterward)

Route analysis / save
  → permitFormToLoadDetailsCarrierFields(formData) → dotNumber/mcNumber on API payloads
  → carrierDriver snapshot (inline) on /api/permit-requests
```

---

## Open Issues

### 1
- **Severity:** bug
- **File:line:** `app/permit-test/page.tsx:244–257`
- **Description:** Choosing the blank option (`"— Select a driver —"`) sets `selectedDriverKey` to `''` but `parseDriverSelectionKey('')` returns `null` and the handler returns early **without clearing** previously auto-filled carrier/driver fields. Users cannot reset the form via the dropdown; stale data may persist into route analysis and save payloads.
- **Suggestion:** On empty/invalid key, reset carrier/driver slice with `EMPTY_PERMIT_CARRIER_DRIVER_FIELDS` (or a lib helper `clearPermitCarrierDriverFields(prev)`).
- **Status:** open

### 2
- **Severity:** suggestion
- **File:line:** `app/permit-test/page.tsx:97–125`, `app/profile/page.tsx:253–282`
- **Description:** `loadPermitTeamData` is nearly identical to profile page `loadTeamData` (same Supabase queries, `isPrimaryOwner` gate, `buildTeamMemberList` call). Divergence risk when permissions or query shape change.
- **Suggestion:** Extract shared `loadOrganizationTeamData(supabase, organizationId, actorProfile, userId)` into `lib/member-profile-permissions.ts` or a thin `lib/team-data-loader.ts` used by both pages.
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `app/permit-test/page.tsx:1474–1492`, `app/permit-test/page.tsx:1609–1627`
- **Description:** The `carrierDriver` save snapshot is **duplicated verbatim** in two handlers (~18 fields × 2). Any new field requires two edits and risks drift (note `selectedDriverKey` is already only in save snapshot, not in `PermitCarrierDriverFormFields`).
- **Suggestion:** Add `permitFormToCarrierDriverSnapshot(fields, selectedDriverKey?: string)` to `lib/permit-profile-autofill.ts` and unit-test it alongside `permitFormToLoadDetailsCarrierFields`.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `app/permit-test/page.tsx:95–96`, `app/permit-test/page.tsx:97–125`, `lib/organization-context.ts:54–71`
- **Description:** Service Mode is stubbed in comments but **not wired**. `useOrganizationContext` only destructures `workspaceMode`; `effectiveOrganizationId`, `activeOrganizationId`, and `accessibleCarriers` are unused. `loadPermitTeamData` always scopes to the **logged-in user's** `profile.organization_id`, not the active carrier in Service Mode. Team data is loaded once on auth with no `useEffect` on carrier/mode changes.
- **Suggestion:** For Service Mode: (a) reload team data when `effectiveOrganizationId` changes; (b) pass target `organizationId` into the shared loader; (c) add carrier dropdown using `accessibleCarriers` + `organizationDisplayName`; (d) consider whether `isPrimaryOwner(actor)` is the right gate when a permit clerk acts on a linked carrier (may need service-role-aware loader).
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `lib/permit-profile-autofill.ts:130`, `app/permit-test/page.tsx:2272`
- **Description:** `SERVICE_MODE_TODO` comments document intent but provide **no typed extension points**. Tests assert the comment string exists (`permit-profile-ui.test.ts:82–88`) rather than a function signature or hook contract. Future implementers must invent API shape from scratch.
- **Suggestion:** Add minimal exported stubs with explicit types, e.g. `buildCarrierSelectOptions(carriers: AccessibleCarrier[])` returning `{ id, label }[]`, and `filterDriverOptionsForCarrier(options, organizationId)` — even if they throw or return `[]` until implemented. Tests can lock the API.
- **Status:** open

### 6
- **Severity:** suggestion
- **File:line:** `app/permit-test/page.tsx:2237–2239`, `app/permit-test/page.tsx:2242–2270`
- **Description:** Section copy says *"Select a saved team member to auto-fill…"* for all workspace modes, but the selector is **hidden in Service Mode**. Users in Service Mode see instructions for an affordance that is not present; they can only type manually.
- **Suggestion:** Branch helper text on `workspaceMode` (e.g. Service Mode: *"Enter carrier and driver details for the selected carrier"* with link to `/carriers`), or show a disabled placeholder explaining carrier must be selected first.
- **Status:** open

### 7
- **Severity:** suggestion
- **File:line:** `lib/permit-profile-autofill.ts:95–107`, `app/permit-test/page.tsx:2245`
- **Description:** UI label is **"Select Driver"** but `buildDriverSelectOptions` includes **all** team members (owners, permit clerks, viewers) — same as profile Team Roster, but the label implies role filtering. Test fixture explicitly includes a Permit Clerk in the dropdown (`permit-profile-autofill.test.ts:120–133`).
- **Suggestion:** Either rename to **"Select Team Member"** (accurate today) or add optional `filterRoles?: UserRole[]` to `buildDriverSelectOptions` defaulting to driver-eligible roles for permit workflows.
- **Status:** open

### 8
- **Severity:** suggestion
- **File:line:** `app/permit-test/page.tsx:92`, `app/permit-test/page.tsx:244–257`
- **Description:** `selectedDriverKey` and auto-filled `formData` are **not reset** when user switches workspace mode (`CarrierContextBar`) or changes active carrier in Service Mode. Stale `selectedDriverKey` can be saved in `carrierDriver` snapshot even when the dropdown is hidden (`page.tsx:1491`, `1626`).
- **Suggestion:** `useEffect` on `[workspaceMode, effectiveOrganizationId]` to clear `selectedDriverKey` and reset carrier/driver fields (or re-apply autofill if a valid selection exists in the new scope).
- **Status:** open

### 9
- **Severity:** suggestion
- **File:line:** `app/permit-test/page.tsx:191–240`
- **Description:** Carrier/driver fields are merged into a large anonymous `formData` object via spread. TypeScript does not enforce that `formData` satisfies `PermitCarrierDriverFormFields`; field renames in the lib won't surface at compile time on the page.
- **Suggestion:** Type the carrier/driver slice explicitly, e.g. `useState<RouteFormData & PermitCarrierDriverFormFields>` or a nested `formData.carrierDriver` object with lib helpers operating on that subtree.
- **Status:** open

### 10
- **Severity:** suggestion
- **File:line:** `app/permit-test/permit-profile-ui.test.ts:81–88`
- **Description:** Service Mode test only checks that the **lib comment** mentions `effectiveOrganizationId`; it does **not** assert page-level use of `effectiveOrganizationId`, `accessibleCarriers`, or reload-on-carrier-change. The gap in Open Issue #4 would not fail CI.
- **Suggestion:** Add page source assertions for `effectiveOrganizationId` usage once wired; until then, document that service mode is intentionally unimplemented beyond stubs.
- **Status:** open

### 11
- **Severity:** nit
- **File:line:** `lib/permit-profile-autofill.ts:97–100`
- **Description:** Role hint fallback uses string `'Member'`, which is **not** in `USER_ROLE_OPTIONS` (`types/member-profile.ts:1–6`). Labels may show `"(Member)"` for members with empty/invalid `user_roles`.
- **Suggestion:** Fall back to `'Viewer'` or `member.user_roles[0] ?? 'Driver'` depending on product intent, or use a shared `formatRoleHint(roles)` from `member-profile-permissions`.
- **Status:** open

### 12
- **Severity:** nit
- **File:line:** `lib/permit-profile-autofill.ts:114–127`
- **Description:** `parseDriverSelectionKey` splits on the **first** `':'`. Safe for UUIDs; fragile if ids ever contain colons.
- **Suggestion:** Use a reserved delimiter (e.g. `'|'`) or `JSON.stringify`/`split` with a fixed two-part regex; document constraint if keeping `':'`.
- **Status:** open

### 13
- **Severity:** nit
- **File:line:** `app/permit-test/page.tsx:97`, `app/permit-test/page.tsx:242`
- **Description:** `driverSelectOptions` is recomputed every render from `teamMembers`. Cheap today; if roster grows, memoize with `useMemo(() => buildDriverSelectOptions(teamMembers), [teamMembers])`.
- **Suggestion:** Optional `useMemo` for consistency with other derived state on this page.
- **Status:** open

---

## Naming Review

| Symbol | Verdict | Notes |
|--------|---------|-------|
| `PermitCarrierDriverFormFields` | Good | Clear scope; camelCase matches form state |
| `memberProfileToPermitAutofill` | Good | Directional `XToY` pattern consistent with codebase |
| `permitFormToLoadDetailsCarrierFields` | Good but long | Accurately describes API subset; pairs with future `…Snapshot` helper |
| `resolveDriverProfileForSelection` | Good | "Resolve" signals lookup, not mutation |
| `loadPermitTeamData` | Acceptable | Parallel to profile `loadTeamData` — consider unified name if extracted |
| `handleDriverSelect` | Slightly narrow | Handles all team members, not only drivers (see Issue #7) |
| `orgMemberRows` / `teamRosterRows` | Good | Distinguishes linked accounts vs roster-only rows |
| `EMPTY_PERMIT_CARRIER_DRIVER_FIELDS` | Good | Screaming snake for constant defaults |
| `SERVICE_MODE_TODO` | Acceptable | Fine as temporary; replace with real exports when implementing |

---

## Service Mode Extensibility — Summary

| Capability | Lib ready? | Page ready? |
|------------|------------|-------------|
| Map profile → form fields | Yes | Yes |
| Build driver dropdown options from list | Yes | Yes (Carrier Mode only) |
| Resolve selection to full row | Yes | Yes |
| Extract API carrier IDs | Yes | Yes |
| Load team data for arbitrary org | No shared loader | No — uses actor's org only |
| Select carrier then drivers | Comment only | Comment only |
| React to `effectiveOrganizationId` | N/A | No |
| Save snapshot helper | No | Inline duplicate |

**Conclusion:** The lib is **appropriately extensible** for Service Mode at the data-transformation layer. The missing work is **shared loading**, **carrier-first UI orchestration**, and **context-driven reload** — not a rewrite of mapping logic.

---

## Strengths (Pass 3)

1. **Clean separation** — Business logic in `lib/permit-profile-autofill.ts`; page remains orchestration + JSX.
2. **Consistent permissions** — Reusing `buildTeamMemberList` avoids a second roster visibility model.
3. **Non-destructive autofill** — Patch merge preserves manual edits until user picks another driver.
4. **USDOT sync on manual edit** — USDOT input updates both `usdotNumber` and `dotNumber` (`page.tsx:2288–2293`), keeping display and API fields aligned.
5. **Test pyramid** — Strong unit tests on lib; UI tests follow established source-inspection pattern (`profile-ui.test.ts`).
6. **Incremental Service Mode** — Stubs and `CarrierContextBar`/`ActiveCarrierBanner` provide UI shell without blocking Carrier Mode ship.

---

## Recommended Next Steps (When Implementing Service Mode)

1. Extract shared team data loader; parameterize by `organizationId`.
2. Add lib exports: `permitFormToCarrierDriverSnapshot`, `buildCarrierSelectOptions`, optional `filterDriverSelectOptions`.
3. Wire `effectiveOrganizationId` + reload effect on permit-test page.
4. Fix driver deselect clear (Issue #1) before Service Mode adds a second selector.
5. Align naming: "Select Driver" vs role filtering (Issue #7).

---

*End of review. All issues marked **open**; no code changes made.*