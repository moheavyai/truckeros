# Carrier Information Save Bootstrap Fix

## Problem

Carrier Information saves were blocked or failed to bootstrap correctly when:

- A user selected **Owner / Admin** before the first carrier save but was not yet marked `is_primary_owner`
- An existing profile had `organization_id` but `is_primary_owner` was still `false`
- Primary owners with an established org could not reliably update carrier fields (e.g. `company_name`) on subsequent saves due to strict UI/API gates

## Solution

### 1. `lib/member-profile.ts`

- **`hasOwnerAdminRole`** — shared helper to detect Owner/Admin in form/profile roles
- **`canSaveCarrierInfo(profile, form)`** — allows carrier save when:
  - No profile yet (bootstrap)
  - `is_primary_owner === true`
  - Profile already has `organization_id`
  - Form has Owner/Admin selected (pending bootstrap)
- **`prepareMemberProfileSave`** — when existing profile has `organization_id`, preserves org id and sets `is_primary_owner = true` if the profile is already primary owner **or** form has Owner/Admin; bootstrap path unchanged for profiles without org
- **`validateBootstrapCarrierSaveRoles`** — only blocks when there is no `organization_id`, not primary owner, and no Owner/Admin in form
- **`shouldShowCarrierInformationCard`** — also shows card when form has Owner/Admin (so roles can be set in member edit card during bootstrap)
- **`buildCarrierOnlyApiSavePayload`** — includes `organization_id` when existing profile has org (unchanged behavior, clarified condition)

### 2. `lib/team-member-profiles-api.ts`

- **`canActorSaveCarrierOnlyScope`** — allows `carrier_only` when actor is primary owner **or** has Owner/Admin role (pending bootstrap), in addition to null-actor bootstrap

### 3. `app/profile/page.tsx`

- **`handleSaveCarrierInfo`** — replaced `ownProfile && !isPrimaryOwner(ownProfile)` guard with `!canSaveCarrierInfo(ownProfile, formSnapshot)`
- **Carrier card visibility** — `showCarrierCard` passes `form` into `shouldShowCarrierInformationCard`; `canManageCarrier` drives edit/save button visibility instead of `primaryOwner` alone

## Tests Added/Updated

| File | Coverage |
|------|----------|
| `lib/member-profile.test.ts` | First save bootstrap, second save `company_name` update, `is_primary_owner` promotion, `canSaveCarrierInfo`, carrier card with Owner/Admin form roles |
| `lib/team-member-profiles-api.test.ts` | Owner/Admin role holder allowed for `carrier_only` before primary flag |
| `app/profile/profile-ui.test.ts` | Handler uses `canSaveCarrierInfo`; `canManageCarrier` wired |
| `lib/profile-persistence.test.ts` | Existing org + company rename (unchanged, still passes) |

## Test Run

```
npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts lib/team-member-profiles-api.test.ts lib/profile-persistence.test.ts
```

**Result:** 4 files, 125 tests passed.

## Flow After Fix

1. **First visit** — user selects Owner/Admin in member edit card → carrier card visible → Save Carrier Info creates `organization_id` + `is_primary_owner`
2. **Second save** — primary owner with existing org updates `company_name` (and other carrier fields) without bootstrap role errors
3. **Edge case** — profile with org but `is_primary_owner: false` + Owner/Admin in form → save promotes to primary owner and updates carrier fields