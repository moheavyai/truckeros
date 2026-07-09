# Carrier Save Fix + User Roles UX Cleanup

## Summary

Fixed carrier information save failures for primary Owner/Admin users during bootstrap and landing flows, and simplified User Roles UX on the profile page.

## 1. Carrier save fixes

### Root cause
Bootstrap carrier saves failed when the User Roles section was hidden because `form.user_roles` was empty, causing:
- `validateBootstrapCarrierSaveRoles` to reject the save
- `prepareMemberProfileSave` / `shouldBootstrapOrganization` to skip org creation

### Changes (`lib/member-profile.ts`)
- **`ensureBootstrapOwnerAdminRoles(form)`** — auto-injects `Owner / Admin` when missing (preserves other roles)
- **`validateBootstrapCarrierSaveRoles`** — applies implicit bootstrap roles before validation
- **`buildCarrierOnlyApiSavePayload`** — applies bootstrap roles and includes `organization_id` on **all** paths (bootstrap + existing org), not only when `existing.organization_id` is set
- **`shouldBootstrapOrganization`** — also returns true when `existing.is_primary_owner === true` without an org
- **`prepareMemberProfileSave`** — unchanged signature; now bootstraps correctly via updated `shouldBootstrapOrganization`

### Client (`app/profile/page.tsx`)
- `useEffect` on first visit (`!ownProfile`) auto-sets `form.user_roles` to include Owner/Admin
- `handleSaveCarrierInfo` runs `ensureBootstrapOwnerAdminRoles` on form snapshot before validation/payload
- Carrier error messages use `result.error?.trim()` from API when save fails

### Server (`lib/team-member-profiles-api.ts`)
- Before bootstrap role validation on `carrier_only` saves, applies `ensureBootstrapOwnerAdminRoles` to `formForSave`

### Permissions (unchanged behavior, confirmed)
- `canSaveCarrierInfo`: `null` profile (bootstrap) → true; `is_primary_owner` → true

## 2. User Roles UX cleanup

### Landing / own profile
- **Removed** standalone User Roles checkbox section for self (`{showUserRolesSection && ...}` block deleted from page)
- **`shouldShowUserRolesSection`** — now returns `true` only when `editingTarget.kind !== 'self'` (team member edits use checkboxes inside member edit card)
- **`shouldShowOwnerAdminBadge`** — shows compact "You are Owner / Admin" badge on carrier card landing view for primary owners or DB Owner/Admin role holders
- Badge uses existing `roleBadgeClass('Owner / Admin')` styling

### Bootstrap copy
- Old: "Choose Owner / Admin in the User Roles section below..."
- New: "You are setting up as Owner / Admin. Add carrier details here to create your organization."

### Team member editing
- Unchanged: `UserRolesCheckboxGrid` remains in member edit card when `editingTarget.kind !== 'self'`

## 3. Tests

Updated and extended:
- `lib/member-profile.test.ts` — visibility rules, badge, bootstrap roles, API payload org_id on bootstrap
- `app/profile/profile-ui.test.ts` — no standalone roles section, badge, bootstrap mount/save wiring
- `lib/team-member-profiles-api.test.ts` — server bootstrap role injection
- `lib/profile-persistence.test.ts` — no changes required (still passes)

**Result:** `npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts lib/team-member-profiles-api.test.ts lib/profile-persistence.test.ts` — **154/154 passed**

## 4. Review follow-up (round 2)

- **`shouldShowAssignedRoleBadges`** — read-only role badges on landing for Driver/Viewer/etc.
- **`getMemberEditCardSubtitle`** — self subtitle omits roles; team edits retain roles copy
- **`CARRIER_SAVE_FORBIDDEN_MESSAGE`** — surfaced when `canSaveCarrierInfo` denies save
- **`buildCarrierOnlyApiSavePayload`** — injects bootstrap roles for all profiles lacking `organization_id` (including `is_primary_owner`)
- **`showUserRolesSection`** — single source of truth in page (replaces inline guard)
- **Edit/Collapse carrier buttons** — disabled during `carrierSaveInFlight`
- **Bootstrap `orgMatch` log** — `null` on first bootstrap save (server UUID is authoritative)

## Files changed

| File | Change |
|------|--------|
| `lib/member-profile.ts` | Bootstrap helpers, badge visibility, payload org_id |
| `lib/team-member-profiles-api.ts` | Server-side bootstrap role injection |
| `app/profile/page.tsx` | UX cleanup, bootstrap mount, carrier save flow |
| `lib/member-profile.test.ts` | New/updated unit tests |
| `app/profile/profile-ui.test.ts` | Updated source inspection tests |
| `lib/team-member-profiles-api.test.ts` | Updated bootstrap tests |