# Implementation Summary: Unified Owner Bootstrap Setup

## Files Changed

| File | Change |
|------|--------|
| `lib/member-profile.ts` | Added bootstrap setup helpers; updated visibility rules for carrier/member cards |
| `app/profile/page.tsx` | Added unified bootstrap setup card; single-save bootstrap flow |
| `lib/member-profile.test.ts` | Added/updated tests for new helpers and visibility rules |
| `app/profile/profile-ui.test.ts` | Updated source-inspection tests for unified bootstrap UI |

## What Was Added / Modified

### `lib/member-profile.ts`

**New helpers:**
- `shouldShowOwnerBootstrapSetupCard()` — true when `isProfileBootstrap && editingTarget.kind === 'self'`
- `isOwnerOperatorSelected()` — checks for `['Owner', 'Driver']`
- `applyOwnerOperatorRoles()` — toggles Driver while keeping bootstrap Owner
- `prepareBootstrapFormForSave()` — ensures Owner role and mirrors email to carrier
- `getOwnerBootstrapSetupCardTitle()` — "Welcome to Truckeros"
- `getOwnerBootstrapSetupCardSubtitle()` — friendly one-step setup copy
- `getOwnerBootstrapSaveButtonLabel()` — "Complete Setup" / "Setting up..."

**Visibility changes:**
- `shouldShowCarrierInformationCard()` — returns `false` during bootstrap (unified card replaces it)
- `shouldShowMemberEditCard()` — returns `false` during bootstrap (no separate "Your Profile" box)

### `app/profile/page.tsx`

**New unified bootstrap card** (`showOwnerBootstrapSetup`):
- Welcome header with friendly copy
- **Your Contact Info:** Full Name, Email, Company Phone, Cell Phone
- **Carrier Details:** company name, USDOT#, MC#, EIN, address, insurance contact
- **Owner Operator** checkbox — adds Driver role when checked
- Single **Complete Setup** button via existing `handleSave` (full save, not two-step)

**Save flow:**
- Bootstrap uses `prepareBootstrapFormForSave()` before building payload
- Success message: "Welcome! Your carrier account is ready."
- Removed dead bootstrap amber banner from Carrier Information card

**Field constants:**
- `BOOTSTRAP_CONTACT_FIELDS` — contact fields for bootstrap
- `BOOTSTRAP_CARRIER_FIELDS` — carrier fields excluding phone/email (shown in contact section)

## Design Decisions

### Field Mapping

| UI Label | DB Field | Notes |
|----------|----------|-------|
| Full Name | `driver_full_name` | Owner's display name |
| Email | `driver_email` | Personal/contact email |
| Email (on save) | `carrier_email` | Mirrored from `driver_email` when `carrier_email` is empty |
| Company Phone | `carrier_phone` | Dispatch/office line |
| Cell Phone | `driver_phone` | Personal/mobile line |

**Duplicate phones allowed** — no validation blocks company phone === cell phone.

### Owner Operator Checkbox

- Unchecked: `user_roles: ['Owner']` (via `ensureBootstrapOwnerRoles`)
- Checked: `user_roles: ['Owner', 'Driver']`
- Permissions merge via existing `mergeRoleDefaults` in `team-permissions.ts` (Owner write + Driver permit/portal/file)

### Single Save vs Two-Step

Previously: Save Carrier Info → then Save Profile.  
Now: One **Complete Setup** save with full payload (`save_scope: 'full'` when no profile exists), creating org + profile in one action.

### Post-Bootstrap Layout

After `ownProfile` exists, the existing multi-card layout returns:
- Carrier Information card (summary/edit)
- "Your Profile" member edit card (for self-edit and team member management)
- Team Roster section

`shouldShowBootstrapProfilePrompt` remains for edge cases (legacy partial carrier-only saves without driver name).

## Test Results

```
npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts lib/team-permissions.test.ts

 ✓ lib/team-permissions.test.ts (13 tests)
 ✓ app/profile/profile-ui.test.ts (36 tests)
 ✓ lib/member-profile.test.ts (103 tests)

 Test Files  3 passed (3)
      Tests  152 passed (152)
```