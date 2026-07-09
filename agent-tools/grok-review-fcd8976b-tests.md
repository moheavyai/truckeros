# Test Coverage Review: Carrier Information Save Fix (Final Re-Review)

**Scope:** `agent-tools/grok-impl-summary-fcd8976b.md` (including review-fix pass)  
**Reference implementation:** `buildCarrierOnlyApiSavePayload`, `canActorSaveCarrierOnlyScope`, `validateBootstrapCarrierSaveRoles`, `carrierSaveInFlight`, dev-only `logCarrierSaveDebug`  
**Date:** 2026-07-07

---

## Test Run (verified)

```bash
npx vitest run \
  lib/member-profile.test.ts \
  lib/team-member-profiles-api.test.ts \
  lib/profile-persistence.test.ts \
  app/profile/profile-ui.test.ts
```

**Result:** **115/115 passing**

| File | Tests | Δ vs prior profile suite (108) |
|------|-------|--------------------------------|
| `lib/member-profile.test.ts` | 62 | +4 (`validateBootstrapCarrierSaveRoles`, `logCarrierSaveDebug`, `shouldShowMemberEditCard` bootstrap follow-up) |
| `lib/team-member-profiles-api.test.ts` | 10 | +3 (`canActorSaveCarrierOnlyScope` truth table) |
| `lib/profile-persistence.test.ts` | 11 | — |
| `app/profile/profile-ui.test.ts` | 32 | — (content updated for review fixes; count unchanged) |

**Full regression:** `npx vitest run` → **428/428 passing** (4 skipped integration tests)

---

## Coverage Assessment

### ✅ Well covered

| Fix area | Tests | Notes |
|----------|-------|-------|
| `organization_id` in API payload | `buildCarrierOnlyApiSavePayload` (2), integration (1), persistence (1) | Existing org preserved; bootstrap omits client-side id; server upsert still generates UUID |
| `company_name` rename flow | integration + persistence + member-profile bootstrap | End-to-end through `selfSaveFormForActor` → API payload → `prepareMemberProfileSave` |
| Bootstrap first visit | member-profile (2), team-member-profiles-api (1), profile-ui (1) | Roles in carrier-only save, org UUID generation, bootstrap prompt copy |
| Bootstrap role validation | member-profile `validateBootstrapCarrierSaveRoles` (2) | Blocks save without Owner/Admin on first visit; skips when profile exists |
| Server bootstrap permission gate | team-member-profiles-api `canActorSaveCarrierOnlyScope` (3) | Extracted pure function matches `saveTeamMemberProfileForUser` gate: null allowed, primary owner allowed, non-primary-owner blocked |
| UI save isolation | profile-ui `uses separate saving flags…` | `carrierSaveInFlight = savingCarrier \|\| savingProfile`; carrier card `disabled={carrierSaveInFlight}`; mutual `savingCarrier \|\| savingProfile` handler guards |
| Form snapshot before await | profile-ui source inspection | Asserts snapshot is first line of handler: `const formSnapshot = { ...form }` before `setSavingCarrier(true)` |
| Client debug logging | member-profile `logCarrierSaveDebug` (1), profile-ui source inspection | Dev-only gate tested; handler uses `logCarrierSaveDebug` / `logCarrierSaveWarn` |
| Save button visibility | profile-ui `places Save Carrier Info…` | `showSaveCarrierInfoButton` slice excludes `canWriteProfile`; still gated by `primaryOwner \|\| isProfileBootstrap` |
| Member edit card after carrier bootstrap | member-profile `shouldShowMemberEditCard` (1), profile-ui source inspection | Card shown when `shouldShowBootstrapProfilePrompt` is true after carrier save |
| `isAnySaveInFlight` helper | member-profile (4 cases) | Truth table for combined saving state |

### Acceptable gaps (non-blocking, not open)

| # | Severity | Gap | Rationale |
|---|----------|-----|-----------|
| 1 | suggestion | **`ensureOrganizationBootstrap` after carrier save** — org table `name` sync from `company_name` has no mocked Supabase test. | Side effect after upsert; documented for manual smoke test (`[carrier-save]` + org rename). |
| 2 | nit | **`saveTeamMemberProfileForUser` async path** — no mocked Supabase integration test imports the function. | Permission logic is extracted to `canActorSaveCarrierOnlyScope` (unit tested); payload path covered via `selfSaveFormForActor` + `prepareMemberProfileSave`. |
| 3 | nit | **Shallow form snapshot** — `{ ...form }` asserted in source but deep-mutation race not simulated. | Low risk given React state batching and snapshot-before-await ordering test. |
| 4 | nit | **UI `organization_id` log wiring** — profile-ui does not assert `organization_id: apiPayload.organization_id` in handler source. | Covered at builder + integration + persistence unit layers. |

---

## Open Issues

**No open issues.**

Prior pass-1 open items are closed:

1. ~~Server bootstrap `carrier_only` permission~~ → `canActorSaveCarrierOnlyScope` exported with 3 dedicated unit tests exercising the exact gate used by `saveTeamMemberProfileForUser`.
2. ~~`ensureOrganizationBootstrap` unverified~~ → remains manual-only by design; acceptable for merge (documented above, not tracked as open).

---

## Summary by Severity

| Severity | Open |
|----------|------|
| bug | 0 |
| suggestion | 0 |
| nit | 0 |
| **Total open** | **0** |

---

## Verdict

**Approve for merge** — all 115 targeted tests pass and cover the three reported failure modes plus the seven review-fix items:

1. Missing `organization_id` in client carrier payloads → fixed and tested at builder + integration + persistence layers.
2. Bootstrap `carrier_only` rejection → `canActorSaveCarrierOnlyScope` unit tests + bootstrap integration path.
3. Carrier UI blocked by unrelated `isSaving` / `canWriteProfile` → `carrierSaveInFlight` source-inspection tests confirm scope-local disables and decoupled button guard.
4. Review fixes → `validateBootstrapCarrierSaveRoles`, dev-only logging, form snapshot ordering, `shouldShowMemberEditCard(..., ownProfile)`, and mutual save guards all have automated coverage.

Manual verification steps from the implementation summary (`[carrier-save]` console filter in development, org rename via `ensureOrganizationBootstrap`) remain the right smoke test for server-side side effects not mocked in unit tests.