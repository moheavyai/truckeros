# Test Coverage Review: Carrier Save Fix + User Roles UX Cleanup

**Scope:** `agent-tools/grok-impl-summary-081946cf.md`  
**Reference implementation:** `ensureBootstrapOwnerAdminRoles`, `validateBootstrapCarrierSaveRoles`, `buildCarrierOnlyApiSavePayload`, `shouldBootstrapOrganization`, `shouldShowUserRolesSection`, `shouldShowOwnerAdminBadge`, `app/profile/page.tsx`, `lib/team-member-profiles-api.ts`  
**Date:** 2026-07-07

---

## Test Run (verified)

```bash
Set-Location C:\Users\andre\truckeros
npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts lib/team-member-profiles-api.test.ts lib/profile-persistence.test.ts
```

**Result:** **146/146 passing**

| File | Tests | Δ vs prior carrier-save suite (115) |
|------|-------|-------------------------------------|
| `lib/member-profile.test.ts` | 84 | +22 (`ensureBootstrapOwnerAdminRoles`, `shouldShowOwnerAdminBadge`, inverted `shouldShowUserRolesSection`, implicit bootstrap validation, empty-role API payload, primary-owner-without-org bootstrap) |
| `app/profile/profile-ui.test.ts` | 35 | +3 (standalone roles removal, badge/bootstrap wiring, updated bootstrap copy + API error trim) |
| `lib/team-member-profiles-api.test.ts` | 16 | +6 (server `ensureBootstrapOwnerAdminRoles` injection assertion) |
| `lib/profile-persistence.test.ts` | 11 | — (still passes unchanged) |

**Full regression:**

```bash
npx vitest run
```

**Result:** **459/459 passing** (4 skipped integration tests)

---

## Coverage Assessment

### ✅ Well covered

| Fix area | Tests | Notes |
|----------|-------|-------|
| **Root cause: empty `form.user_roles` blocking bootstrap save** | `ensureBootstrapOwnerAdminRoles` (2), `validateBootstrapCarrierSaveRoles` (3), `buildCarrierOnlyApiSavePayload` empty-role case (1) | Empty roles auto-inject Owner/Admin; validation passes without UI checkbox section |
| **Implicit bootstrap roles before validation** | member-profile `validateBootstrapCarrierSaveRoles`; profile-ui `auto-assigns bootstrap Owner / Admin roles on mount and carrier save`; team-member-profiles-api source + unit mirror | Client mount `useEffect`, handler `formSnapshot`, and server `formForSave` all wire `ensureBootstrapOwnerAdminRoles` |
| **`organization_id` on all carrier-only API paths** | `buildCarrierOnlyApiSavePayload` (3), integration in team-member-profiles-api (2), profile-persistence (1) | Bootstrap UUID generated; existing org preserved; aligns client payload with `prepareMemberProfileSave` |
| **`shouldBootstrapOrganization` primary-owner-without-org** | `prepareMemberProfileSave` bootstrap case (1) | Org UUID + `is_primary_owner` when profile exists without `organization_id` |
| **Server bootstrap gate** | team-member-profiles-api `saveTeamMemberProfileForUser bootstrap gate` (2), `canActorSaveCarrierOnlyScope` (5) | Source asserts `ensureBootstrapOwnerAdminRoles` precedes `validateBootstrapCarrierSaveRoles`; permission truth table unchanged and passing |
| **User Roles UX: remove standalone self section** | `shouldShowUserRolesSection` (2), profile-ui `hides standalone User Roles section…` | `source.not.toContain('{showUserRolesSection && (')`; helper returns true only for `editingTarget.kind !== 'self'` |
| **Owner / Admin badge on landing** | `shouldShowOwnerAdminBadge` (2), profile-ui badge source slice | Primary owner + DB Owner/Admin holders; hidden during bootstrap/edit/team flows |
| **Bootstrap copy update** | profile-ui `updates carrier bootstrap copy…` | New “setting up as Owner / Admin” copy; old “User Roles section below” references removed |
| **Team member role editing unchanged** | profile-ui `shows member edit card with…team-member-only roles` | `UserRolesCheckboxGrid` remains inside member edit card with `editingTarget.kind !== 'self'` |
| **API error surfacing** | profile-ui `persists bootstrap roles…` | Handler asserts `result.error?.trim() \|\| 'Failed to save carrier information.'` |
| **Carrier save isolation / guards** | profile-ui `uses separate saving flags…`, member-profile `canSaveCarrierInfo` | Prior carrier-save review coverage retained |

### Acceptable gaps (non-blocking, not open)

| # | Severity | Gap | Rationale |
|---|----------|-----|-----------|
| 1 | nit | **`shouldBootstrapOrganization` `is_primary_owner` branch** — no dedicated unit test; only exercised via `prepareMemberProfileSave`. | Behavior is covered end-to-end at upsert-prep layer; direct helper test would be redundant documentation. |
| 2 | nit | **`buildCarrierOnlyApiSavePayload` when `existing.is_primary_owner` without `organization_id`** — no explicit API-payload assertion. | `prepareMemberProfileSave` path tested; `buildCarrierOnlyApiSavePayload` delegates org resolution to same helper. |
| 3 | suggestion | **`saveTeamMemberProfileForUser` async bootstrap with empty roles** — no mocked Supabase test proving upsert succeeds after server role injection. | Injection order verified by source inspection + `validateBootstrapCarrierSaveRoles` unit tests; permission gate separately unit-tested. |
| 4 | nit | **Legacy `isUserRolesReadOnlyOnProfile` / `getUserRolesSectionHelperText` tests** — still present though standalone self section removed. | Helpers may still apply to team-member flows or future reuse; tests are harmless and passing. |
| 5 | nit | **Runtime badge/landing visibility** — no RTL render test. | Documented accepted project limitation; source-inspection + pure helper tests cover wiring. |

---

## Open Issues

**No open issues.**

| Severity | Open |
|----------|------|
| bug | 0 |
| suggestion | 0 |
| nit | 0 |
| **Total open** | **0** |

---

## Verdict

**Approve for merge** — all 146 targeted tests pass and cover the reported bootstrap save failure and User Roles UX cleanup:

1. **Empty roles blocking carrier bootstrap** → `ensureBootstrapOwnerAdminRoles` unit tests + implicit validation + client mount/handler + server injection source assertions.
2. **Org creation skipped without roles** → `shouldBootstrapOrganization` / `prepareMemberProfileSave` bootstrap paths + `buildCarrierOnlyApiSavePayload` org_id on null profile and empty-role bootstrap.
3. **Standalone User Roles section removed** → negative source assertion + inverted `shouldShowUserRolesSection` + badge helper/UI wiring.
4. **Primary owner without org** → `prepareMemberProfileSave` bootstrap case + `validateBootstrapCarrierSaveRoles` skip for `is_primary_owner`.

Manual smoke test remains appropriate for full browser bootstrap flow (first visit → carrier save → org row creation) and dev-only `[carrier-save]` logging, which are not mocked end-to-end in unit tests.