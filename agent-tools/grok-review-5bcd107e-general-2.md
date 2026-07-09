# Carrier Information Save Bootstrap Fix — General Review Pass 2

**Scope:** `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`, related tests  
**Reference:** `agent-tools/grok-impl-summary-5bcd107e.md`  
**Prior review:** `agent-tools/grok-review-fcd8976b-general.md` (fcd8976b final verify, 0 open) + onboarding gaps from `agent-tools/grok-review-3c36845c-general-3.md` #1  
**Tests (impl summary):** `npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts lib/team-member-profiles-api.test.ts lib/profile-persistence.test.ts` → **125/125 passing**

---

## Verified Fixed Since Pass 1

| Area | Status | Evidence |
|------|--------|----------|
| Carrier card hidden when Owner / Admin selected before first save | **Fixed** | `shouldShowCarrierInformationCard(..., form)` returns true when `hasOwnerAdminRole(form.user_roles)` (`lib/member-profile.ts:241–250`); test `shows carrier card when Owner / Admin is selected before first carrier save` |
| Primary-owner second save blocked by `isPrimaryOwner(ownProfile)` guard | **Fixed** | `handleSaveCarrierInfo` uses `canSaveCarrierInfo(ownProfile, formSnapshot)` (`app/profile/page.tsx:766`); `prepareMemberProfileSave` preserves org + `company_name` on rename (`lib/member-profile.test.ts` `flows company_name changes through…`) |
| Edge case: org present but `is_primary_owner: false` | **Fixed** | `prepareMemberProfileSave` sets `is_primary_owner = true` when `existing.is_primary_owner \|\| ownerAdminSelected` (`lib/member-profile.ts:520–524`); dedicated test `sets is_primary_owner when existing profile has org but flag was false…` |
| Server blocks pending Owner / Admin before primary flag | **Fixed** | `canActorSaveCarrierOnlyScope` allows `hasOwnerAdminRole(actorProfile.user_roles)` (`lib/team-member-profiles-api.ts:127–130`); test `allows Owner / Admin role holders to save carrier_only before primary owner flag is set` |
| Bootstrap carrier save without Owner / Admin | **Fixed** | Client `validateBootstrapCarrierSaveRoles` + server mirror when `!actorProfile` (`page.tsx:769–772`, `team-member-profiles-api.ts:205–209`); shared error message tested in both layers |
| Member edit card hidden after successful bootstrap carrier save | **Fixed** | `shouldShowMemberEditCard` returns true when `shouldShowBootstrapProfilePrompt(ownProfile)` (`lib/member-profile.ts:284–285`); bootstrap prompt rendered in member form (`page.tsx:1436–1440`); test `shows member edit card after bootstrap carrier save when driver details are pending` |
| Carrier edit/save gated on `primaryOwner` alone | **Fixed** | `canManageCarrier = canSaveCarrierInfo(ownProfile, form)` drives `showEditCarrierButton` and `showSaveCarrierInfoButton` (`page.tsx:1060,1085–1092`) |
| Form snapshot isolation | **Fixed** | `formSnapshot` captured at handler start before `setSavingCarrier` and before `getSession()` (`page.tsx:764–782`) |
| Concurrent save UX | **Fixed** | `carrierSaveInFlight = savingCarrier \|\| savingProfile`; carrier inputs/button use `disabled={carrierSaveInFlight}` (`page.tsx:1094,1205,1214`) |
| Production logging noise | **Fixed** | `logCarrierSaveDebug` / `logCarrierSaveWarn` gated to `NODE_ENV === 'development'` (`lib/member-profile.ts:183–190`) |
| Client org traceability | **Fixed** | Client `after` log includes `payloadOrgId` and `orgMatch` (`page.tsx:802–810`); JSDoc on `buildCarrierOnlyApiSavePayload` documents server authority (`lib/member-profile.ts:132–137`) |

### Intended flow after fix

1. **First visit** — user selects Owner / Admin in member edit card → carrier card visible → Save Carrier Info creates `organization_id` + `is_primary_owner` (roles merged in `buildCarrierOnlySavePayload` when `!existing`).
2. **Second save** — primary owner with existing org updates `company_name` without bootstrap role errors.
3. **Edge case** — profile with org but `is_primary_owner: false` + Owner / Admin in form → save promotes to primary owner and updates carrier fields.

---

## Open Issues

### 1
- **Severity:** bug
- **File:line:** `lib/member-profile.ts:160–167`, `lib/team-member-profiles-api.ts:199–200`, `app/profile/page.tsx:1060–1092`
- **Description:** `canSaveCarrierInfo` returns true for **any** profile with `organization_id`, including non–primary-owner Drivers. The UI shows carrier edit/save affordances, but `canActorSaveCarrierOnlyScope` rejects `carrier_only` unless the actor is primary owner or has Owner / Admin in **persisted** `user_roles`. A Driver linked to an org sees enabled carrier controls that always fail server-side with `Forbidden – only primary owners can save carrier-only updates`.
- **Suggestion:** Narrow the UI gate to `is_primary_owner === true`, pending bootstrap (`!profile`), or `hasOwnerAdminRole` in form/profile roles — drop the bare `organization_id` branch, or mirror server rules exactly (primary owner OR persisted Owner / Admin).
- **Status:** open

### 2
- **Severity:** bug
- **File:line:** `lib/team-member-profiles-api.ts:199–210`, `lib/member-profile.ts:170–180`
- **Description:** Server bootstrap role validation runs only when `saveScope === 'carrier_only' && !actorProfile`. If a user first saves a **member-only** profile (e.g. Driver, no org), then selects Owner / Admin in the form and clicks **Save Carrier Info**, the client passes `validateBootstrapCarrierSaveRoles` (form has Owner / Admin), but the server fails earlier at `canActorSaveCarrierOnlyScope(actorProfile)` because persisted roles lack Owner / Admin. Onboarding copy implies roles + carrier save suffice without an intermediate **Save Profile**.
- **Suggestion:** Run `validateBootstrapCarrierSaveRoles` for all `carrier_only` saves where `!actorProfile?.organization_id && !actorProfile?.is_primary_owner`, **or** extend `canActorSaveCarrierOnlyScope` to accept in-form Owner / Admin via `formForSave` (build `formForSave` before the permission gate, or add a `canBootstrapCarrierSave(actorProfile, form)` helper shared with the client).
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:1180–1187`
- **Description:** **Collapse** on the carrier card is still gated on `primaryOwner`, while edit/save use `canManageCarrier`. In the edge case org + `is_primary_owner: false` + Owner / Admin in form (before promotion), a user could edit and save carrier data but cannot collapse the expanded form via the header button.
- **Suggestion:** Gate collapse on `canManageCarrier && carrierSummaryMode` (or `primaryOwner \|\| canManageCarrier`) for consistency.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `app/profile/profile-ui.test.ts:414–415`, `app/profile/page.tsx:1060`
- **Description:** Implementation summary lists `canManageCarrier` wiring in `profile-ui.test.ts`, but tests only assert `canSaveCarrierInfo` inside `handleSaveCarrierInfo`. No source assertion that `showEditCarrierButton` / `showSaveCarrierInfoButton` use `canManageCarrier` instead of `primaryOwner`.
- **Suggestion:** Add `expect(source).toContain('const canManageCarrier = canSaveCarrierInfo')` and assert `showSaveCarrierInfoButton` guard includes `canManageCarrier` not `primaryOwner`.
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `lib/team-member-profiles-api.ts:162–235`, `lib/team-member-profiles-api.test.ts:161–235`
- **Description:** Mocked `saveTeamMemberProfileForUser` tests cover viewer rejection and non–primary-owner `carrier_only` Forbidden, but not: (a) bootstrap `carrier_only` with `actorProfile === null` succeeding, (b) pending Owner / Admin on an existing non-org profile (issue #2), or (c) primary-owner rename happy path through the async orchestrator.
- **Suggestion:** Add mocked upsert success cases for null-actor bootstrap and org-holder rename; assert `prepareMemberProfileSave` output reaches upsert unchanged.
- **Status:** open

### 6
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:1085–1090`, `app/profile/page.tsx:1058`
- **Description:** **Edit Carrier Info** requires `canWriteProfile && canManageCarrier`, while **Save Carrier Info** requires only `canManageCarrier`. Bootstrap (`ownProfile` null) is unaffected; the asymmetry only surfaces for edge permission combinations already blocked by handlers.
- **Suggestion:** Accept as-is; optional consistency pass if edit and save gates should be identical.
- **Status:** open

### 7
- **Severity:** nit
- **File:line:** `app/profile/profile-ui.test.ts:1–6`
- **Description:** UI tests remain static source inspection (documented accepted limitation). Runtime regressions — e.g. carrier card visibility toggling when toggling Owner / Admin checkbox, or server/client gate divergence (issues #1–#2) — are not caught without RTL or integration tests.
- **Suggestion:** No change required for ship; consider one mocked API integration test for the first-visit bootstrap sequence when a render harness is adopted.
- **Status:** open

---

## Summary by Severity

| Severity | Count |
|----------|-------|
| bug | 2 |
| suggestion | 3 |
| nit | 2 |
| **Total open** | **7** |

---

## Verdict

The **5bcd107e** bootstrap fix resolves the stated failure modes from the implementation summary and the prior **3c36845c** / **fcd8976b** review threads:

- Owner / Admin can unlock the carrier card and bootstrap org on first visit (null profile).
- Primary owners (and promoted edge-case profiles) can rename `company_name` on subsequent carrier saves.
- Client and server share bootstrap role validation for the null-actor path.
- Post-bootstrap onboarding UX (member edit card + driver prompt) is restored.

**Ship-risk:** Issue **#2** breaks the documented “select roles → save carrier” path when a profile row already exists without an organization (e.g. after an early member-only save). Issue **#1** may expose misleading carrier UI to org-linked Drivers. Both are permission/UX mismatches between `canSaveCarrierInfo` (client) and `canActorSaveCarrierOnlyScope` (server).

Remaining items are collapse-button consistency, test-depth gaps, and the accepted RTL limitation.

---

## Notes

- No code changes were made in this review pass.
- Test re-run was not executed in the review environment; counts follow `grok-impl-summary-5bcd107e.md` (**125/125**).
- Manual smoke steps from prior reviews still apply: filter dev console for `[carrier-save]` and verify org rename via `ensureOrganizationBootstrap` after carrier save.