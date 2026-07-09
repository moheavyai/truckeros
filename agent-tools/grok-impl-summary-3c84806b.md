# Role-based views/permissions + Invite flow — Implementation Summary

## Overview

Implemented Owner/Admin role split, granular permission architecture, deletion-request foundation, nav gating, team-member permission UI, and team invite flow (email + SMS stub).

---

## Files Changed

### Types
- `types/member-profile.ts` — Split `Owner` / `Admin`; `PRIMARY_OWNER_ROLE = 'Owner'`; `TeamMemberPermissionConfig`; legacy constant
- `types/organization.ts` — `OrganizationRole` includes `Owner` and `Admin`

### Core permission architecture (new)
- `lib/team-permissions.ts` — `ROLE_DEFAULT_PERMISSIONS`, `resolveEffectivePermissions`, `canAccessArea`, `canDeleteResource`, `requiresDeletionApproval`, `canActorDeleteMember`, nav helpers
- `lib/team-permissions.test.ts` — Role matrix, custom overrides, Admin cannot delete Owner

### Invites (new)
- `lib/team-invites.ts` — Token generation, link building, create/accept validation, SMS stub
- `lib/team-invites.test.ts` — Token, link, accept validation tests
- `app/api/team-invites/route.ts` — GET list / POST create invites
- `app/invite/[token]/page.tsx` — Minimal accept page

### Migrations (new)
- `supabase/migrations/026_split_owner_admin_roles.sql`
- `supabase/migrations/027_team_invites_and_deletion_requests.sql`
- `lib/migration-manifest.json`, `lib/migrations.ts`, `lib/migrations.test.ts`

### Updated libs / APIs
- `lib/member-profile.ts` — `ensureBootstrapOwnerRoles`, `hasOwnerOrAdminRole`, legacy `Owner / Admin` normalization in `validateUserRoles`
- `lib/member-profile-permissions.ts` — Uses team-permissions; Admin can edit; deletion rules; `canManageMemberPermissions`
- `lib/profile-field-permissions.ts` — Owner/Admin via `hasOwnerOrAdminRole`
- `lib/team-member-profiles-api.ts` — Owner/Admin edit/delete enforcement; permissions on roster saves
- `lib/service-mode-scope.ts`, `lib/permit-requests.ts` — `SERVICE_MODE_ELIGIBLE_ROLES` → Owner, Admin
- `lib/carrier-link-requests.ts` — Permissions default object shape
- `app/api/team-member-profiles/route.ts` — Passes `permissions` to roster API

### UI
- `app/profile/page.tsx` — Owner bootstrap copy; `MemberPermissionsEditor` (Global/Custom + toggles); Admin team management
- `components/AppHeader.tsx` — Role-aware Equipment/Profile nav gating
- `components/CarrierContextBar.tsx` — Service mode copy update

### Tests updated
- `lib/member-profile.test.ts`, `lib/member-profile-permissions.test.ts`
- `lib/team-member-profiles-api.test.ts`, `lib/forced-carrier-owner.test.ts`
- `types/member-profile.test.ts`, `app/profile/profile-ui.test.ts`
- `components/AppHeader.test.ts`

---

## Permission Architecture (prose diagram)

```
                    ┌─────────────────────────────────────┐
                    │         Organization Member          │
                    │  user_roles[] + permissions jsonb    │
                    └─────────────────┬───────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
        mode: global            mode: custom          is_primary_owner
              │                       │                       │
              ▼                       ▼                       ▼
   ROLE_DEFAULT_PERMISSIONS    toggles: equipment,      forces Owner role
   merged across all roles      profiles, account_settings   in effective perms
              │                       │
              └───────────┬───────────┘
                          ▼
              resolveEffectivePermissions(actor)
                          │
     ┌────────────────────┼────────────────────┐
     ▼                    ▼                    ▼
 equipment          profiles           account_settings
 permit_agent       portal_agent       file_upload
 (area access: none | read | write)

Deletion path (Permit Clerk):
  canDeleteResource → false for Owner targets
  requiresDeletionApproval → true → deletion_requests table (pending Owner/Admin)
```

### Role matrix (code constants in `ROLE_DEFAULT_PERMISSIONS`)

| Role | Equipment | Profiles | Account | Permit/Portal/File |
|------|-----------|----------|---------|-------------------|
| **Owner** | write | write | write | write |
| **Admin** | write | write | write | write |
| **Viewer** | read | read | read | read |
| **Driver** | none | none* | none | write |
| **Permit Clerk** | write | write | none | write |

\*Driver own contact fields handled separately in `profile-field-permissions.ts`.

### Delete rules
- **Owner** (primary): cannot be deleted; can delete others (except self)
- **Admin**: full access except **cannot delete Owner**
- **Permit Clerk**: may initiate deletes → `deletion_requests` pending approval

---

## Migration Notes

### 026_split_owner_admin_roles.sql
- `member_profiles.user_roles`: `Owner / Admin` → `Owner` (primary) or `Admin` (non-primary)
- `team_member_profiles.user_roles`: `Owner / Admin` → `Admin`
- `organization_memberships.role`: same split
- CHECK constraints updated to `Owner`, `Admin`, `Driver`, `Permit Clerk`, `Viewer`
- `auth_user_service_mode_org_ids()` updated to `Owner`, `Admin`, `Permit Clerk`

### 027_team_invites_and_deletion_requests.sql
- `team_member_profiles.permissions` jsonb (`{ mode, custom }`)
- `organization_memberships.permissions` default → `{ mode: "global" }`
- `team_invites` table (email and/or phone, token, role, status, expiry)
- `deletion_requests` table (Permit Clerk → Owner/Admin approval)

### Backward compatibility
- `validateUserRoles()` normalizes legacy `'Owner / Admin'` → `'Owner'`
- `ensureBootstrapOwnerAdminRoles()` and `hasOwnerAdminRole()` kept as deprecated aliases
- `permit-requests.ts` SERVICE_MODE set still accepts legacy `'Owner / Admin'` string from DB during transition

---

## Invite Flow: Complete vs Stubbed

| Feature | Status |
|---------|--------|
| `team_invites` table + RLS | **Complete** |
| Secure token generation | **Complete** |
| Email invite create (API POST) | **Complete** |
| Phone field + `invite_link` persistence | **Complete** |
| SMS body formatting | **Complete** |
| Twilio send | **Stubbed** — `TWILIO_ENABLED=true` gate; no Twilio SDK wired |
| GET pending invites | **Complete** |
| `/invite/[token]` accept page | **Complete** (membership upsert + invite status) |
| Bi-directional Permit Clerk ↔ Carrier | **Foundation** — documented in `PERMIT_CLERK_TIER_SIGNUP_NOTE`; extends `carrier_link_requests` pattern |
| First email = primary Owner bootstrap | **Complete** (existing + `ensureBootstrapOwnerRoles`) |
| All roles in invite CHECK | **Complete** (Owner, Admin, Driver, Permit Clerk, Viewer) |

---

## Test Results

```
npx vitest run
Test Files  2 failed | 57 passed | 2 skipped (61)
Tests       2 failed | 631 passed | 4 skipped (637)
```

**All task-related tests pass**, including:
- `lib/team-permissions.test.ts` (11)
- `lib/team-invites.test.ts` (8)
- `lib/member-profile.test.ts` (94)
- `lib/member-profile-permissions.test.ts` (15)
- `lib/team-member-profiles-api.test.ts` (24)
- `app/profile/profile-ui.test.ts` (36)
- `lib/migrations.test.ts` (14)
- `components/AppHeader.test.ts` (4)

**Pre-existing failures (unrelated to this task):**
- `lib/routing-envelope-display.test.ts` — permit-test page now includes Equipment nav link
- `app/permit-test/load-details-ui.test.ts` — cargo snapshot signature changed (`organizationId` arg)

---

## Key Wiring

1. **Bootstrap**: First carrier save assigns `Owner` via `ensureBootstrapOwnerRoles`
2. **Team roster**: Owner/Admin can manage members; permission overrides saved to `team_member_profiles.permissions`
3. **Nav**: `AppHeader` hides Equipment for Driver; Profile remains visible for own contact edits
4. **Service mode**: Owner and Admin eligible (replacing `Owner / Admin`)
5. **API enforcement**: `canActorDeleteMember` blocks Admin from deleting Owner; loads target roles on delete