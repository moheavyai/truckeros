# Final Re-Review: Permit Profile Autofill (3b02a731) — After Fix Round 1

**Reviewer:** general  
**Scope:** `lib/permit-profile-autofill.ts` (`mergePermitAutofillPatch`, `carrierSource` / `memberProfileToPermitAutofill`), `app/permit-test/page.tsx` (`handleDriverSelect`)  
**Tests:** 25/25 passing (`lib/permit-profile-autofill.test.ts` 18, `app/permit-test/permit-profile-ui.test.ts` 7)

---

## Fix Round 1 — Verification

| # | Issue | Verdict |
|---|-------|---------|
| 1 | Deselect driver (`"— Select a driver —"`) does not clear autofill | **Resolved** — `handleDriverSelect` guards `!compositeKey` first, clears `selectedDriverKey`, spreads `EMPTY_PERMIT_CARRIER_DRIVER_FIELDS` over `formData` (`page.tsx:248–251`). UI test asserts handler slice (`permit-profile-ui.test.ts:97–103`). |
| 2 | Driver-only / roster-only selection wipes carrier fields | **Resolved** — `resolveOrgCarrierProfileForAutofill` supplies `carrierSource`; `memberProfileToPermitAutofill` fills carrier from `carrierSource` when `hasCarrierData(profile)` is false (`permit-profile-autofill.ts:135–144`); `mergePermitAutofillPatch` only overwrites carrier keys when patch values are non-empty after trim (`permit-profile-autofill.ts:180–185`). Unit tests cover carrierSource fill and carrier preservation (`permit-profile-autofill.test.ts:107–126`, `155–175`). |

---

## Code Path Review

### `handleDriverSelect` (`page.tsx:247–270`)

```
compositeKey === ''  →  reset selectedDriverKey + EMPTY_PERMIT_CARRIER_DRIVER_FIELDS
compositeKey valid   →  resolveDriverProfileForSelection(...)
                      →  resolveOrgCarrierProfileForAutofill(ownProfile, orgMemberRows)
                      →  memberProfileToPermitAutofill(profileRow, { carrierSource })
                      →  mergePermitAutofillPatch(pickPermitCarrierDriverFields(prev), patch)
```

- Deselect no longer relies on `parseDriverSelectionKey('')` (which returns `null`); empty key is handled before parsing.
- `pickPermitCarrierDriverFields(prev)` limits merge to the carrier/driver slice; other `formData` fields are untouched.
- Dropdown option keys (`driverSelectionKey`) round-trip with `parseDriverSelectionKey` and resolve via the same `orgMemberRows` / `teamRosterRows` used to build `driverSelectOptions`.

### `memberProfileToPermitAutofill` + `carrierSource` (`permit-profile-autofill.ts:129–145`)

- When selected row has **no** carrier columns (`hasCarrierData` false), carrier block comes from `carrierSource` if it also has carrier data.
- When selected row has **any** carrier column, entire carrier block comes from that row (documented behavior); empty carrier keys in the patch do not wipe existing values because `mergePermitAutofillPatch` skips empty carrier overwrites.
- Driver fields always come from the selected row.

### `mergePermitAutofillPatch` (`permit-profile-autofill.ts:170–188`)

- Driver keys: applied when present in patch (including explicit `''` clears).
- Carrier keys: applied only when `value !== undefined && trimField(value) !== ''`.
- Correctly preserves manually entered carrier data when a driver-only patch emits empty carrier strings.

---

## Edge Cases Checked (not open bugs)

| Scenario | Behavior | Assessment |
|----------|----------|------------|
| Owner → driver-only member | Carrier filled from `carrierSource`; driver fields updated | **Correct** |
| Driver-only → another driver-only | Org carrier re-applied from `carrierSource`; drivers swapped | **Correct** |
| Driver-only with manual carrier edits, no org carrier | Empty carrier patch; manual carrier preserved | **Correct** |
| Roster-only row | Same as driver-only; `carrierSource` backfills org carrier | **Correct** |
| Partial carrier on selected row | Carrier block from row; empty patch carrier keys preserve existing form carrier | **Correct per spec** |
| Non-primary user, self-only list | No `carrierSource` if actor/org rows lack carrier; manual entry required | **Correct** — matches permissions model |
| `resolveDriverProfileForSelection` returns `null` | Patch `{}`; form unchanged, dropdown shows selection | **Unreachable from generated options**; stale-key race is pre-existing low-risk edge |

---

## Summary

**Fix round 1 targets:** 2/2 verified fixed.

**Open bugs:** 0

---

## Optional Suggestions (not counted as open bugs)

- **Partial carrier gap-fill:** Rows with *some* carrier columns (e.g. `company_name` only) do not merge missing carrier fields from `carrierSource`; only rows with zero carrier data trigger fallback. Consider field-level merge if product expects full org carrier on every driver pick.
- **Unresolved selection:** If team data ever desyncs from dropdown options, consider clearing fields or reverting `selectedDriverKey` when `profileRow` is `null`.
- **Service Mode:** `carrierSource` / team load still scoped to actor org; stubs unchanged (expected for this round).
- **Tests:** Add `memberProfileToPermitAutofill(rosterProfile, { carrierSource })` fixture test for symmetry with `driverProfile` case.