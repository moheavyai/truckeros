# Driver Selector Improvements — Permit Test (Carrier Mode)

**IMPL_ID:** 963274f5

## Summary

Improved the Permit Test driver selector in carrier mode: only Driver-role team members appear, picker labels show CDL summaries, and a per-organization default driver (localStorage) auto-selects on load—mirroring default rig behavior.

## Changes

### `lib/permit-profile-autofill.ts`

- **`filterDriverTeamMembers`** — filters roster to `user_roles.includes('Driver')`
- **`buildDriverSelectOptions`** — uses filter; labels like `Dana Driver — CDL D7654321 (OK)` (no redundant role hint)
- **`sortDriverSelectOptionsWithDefault`** — marks default with `★`, sorts default first
- **`getDefaultPermitDriverKey` / `setDefaultPermitDriverKey` / `clearDefaultPermitDriverKey`** — localStorage helpers scoped per org

### `app/permit-test/page.tsx`

- Driver options built via `sortDriverSelectOptionsWithDefault(buildDriverSelectOptions(...), defaultDriverKey)`
- Auto-select default driver on carrier-mode load (`autoSelectDriverDoneRef`, same pattern as default rig)
- **Set as Default** button when a non-default driver is selected
- **★** indicator on default driver in summary row and picker options
- Empty state: **"No drivers on your team"** (was "No team members saved")

### Tests

- `lib/permit-profile-autofill.test.ts` — filter, labels, sort-with-default, localStorage helpers
- `app/permit-test/permit-profile-ui.test.ts` — default driver UI, auto-select, imports

## Default driver persistence choice

**localStorage**, key: `truckeros_default_permit_driver_{org_id}`

- No DB migration required (unlike rigs which use `rig_configurations.is_default`)
- Scoped per organization so multi-org users keep separate defaults
- Follows existing pattern in `lib/organization-context.ts` (`truckeros_workspace_mode`, `truckeros_active_organization_id`)
- Trade-off: default is per-browser, not synced across devices (acceptable for MVP; can migrate to a column later if needed)

## Test results

```
✓ lib/permit-profile-autofill.test.ts (30 tests)
✓ app/permit-test/permit-profile-ui.test.ts (15 tests)
```

Full `npm test`: 563 passed; 2 pre-existing failures in `app/profile/profile-ui.test.ts` (unrelated to this change—profile save `disabled=` assertions out of sync with current `page.tsx`).

## Review fixes (post-impl)

1. **Stale selection → re-auto-select** — when `selectedDriverKey` is cleared because it no longer exists in `driverSelectOptions`, `autoSelectDriverDoneRef.current` is reset so the auto-select effect can pick the default or first driver again.
2. **Stale default reconciliation** — new effect clears `localStorage` via `clearDefaultPermitDriverKey` and resets `defaultDriverKey` state when the stored default is absent from the current driver roster (removed member or role change).
3. **Unit test** — `sortDriverSelectOptionsWithDefault` when default is already first (star only, no reorder).
4. **UI slice test** — `handleSetDefaultDriver` persists to localStorage and updates `defaultDriverKey` state.