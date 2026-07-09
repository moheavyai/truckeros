# TruckerOS: Accounts, Roles, and User Flows

**Status:** Architecture plan (research-backed; no large refactors in this doc)  
**Date:** 2026-07-09  
**Rev:** Fix Round 3 (review 79afc894)  
**Scope:** Auth, org membership, profile/roster dual stores, roles, Service Mode, invites, onboarding, platform admin  

---

## 1. Current model (as-built)

### 1.1 Auth

| Layer | Implementation | Evidence |
|--------|----------------|----------|
| Identity | Supabase Auth (`auth.users`) | `lib/supabase/client.ts`, `lib/supabase/server.ts`, login session in `app/login/page.tsx` |
| Session client | Browser Supabase client | `createClient()` from `@/lib/supabase/client` |
| API auth | Most team/profile APIs: `Authorization: Bearer` + user JWT via `createAuthedSupabaseClient`. Admin migrate: session cookie + `requireAdminUser`. Invite accepts may use service-role admin fallback when RPCs missing. | `lib/team-member-profiles-api.ts`, `lib/admin-auth.ts`, invite accept services |
| Post-login redirect | Safe relative paths only; default `/dashboard` | `lib/auth-redirect.ts` (`DEFAULT_POST_LOGIN_PATH`) |
| Onboarding override | Incomplete owner bootstrap → `/profile` | `lib/onboarding.ts` + `app/login/page.tsx` |
| Fail-closed nav trap | AppHeader treats nav load errors as incomplete onboarding (hides Dashboard) | `components/AppHeader.tsx` catch → `setIncompleteOnboarding(true)` |

There is no separate app user table. Auth user id is the join key everywhere (`member_profiles.user_id`, `organization_memberships.user_id`, roster `linked_user_id`).

### 1.2 Core tables and how they relate

```
auth.users
    │
    ├─1:1─ member_profiles          (home carrier + personal fields; one row per user)
    │         organization_id ──► organizations
    │         is_primary_owner, user_roles[]
    │
    ├─N:M─ organization_memberships  (per-org role; multi-org support)
    │         organization_id, role (scalar), is_primary_owner, permissions jsonb
    │
    └─ via org ─ team_member_profiles (roster: may exist before invite accept)
                   linked_user_id, user_roles[], permissions jsonb
```

| Table | Purpose | Key constraints / notes | Migrations |
|-------|---------|-------------------------|------------|
| `organizations` | Carrier company shell | UUID PK (often client-generated on bootstrap); `created_by_user_id` | `021_multi_carrier_foundation.sql` |
| `organization_memberships` | **Authoritative per-org access + role** | Unique `(organization_id, user_id)`; one primary owner per org; scalar `role` | `021`, role split `026`, CHECKs `036` |
| `member_profiles` | **Home profile** (carrier + driver fields) | `user_id` UNIQUE → **one home org per user**; `user_roles text[]`; `is_primary_owner` | `018`, org cols `019`, Owner Operator `030` |
| `team_member_profiles` | Org roster (pre-invite people, unlinked drivers) | `linked_user_id` optional; same field shape as member profile | `019`, permissions `031` |
| `team_invites` | Invite teammate into an **existing** org | Assignable: Admin/Driver/Permit Clerk/Viewer. **Owner blocked in app** (`validateInviteRole`) **and accept RPC** (`029` raises if role = Owner) | `027`, table repair `033`, accept RPCs `028`/`029`/`034` |
| `carrier_connection_invites` | Service operator **adds a carrier** (shell org + Owner invite) | Required `invite_email`; shell org + inviter as Permit Clerk | `035` |
| `carrier_link_requests` | Request access to existing carrier by USDOT/email | Approve/reject workflow | `021` |
| `deletion_requests` | Permit Clerk deletions needing approval | Resource types include team/roster | `027` |
| `profile_change_requests` | Driver restricted-field changes need manager approval | Identity fields (name/CDL/DOB) | `022`, `023` |

**Dual profile stores (intentional, but easy to confuse):**

1. **`member_profiles`** — logged-in user’s home row (PII + home org carrier fields). Used for bootstrap, “own profile”, and primary-owner carrier edits.
2. **`team_member_profiles`** — org-scoped roster. Can exist without an auth user; linked on invite accept by email / `linked_user_id`.
3. **`organization_memberships`** — grants actual multi-org access. Invite accept always writes membership; home profile rewrite is optional when multi-org.

Sources: `types/member-profile.ts`, `types/organization.ts`, `lib/roster-profile-link.ts`, `lib/team-invite-accept.ts`, `lib/member-profile.ts` (`resolveActorProfile`, `needsPrimaryOwnerBootstrap`).

### 1.3 Roles

Canonical role set (app + DB after migrations 026/030/036):

| Role | How assigned | Notes |
|------|--------------|--------|
| **Owner** | Bootstrap primary owner only; not invite-assignable | `ASSIGNABLE_TEAM_ROLES` / `INVITE_ALLOWED_ROLES` exclude Owner |
| **Admin** | Team invite or roster edit | Near-full management (`ROLE_DEFAULT_PERMISSIONS`) |
| **Driver** | Invite / roster | Self-service contact fields; restricted identity fields |
| **Permit Clerk** | Invite / roster; also inviter role on connection shells | Equipment + profiles write; no account_settings |
| **Viewer** | Invite / roster | Read-only defaults |

**Owner Operator** is **not** a separate role string. It is `user_roles = ['Owner','Driver']` on `member_profiles` (and bootstrap toggle). Membership.role for a primary owner is still scalar `'Owner'` (`primaryRoleFromUserRoles` maps multi-select → single membership role).

Legacy: `'Owner / Admin'` normalized at read time to Owner (primary) or Admin (`LEGACY_OWNER_ADMIN_ROLE` in `types/member-profile.ts`, `lib/team-permissions.ts`).

**Primary owner vs membership role:**

| Concept | Storage | Meaning |
|---------|---------|---------|
| `is_primary_owner` | Both `member_profiles` and `organization_memberships` | Billing/home identity of the org; unique per org |
| Membership `role` | `organization_memberships.role` | Single role for that org |
| Profile `user_roles` | `member_profiles.user_roles` / roster `user_roles` | Multi-select (Owner only + optional Driver) |

Primary owner is treated as Owner for permissions even if roles array is empty (`hasOwnerRole`, `resolveEffectivePermissions` unshift Owner).

**Primary-owner-only edges (Admin cannot):** unique primary owner flag; demote/replace primary owner; some carrier bootstrap / `is_primary_owner` immutability on self-update (privileged column triggers in `020`/`034`).

**What Admin/org-manager RLS actually covers (`028`):** memberships write, team roster write, other members’ `member_profiles` update/delete in **home** org — **not** `equipment_profiles` / `rig_configurations`.

**As-built multi-org SELECT after migration `025` (critical for Phase 1b):**

| Resource | Own / home | Multi-org membership path? | Service-mode helper path |
|----------|------------|----------------------------|---------------------------|
| `member_profiles` | Own row + `organization_id = auth_user_organization_id()` (home) | **No** — `025` dropped `auth_user_membership_org_ids()` branch | `organization_id IN (auth_user_service_mode_org_ids())` |
| `team_member_profiles` | Home org only via `auth_user_organization_id()` | **No** — same | OR SM helper |
| `equipment_profiles` | User owns via `user_id` (`009`) | **No** org membership path | Org SELECT **only** SM helper |
| `rig_configurations` | User owns via `user_id` | **No** | Primary-owner rigs via SM helper |

So multi-org Owner/Admin (non-home) roster/profile reads today depend on SM helper roles (Owner/Admin/Clerk), not a pure membership path. Phase 1b **must restore** membership-based SELECT for all four, then narrow the SM helper — see §5.5.

### 1.4 Permissions model

- Defaults: `ROLE_DEFAULT_PERMISSIONS` in `lib/team-permissions.ts` (areas: equipment, profiles, account_settings, permit_agent, portal_agent, file_upload).
- Overrides: `permissions` jsonb `{ mode: 'global' | 'custom', custom: { equipment, profiles, account_settings } }` on membership and roster.
- Nav: `resolveNavActor` (`lib/nav-actor.ts`) merges home profile + memberships; **in Service Mode prefers membership of active org**.
- UI gates: `lib/member-profile-permissions.ts`, driver field rules in `lib/profile-field-permissions.ts`.

### 1.5 Carrier Mode vs Service Mode

| | Carrier Mode | Service Mode |
|---|--------------|--------------|
| Storage | `localStorage` `truckeros_workspace_mode` | same key = `'service'` |
| Effective org | `ownOrganizationId` (home `member_profiles.organization_id`) | `activeOrganizationId` from accessible carriers |
| Eligibility | default | At least one eligible carrier |
| Eligible roles (client) | n/a | `Permit Clerk`, `Owner`, `Admin` **or** `access_source` primary_owner/created |
| Eligible roles (RLS) | n/a | `auth_user_service_mode_org_ids()` → same three roles (`036`) |
| UI | CarrierContextBar toggle | Carrier selector + `/carriers` nav |

Key files:

- `lib/organization-context.ts` — multi-instance-safe mode/org state, `fetchAccessibleCarriers`, auto-select policy
- `lib/service-mode-scope.ts` — eligibility, equipment/permit org scoping
- `components/CarrierContextBar.tsx`, `components/CarrierSelector.tsx`
- `components/AppHeader.tsx` — shows Carriers only when `workspaceMode === 'service'`

**Important product reality:** Service Mode is **not** limited to Permit Clerks. Any Owner/Admin membership (or primary_owner/created carrier) enables the toggle (`SERVICE_MODE_ELIGIBLE_ROLES` + `isServiceModeEligibleCarrier` short-circuit).

**UI hide ≠ data access:** Client eligibility only controls chrome (toggle, selector, `/carriers` nav). Cross-org **reads** are also gated by Postgres RLS via `auth_user_service_mode_org_ids()`. Until RLS is narrowed, Owner/Admin can still query other membership orgs via API/client even if the Service Mode toggle is hidden.

### 1.6 Invites (two paths)

| Path | Route | Creates | Acceptor gets | Inviter gets |
|------|-------|---------|---------------|--------------|
| **Team invite** | `/invite/[token]` | Membership (+ home profile if no other home org); links roster by email | Invite role (Admin/Driver/Permit Clerk/Viewer) | Unchanged |
| **Carrier connection invite** | `/carrier-invite/[token]` | Shell org on create; Owner membership on accept | Primary Owner (+ home rewrite if needed) | Permit Clerk membership on shell at create |

Team invites: Owner/Admin only create (`auth_user` manager checks in `027`/`033`). Accept preserves multi-org home (`034`, `shouldRewriteHomeProfileOnInviteAccept`).

**As-built accept landing (team invite):** After success, always `router.push('/profile?invite=accepted')` (`app/invite/[token]/page.tsx`). If `multi_org_join && serviceEligible(role) && organizationId`, also forces Service Mode + active org before navigate. First-time home join stays Carrier Mode.

**As-built accept landing (carrier connection):** Forces Carrier Mode + active org; `router.push('/profile?carrier_connection=accepted')` (`app/carrier-invite/[token]/page.tsx`).

Carrier connection: Permit Clerk **or** Owner/Admin may create (`canCreateCarrierConnectionInvite` — also short-circuits on `is_primary_owner`). Create always attaches inviter as **Permit Clerk** on the shell org (`carrier-connection-invite-service.ts`).

Also: **carrier link requests** (`carrier_link_requests`) for linking to an **existing** USDOT/email without owning the shell create path. **On approve**, as-built is **binary** approve/reject (no role picker) and always inserts membership with **`role: 'Permit Clerk'`** for the requester (`lib/carrier-link-requests.ts`) — a Phase 1 Service Mode regain path. **Phase 1 minimum:** change that hard-coded role to **`Viewer` only** (no manager role picker in Phase 1; picker is later if ever). **Phone-only team invites** are allowed at create (`invite_email` OR `invite_phone`); connection invites require email.

### 1.7 Onboarding / bootstrap paths

| Path | Trigger | Outcome |
|------|---------|---------|
| **Primary owner bootstrap** | New signup, no membership/roster/home org | Profile “Welcome” card → one save creates `organizations` + `member_profiles` (primary owner) + membership Owner (`ensureOrganizationBootstrap` in `team-member-profiles-api.ts`) |
| **Owner Operator toggle** | Bootstrap form | `user_roles` Owner only vs Owner+Driver (`applyOwnerOperatorRoles`) |
| **Team member join** | Accept team invite (or pre-linked roster) | Skips owner bootstrap (`needsPrimaryOwnerBootstrap` false if membership/roster exists) |
| **Carrier Owner via connection invite** | Accept carrier-invite | Primary Owner on shell org; carrier fields from invite |
| **Forced carrier owner** | Hardcoded email `andrehampton1@outlook.com` | Always bootstrap/owner treatment (`lib/forced-carrier-owner.ts`) — dev/product escape hatch |
| **Guided steps** | After org exists, owner/admin | Soft “team or equipment” CTAs (`resolveOnboardingStep`); dismissible via localStorage |

Incomplete onboarding blocks Dashboard/Equipment nav (`AppHeader` + login landing).

**Clerk cold-start (as-built gap):** There is no first-class “sign up as Permit Clerk / service bureau” bootstrap. Pure fleet bootstrap always creates **Owner**. Today a clerk arrives by (a) team invite as Permit Clerk into an existing org, or (b) first becoming an Owner (or primary owner) and then using connection invites — which overloads fleet Owner with service product. Target cold-start is defined in §2.3 / §5.6.

### 1.8 Platform / master admin

| Mechanism | Scope | Evidence |
|-----------|--------|----------|
| `ADMIN_EMAILS` env + `app_metadata.role === 'admin'` | `/api/admin/migrate`, admin DB page | `lib/admin-auth.ts`, `app/admin/db/page.tsx` |
| Onboarding persona `master` | Welcome copy only (client); prefers forced-owner email if `isPlatformAdmin` not set | `lib/onboarding.ts` `resolveOnboardingPersona` |
| Service role (`SUPABASE_SERVICE_ROLE_KEY`) | Invite accept fallbacks, carrier connection writes | `lib/supabase.ts` admin client |

Platform admin is **ops/migrations**, not an org role. It is not a membership role and does not replace Owner.

### 1.9 Adjacent workflows (as-built, journey-adjacent)

| Workflow | Who | Behavior | Plan phase |
|----------|-----|----------|------------|
| **Carrier link request** | Requester → org manager approves | Approve mints **Permit Clerk** membership (as-built) | Phase 1 gate/risk; Phase 3 seat separate; UX Phase 4 |
| **Profile change request** | Driver self-service restricted fields | Name/CDL/DOB → approval (`profile_change_requests`) | Keep as-built; Phase 4 copy only if needed |
| **Deletion request** | Permit Clerk → Owner/Admin approve | `deletion_requests` for carrier/equipment/driver/team/roster | Keep as-built; gates stay role-based |
| **Phone-only team invite** | Owner/Admin create | Allowed; SMS stubbed unless `TWILIO_ENABLED` | Open question; no Phase 1 change |
| **Roster dual-list** | Profile team section | Merges `member_profiles` + `team_member_profiles` | Phase 2 clarity; Phase 4 UX polish |
| **Fail-closed onboarding** | Any user with profile load error | Dashboard hidden until reload succeeds | Phase 1 monitor; Phase 4 soft-retry / distinguish error vs incomplete |

---

## 2. Natural user journeys

Journeys mix **as-built** (what code does today) and **target** (product intent after rollout). Aspirational items are labeled.

### 2.1 Owner (carrier owner / bootstrap)

| Stage | Journey | Primary screens |
|-------|---------|-----------------|
| Signup/login | Email/password → if no org/membership → Welcome | `/login` → `/profile` |
| Onboarding | Complete setup: company + contact; optional Owner Operator | Profile bootstrap card → Complete Setup |
| Daily work | **Carrier Mode only** on home org (after Phase 1: no Service Mode for pure fleet Owner) | `/dashboard`, `/permit-test`, `/equipment`, `/history`, `/profile` |
| Team/invite | Invite Admin/Driver/Permit Clerk/Viewer by email/phone | Profile team section → invitee `/invite/[token]` |
| Multi-org | Accept another org’s team invite → membership-only join; home org preserved | As-built: may force Service Mode if role service-eligible (§1.6); **target Phase 4:** no Service Mode for Owner; optional Carrier Mode org switcher later |
| Key screens | Profile (carrier + team), Dashboard, Equipment | AppHeader: Dashboard, Equipment, Profile (no Carriers) |

**Owner Operator:** Same as Owner, plus Driver self fields and driver-capable daily work without a separate account. CDL can be completed later via roster/self edit. See §4.1 for acting-role exception.

### 2.2 Driver

| Stage | Journey | Primary screens |
|-------|---------|-----------------|
| Signup/login | Invite email → signup/login with **same email** → accept | `/invite/[token]` → `/login?redirect=/invite/...` |
| **Post-accept (as-built)** | Always → `/profile?invite=accepted` (not Dashboard) | Profile toast + quiet role welcome |
| **Post-accept (target Phase 4 optional)** | May deep-link to Dashboard for drivers after complete profile | Same accept path; only landing default changes |
| Onboarding | No owner bootstrap; one-time role welcome optional | Profile |
| Daily work | Run route/permit analysis; contact self-service; restricted fields via change requests | `/dashboard`, `/permit-test`, Profile contacts |
| Team/invite | Does not invite | — |
| Multi-org | Membership-only if invited elsewhere | Prefer membership role when scoped |
| Key screens | Dashboard, Profile (self), History | Equipment nav only if permissions allow (default Driver: equipment none) |

### 2.3 Permit Clerk

| Stage | Journey | Primary screens |
|-------|---------|-----------------|
| **Cold-start (target — not fleet Owner bootstrap)** | See §5.6: (a) invited as Permit Clerk into a **service bureau / host** org, or (b) platform-provisioned service seat + first shell, or (c) temporary platform allowlist during transition. **Do not** treat primary-owner bootstrap as the clerk product path. | Invite or ops provisioning |
| Signup/login (as-built common) | Team invite as Permit Clerk into a carrier | `/invite/[token]` → `/profile?invite=accepted` |
| Onboarding | Role welcome; may complete personal profile | `/profile` |
| Daily work | **Target (aspirational):** prefer Service Mode when user has ≥1 service seat; select carrier; run permits/equipment as that org. **As-built:** mode defaults to Carrier Mode from localStorage; user toggles Service Mode manually. | `/carriers`, Service Mode bar, `/permit-test`, `/equipment` |
| Team/invite | Create **carrier connection invites** for new carriers (after entitlement). Optional team invites only if also Owner/Admin of an org. | `/carriers` |
| Multi-org | Many Permit Clerk memberships with `service_seat`; active org drives nav/data | Carrier selector |
| Key screens | Carriers, Dashboard, Equipment, Profile | AppHeader includes Carriers when in Service Mode |

### 2.4 Admin (org admin)

| Stage | Journey | Primary screens |
|-------|---------|-----------------|
| Signup/login | Team invite as Admin | `/invite/[token]` |
| **Post-accept (as-built)** | `/profile?invite=accepted`; multi-org + service-eligible may force Service Mode | Profile |
| Onboarding | Role welcome; skip company bootstrap | Profile / later Dashboard |
| Daily work | Manage team (roster/memberships via org-manager RLS `028`), most carrier profile fields, permits; equipment primarily via **user_id-owned** rows + UI permissions (not `028` equipment RLS); **not** primary-owner uniqueness / demote primary | Profile team, Equipment, Dashboard |
| Team/invite | Create team invites; manage roster | Profile |
| Multi-org (as-built) | Service Mode if Admin membership on other orgs | Will lose Service Mode after Phase 1 unless service seat |
| Multi-org (target) | Stay in Carrier Mode on home; optional future org switcher (Phase 4) if needed | No clerk product chrome |
| Key screens | Profile (team), Equipment, Dashboard | Same management as Owner except primary-owner-only edges |

### 2.5 Platform / master admin

| Stage | Journey | Primary screens |
|-------|---------|-----------------|
| Login | Same Supabase auth; email on `ADMIN_EMAILS` or `app_metadata.role` | `/login` |
| Daily work | Run schema migrations / state rules tooling; **provision service seats** (Phase 3+) | `/admin/db` (+ future seat tooling) |
| Not | Customer org product roles as substitute for Owner; customer self-grant of Service Mode | — |

---

## 3. Mapping / dependency issues (current)

Prioritized by user impact / engineering drag.

### P0 — Dual sources of “who am I?”

| Issue | Detail | Evidence |
|-------|--------|----------|
| Profile roles vs membership role | `member_profiles.user_roles[]` vs `organization_memberships.role` can diverge after multi-org joins or partial updates | `resolveNavActor` prefers membership only when profile empty or service mode |
| Home profile single-org | One `member_profiles` row per user; multi-org is membership-only — UI often still reads home roles | `018` UNIQUE user_id; `034` preserve home |
| Roster vs member_profiles | Team list merges both sources; permissions/edits differ by source | Profile page dual select; `TeamMemberListSource` |
| Actor resolution fallbacks | `resolveActorProfile` can synthesize from roster or membership | `lib/member-profile.ts` |
| Owner Operator collapse | Membership scalar `Owner` drops Driver half of Owner Operator if acting role is membership-only | `primaryRoleFromUserRoles`; `isOwnerOperatorSelected` |

**Impact:** Wrong nav permissions, wrong welcome persona, confusing role badges; Owner Operator capability loss if SSoT is naive.

### P0 — Service Mode too broad for product intent

| Issue | Detail | Evidence |
|-------|--------|----------|
| Owner/Admin in role list | `SERVICE_MODE_ELIGIBLE_ROLES` includes Owner + Admin | `lib/service-mode-scope.ts` |
| **primary_owner / created bypass** | `isServiceModeEligibleCarrier` returns true for `access_source` primary_owner or created **without** checking role | same file |
| Connection invite creators | Owner/Admin/`is_primary_owner` short-circuits | `canCreateCarrierConnectionInvite` |
| Connection invite grants Clerk role | Inviter gets Permit Clerk on shell → role-only Service Mode after create | `carrier-connection-invite-service.ts` |
| **Link-request approve mints Clerk** | Approve always inserts `role: 'Permit Clerk'` for requester | `lib/carrier-link-requests.ts` |
| **RLS still open** | `auth_user_service_mode_org_ids` includes Owner + Admin even if UI is hidden | migration `036` |
| **Equipment org SELECT coupled to SM helper** | `025` equipment/rig org policies use **only** service-mode helper | migration `025` |
| **Self-invite / reassign PE (role-only)** | Team-invite own email as Clerk; or manager UPDATE own membership → Clerk | team invites + `028` manager membership policies |

**Impact:** Carrier owners see multi-carrier UX; residual data access if only UI is gated; role-only gates are bypassable via invite/link approve; naive helper-only Phase 1b breaks equipment.

### P1 — Multi-instance org context complexity

| Issue | Detail | Evidence |
|-------|--------|----------|
| Multiple `useOrganizationContext` mounts | Careful no-op storage + pure decision helpers to avoid loops | `decideServiceModeActiveOrganizationUpdate`, CustomEvents |
| localStorage only | Mode/active org not server-side; refresh races | `WORKSPACE_MODE_STORAGE_KEY` |
| Nav actor reloads on mode/org change | Extra queries; fail-closed hides Dashboard | `AppHeader` effect deps |

### P1 — Invite path asymmetry & ownership

| Issue | Detail | Evidence |
|-------|--------|----------|
| Team vs carrier-connection | Different tokens, tables, accept semantics, Owner rules | `/invite` vs `/carrier-invite` |
| Shell org lifecycle | Pre-created orgs, orphan cleanup, USDOT uniqueness | `cleanupShellOrgIfOrphaned`, migration 035 |
| Email binding | Connection invites require invite email; team can be phone-only | Types + validators |
| Forced owner email | Hardcoded production-adjacent escape hatch | `forced-carrier-owner.ts` |

### P1 — Onboarding gates vs team members

| Issue | Detail | Evidence |
|-------|--------|----------|
| Fail-closed to profile | Unknown profile load → onboarding, not dashboard | Login + AppHeader |
| Team members without profile row | Rely on roster/membership to skip bootstrap | `needsPrimaryOwnerBootstrap` |
| Guided dismiss local only | Not durable across devices | `onboardingDismissStorageKey` |
| Invite landing always Profile | Journeys that say “→ Dashboard” disagree with code | `app/invite/[token]/page.tsx` |

### P2 — RLS vs client UX

| Issue | Detail | Evidence |
|-------|--------|----------|
| Service mode RLS by role | Broader than UI intent until Phase 1b/3 | `025`/`036` |
| Client permission maps can over-promise | UI uses profile/membership merge; RLS is membership-based | Equipment/permit scopes |
| Admin service role bypass | Invite accept fallbacks depend on service key | `hasAdminAccess` |

### P2 — Role combination rules inconsistent across layers

| Issue | Detail | Evidence |
|-------|--------|----------|
| Owner only + Driver on profile | DB function `member_profile_user_roles_valid` | Migration 030 / 036 |
| Membership is single role | Owner Operator loses Driver on membership.role | `primaryRoleFromUserRoles` |
| Permission merge of multi-roles | Client merges role defaults by max access | `mergeRoleDefaults` |

---

## 4. Simplest clean fixes

Prefer minimal, layered changes—no rewrite of multi-org tables.

### 4.1 Single source of truth for “acting role”

**Convention (freeze in Phase 0):**

| Context | Source of truth |
|---------|-----------------|
| Access to org data | `organization_memberships` row for that org |
| Acting role in UI (nav, tools, gates) | Membership role for **effective org** (home in carrier mode; active org in service mode) |
| **Owner Operator exception** | See below — home profile `user_roles` merged for **field/capability** permissions only |
| Home profile fields | `member_profiles` for personal + home carrier identity |
| Pre-user roster | `team_member_profiles` until linked |
| Primary ownership | `organization_memberships.is_primary_owner` (mirror on home profile for convenience) |

**Owner Operator exception (required):**

Naive “membership role only” drops Driver when membership.role is scalar `Owner`.

| Case | Acting role for **authz label / nav tier** | Permissions merge |
|------|---------------------------------------------|-------------------|
| Carrier Mode, effective org = home org, primary owner, home `user_roles` includes Owner+Driver | Display Owner (or “Owner Operator”) | `resolveEffectivePermissions` merges **membership role + home `user_roles`** so Driver defaults apply (permit_agent, self fields) |
| Carrier Mode, non-primary home member | Membership role only | No home multi-select override |
| Service Mode, active org ≠ home | Membership role for **active** org only | Never merge home Owner Operator into foreign org |
| Service Mode, active org = home (edge) | Same as carrier home row | Same Owner Operator merge |

Implementation sketch: `resolveActingActor` returns `{ membershipRole, user_roles: effectiveRoles[], is_primary_owner }` where `effectiveRoles` = `[membershipRole]` normally, else `validateUserRoles(home.user_roles)` when Owner Operator exception applies.

**Minimal code fix:**

1. `resolveActingActor(userId, effectiveOrgId, workspaceMode)` always loads membership for effective org.
2. Apply Owner Operator exception only for home org + primary owner path above.
3. Profile landing badges: show membership role + “Operator” badge when exception applies.
4. Keep roster `user_roles[]` for multi-label display; map to scalar membership for membership upserts.

### 4.2 Separate org role vs product tier / capability

| Dimension | What it is | Today | Target |
|-----------|------------|-------|--------|
| **Org role** | What you can do **inside** a carrier org | Membership `role` | Unchanged enum |
| **Service seat** | Whether this membership may be used for Service Mode scope on that org | Overloaded onto Owner/Admin/Clerk + primary_owner bypass | Explicit `service_seat` (see §5) |

Do **not** invent a second permission matrix; reuse `ROLE_DEFAULT_PERMISSIONS` for org role.

### 4.3 Other high-ROI simplifications

| Problem | Simple fix |
|---------|------------|
| Forced owner email | Phase 2: env `NEXT_PUBLIC_FORCED_CARRIER_OWNER_EMAILS` (client+server) / `FORCED_CARRIER_OWNER_EMAILS` (server); Phase 3+: fold into platform provisioning only (see §7 non-goals / controls) |
| Carrier connection creators | Gate on service seat + Permit Clerk on **some** org (or host), never bare Owner/primary |
| Multi-instance context | Phase 4: single React context provider at layout; Phase 1: keep current helpers |
| Dual invite mental model | Docs + UI labels: “Invite teammate” vs “Add carrier (Owner invite)” — keep two tables |
| Dual roster list | Phase 2: document edit rules per source; Phase 4: UX unify list presentation without schema merge |

---

## 5. Isolate Service Mode to Permit Clerks (service seat)

### 5.1 Goal

Service Mode (cross-carrier workspace, `/carriers`, connection invites as a product) should be the **Permit Clerk / service operator** experience—not every Owner/Admin on their own fleet.

- **Org role** Permit Clerk = in-org permissions.
- **Service seat** = this membership is allowed as a Service Mode scope target (and contributes to “can enter Service Mode”).

### 5.2 Recommended durable model (single path)

**Canonical choice: membership `service_seat` + Permit Clerk role on the target org.**

```sql
-- Phase 3 migration (illustrative)
ALTER TABLE organization_memberships
  ADD COLUMN IF NOT EXISTS service_seat boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN organization_memberships.service_seat IS
  'When true with role Permit Clerk, this membership may be scoped in Service Mode. Writable only by platform/service-role paths.';
```

**Eligibility rules (client + RLS must match):**

```
canEnterServiceMode ⇔ EXISTS membership where service_seat = true AND role = 'Permit Clerk'
service-mode scope on org O ⇔ membership on O with service_seat = true AND role = 'Permit Clerk'
```

| Rule | Detail |
|------|--------|
| Target org | Seat is **per membership / target org**, not a global free pass |
| Role | Seat alone is insufficient; **role must be Permit Clerk** (prevents Owner with sticky seat) |
| Global entitlement | **Not used** as sole gate (avoids “one clerk seat ⇒ all orgs”) |
| Connection invite create | Inviter must already have ≥1 service_seat Clerk membership **or** be platform-provisioned; create path (service-role) sets inviter membership on shell: `role = 'Permit Clerk'`, `service_seat = true` |
| Team invite as Permit Clerk | Creates membership **without** `service_seat` by default (in-org clerk helper only). Seat granted only by platform/service-role (e.g. bureau onboarding) or sticky backfill rules |

**Write path (security-critical) — INSERT and UPDATE:**

| Actor | May set `service_seat = true`? | Notes |
|-------|--------------------------------|--------|
| Column default | `false` | `NOT NULL DEFAULT false` |
| Client JWT / org manager INSERT membership | **No** — force false | Manager insert policy exists (`028`); trigger must clamp |
| Client JWT / org manager UPDATE membership | **No** — cannot flip true | Same |
| Team invite / accept RPC / client accept | **No** — always false | Accept must not honor client seat |
| Link-request approve | **No** — seat false even if role Clerk | Phase 3 |
| Platform admin API / service-role | **Yes** — provision, revoke, backfill | Only path for seating additional clerks on existing orgs |
| Connection-invite **create** (service-role server path) | **Yes** — inviter shell membership only | Inviter already seat-checked |
| Owner acceptor on connection invite | **No** — false | — |

**Protect with (INSERT + UPDATE, not UPDATE-only):**

1. `BEFORE INSERT OR UPDATE` trigger on `organization_memberships`:
   - If `NEW.service_seat IS TRUE` and session is not service_role (or platform GUC), **force `NEW.service_seat := false`** or RAISE (prefer force-false for safer manager inserts).
   - If `NEW.role` is not `'Permit Clerk'` and `NEW.service_seat IS TRUE`, **clear seat** (`service_seat := false`) — demotion policy (see below).
2. App: strip `service_seat` from every client membership payload (create/update/accept/link approve).
3. Never rely on RLS alone: managers can INSERT/UPDATE memberships under `028`.

**Demotion / sticky seat policy (prefer clear):**

| Event | Required behavior |
|-------|-------------------|
| Role changes away from `Permit Clerk` | Trigger sets `service_seat = false` (same INSERT/UPDATE trigger) |
| Platform revokes seat only | Service-role UPDATE `service_seat = false`, role may stay Clerk (in-org helper without SM) |
| Sticky historical seats | One-time Phase 3 backfill only; still cleared on demotion from Clerk |

**Alternatives (appendix only — not recommended path):** global `user_product_entitlements.service_mode`, org-level `org_kind = service_bureau`, role-only forever. See Appendix C.

### 5.2.1 Ops seating runbook (Phase 3+)

There is **no** product UI for bureau Owners to grant seats on existing client orgs. Additional clerks:

1. Org manager (or team invite) adds user as **Permit Clerk** with `service_seat = false` (in-org helper).
2. Platform/ops attaches seat via service-role API: set `service_seat = true` where `role = 'Permit Clerk'` on the **target** org.
3. Connection-invite create (service-role) remains the only automated seat mint for **new shell** inviter memberships.

Cold-start path (a) is invite role only + step 2 — not bureau Owner setting the flag.

### 5.3 Phase 1 transitional eligibility (no schema)

Until `service_seat` exists:

```
eligible carrier ⇔ membership_role = 'Permit Clerk'
                  AND NOT (primary_owner/created short-circuit)
```

- Remove Owner, Admin from `SERVICE_MODE_ELIGIBLE_ROLES`.
- Remove primary_owner/created auto-eligibility in `isServiceModeEligibleCarrier`.
- Connection invite create: Permit Clerk membership only (no Owner/Admin/primary short-circuit).
- Optional **platform allowlist** (env emails/ids) for masters — documented as temporary PE surface (§7).

**Transitional residual risks (must document):**

| Risk | Mitigation |
|------|------------|
| Owner/Admin still pass RLS cross-org until Phase 1b/3 | Phase 1b: **policy split** + narrow helper (not helper-only) |
| Owner/Admin **team-invite own email** as Permit Clerk → SM UI | Block create when invite email normalizes to inviter’s email **and** role is Permit Clerk |
| Manager **reassigns own membership** role → Permit Clerk (no invite) | Block self role-change to Clerk on membership UPDATE API / server; Phase 3 seat still false until ops |
| Manager invites **another** user as Clerk | Allowed for in-org help; they gain SM on that org under Phase 1 role-only — accept until Phase 3 seats; audit Clerk grants |
| **Link-request approve** mints Permit Clerk for requester | **Phase 1 only:** change hard-coded approve role from Permit Clerk → **Viewer** (approve remains binary; no role picker). Service access via seats/connection invites later — not approve→Clerk. |
| Connection invite still grants Clerk role | Restrict **who can create** in Phase 1; seat in Phase 3 |
| Naive Phase 1b breaks Owner equipment org SELECT | **Must** policy-split equipment/rigs (migration `025` entanglement) |

**Self-invite PE specifics (Phase 1 done-when items):**

1. Cannot create team invite where `normalizeInviteEmail(invite_email) === normalizeInviteEmail(inviter.email)` and role is `Permit Clerk`.
2. **Phone-only invites:** if `invite_email` is null and `invite_phone` is set, block when phone normalizes to inviter’s known phone (profile `driver_phone` / `carrier_phone` or auth phone if present) and role is `Permit Clerk`. Same spirit as email self-match; if inviter phone unknown, allow create but audit.
3. Cannot reassign **own** `organization_memberships.role` to `Permit Clerk` via manager update or profile save sync without platform/service-role.
4. Link-request approve hard-codes **Viewer** (not Permit Clerk); still binary approve/reject.

### 5.4 Migration path for current Owner/Admin who get Service Mode today

| Current situation | Transition |
|-------------------|------------|
| Owner only on own org | No Service Mode UI; Carrier Mode only. Own equipment/rigs via **user_id** policies; after Phase 1b, org-scoped equipment SELECT via **new home/membership policy**, not service-mode helper alone. |
| Owner who used Service Mode to switch among owned orgs | Lose Service Mode; Phase 4 optional Carrier Mode multi-org switcher if needed |
| Admin multi-org | Lose Service Mode unless later given service_seat as Clerk on those orgs |
| Permit Clerk memberships | Phase 1: keep UI eligibility. Phase 3 backfill: `service_seat = true` only for (a) role Permit Clerk **and** (b) users who created connection invites **or** platform-marked bureaus — **not** every accidental Clerk invite |
| Inviter Permit Clerk on shells | Keep; backfill `service_seat = true` on those memberships |
| Masters / forced owner | Platform allowlist Phase 1; provision seat via service-role Phase 3; do not leave sticky forever without audit |

**Backfill sketch (Phase 3):**

```sql
-- Sticky seat for connection-invite inviters (historical service operators)
UPDATE organization_memberships om
SET service_seat = true
WHERE om.role = 'Permit Clerk'
  AND (
    om.user_id IN (SELECT DISTINCT invited_by_user_id FROM carrier_connection_invites)
    OR /* platform-marked service bureau user ids */
  );

-- Do NOT: SET service_seat for all Owner/Admin
-- Do NOT: SET service_seat for all Permit Clerk team-invitees by default
```

### 5.5 UI / API / RLS gating

| Surface | Today | Target |
|---------|--------|--------|
| `SERVICE_MODE_ELIGIBLE_ROLES` | Owner, Admin, Permit Clerk | Phase 1: Permit Clerk only |
| `isServiceModeEligibleCarrier` | primary_owner/created always true | Phase 1: **no** access_source short-circuit; role (then seat) only |
| `canUseServiceMode` / filter | Above | Seat+Clerk (Phase 3) / Clerk role (Phase 1) |
| `auth_user_service_mode_org_ids()` | Owner, Admin, Permit Clerk | Phase 1b: Permit Clerk only **after** membership paths restored on all four tables; Phase 3: `service_seat AND role = Permit Clerk` |
| Equipment/rig/profile/roster org SELECT | `025`: multi-org via SM helper (profiles/roster: home **or** SM only — **no** pure membership multi-org branch) | Phase 1b: restore membership paths **then** narrow SM — see below |
| `canCreateCarrierConnectionInvite` | Owner, Admin, primary, Permit Clerk | Phase 1: Permit Clerk only; Phase 3: has service_seat Clerk membership |
| CarrierContextBar tooltip | Owner/Admin wording | Service Mode (service seat / Permit Clerk) |
| Permit request API | Role set includes Owner/Admin | Align with scope helper |
| Team invite accept multi-org force Service Mode | Uses `SERVICE_MODE_ELIGIBLE_ROLES` | Follow same eligibility helper after Phase 1 |
| Link-request approve membership role | Hard-coded Permit Clerk (binary approve) | Phase 1: hard-code **Viewer** only (no role picker) |

**UI hide vs data access:** Phase 1 client gates hide chrome only. **Phase 1b** (same release train) must restore membership SELECT paths **then** narrow SM helper.

#### Phase 1b: restore membership paths + policy split (migration `025` — mandatory)

**As-built after `025_service_mode_role_scoped_rls.sql` (and `036` role rename):**

| Table / policy | SELECT uses today |
|----------------|-------------------|
| `member_profiles` | own row **OR** home (`auth_user_organization_id()`) **OR** SM helper — **no** `auth_user_membership_org_ids()` multi-org branch |
| `team_member_profiles` | home **OR** SM helper — **no** pure membership multi-org branch |
| `equipment_profiles` org view | **only** SM helper |
| `rig_configurations` carrier view | primary owners whose org ∈ SM helper |

**False claims to avoid:**

1. “Own-org equipment remains via non-service-mode policies” for **org-scoped** equipment — false (only user_id self-manage + SM helper).
2. “Profile/roster already have membership multi-org paths” — **false after 025**; only home + SM. Narrowing SM without restoring membership breaks multi-org Owner/Admin non-home roster/profiles.

**Order of operations (required):**

1. **Restore** membership-based SELECT (and keep existing write rules; extend writes only if product needs multi-org manager writes later — out of Phase 1b unless already broken).
2. **Then** narrow `auth_user_service_mode_org_ids()` to Permit Clerk (Phase 1b) / seat∧Clerk (Phase 3).

**Required Phase 1b design:**

| Layer | Change |
|-------|--------|
| **Helper: membership org ids** | Reintroduce or use `auth_user_membership_org_ids()` (or equivalent) for “orgs I belong to.” Optionally **role-filtered** variant for equipment (below). |
| **(a) Equipment — membership path** | SELECT `equipment_profiles` where `organization_id` ∈ membership orgs **and** membership `role IN ('Owner','Admin','Permit Clerk')` — **not** all memberships. Do **not** open org equipment to Driver/Viewer via RLS (matches historical SM helper role set intent; avoids expanding beyond as-built Owner/Admin/Clerk). Independent of SM helper. Writes remain user-owned / existing write policies. |
| **(b) Rigs — membership path** | Org-scoped primary-owner rig reads for members with role Owner/Admin/Permit Clerk on that org (same role constraint as equipment). User_id self policies unchanged. |
| **(c) member_profiles — membership path** | Restore multi-org: SELECT where `organization_id IN (auth_user_membership_org_ids())` (any membership is OK for profile visibility within orgs you belong to — or same Owner/Admin/Clerk constraint if product wants tighter; **default Phase 1b: any membership** for profiles/roster so multi-org Admins can see team, matching pre-025 intent). Keep own row + home. SM helper remains an extra OR for seated clerks only after narrow. |
| **(d) team_member_profiles — membership path** | Same restore: `organization_id IN (membership org ids)` for orgs you belong to, not only home. Then OR SM helper (narrowed). |
| **(e) Service-mode helper** | **After** (a)–(d): `auth_user_service_mode_org_ids()` → `role = 'Permit Clerk'` only (Phase 1b); Phase 3 add `service_seat`. Used for multi-carrier clerk paths that should not include bare Owner/Admin **without** membership on that org (and for any remaining SM-specific scope). |

**Role constraint note (equipment/rigs):** Path (a)/(b) must **not** be “all memberships.” Driver/Viewer membership must not gain org-wide equipment RLS via the new path. Profiles/roster default to any membership (team visibility); revisit if product wants tighter.

**Done-when Phase 1b:**

1. Multi-org Owner/Admin (non-home membership) can SELECT `member_profiles` and `team_member_profiles` for those orgs **without** relying on SM helper.
2. Owner/Admin/Clerk membership can SELECT org equipment/rigs for those orgs via membership path; Driver/Viewer membership cannot.
3. Owner JWT cannot SELECT equipment for orgs with **no** membership.
4. SM helper returns only Clerk org ids; seated multi-org clerks still work.
5. Fixture/RLS checks recorded for all four tables.

### 5.6 Clerk cold-start (product)

Do **not** use fleet Owner bootstrap as the clerk path.

| Path | Description | Who grants seat? |
|------|-------------|------------------|
| **(a) Invited into host org** | Bureau **Owner/Admin** team-invites user as **Permit Clerk** (`service_seat` stays **false**). Then **platform/ops** attaches `service_seat = true` on that host (or client) membership via service-role runbook §5.2.1. Phase 1 interim: allowlist may let them use role-only SM without seat. | Role: bureau manager. **Seat: platform only** — no contradiction with seat write rules. |
| **(b) Platform-provisioned service account** | Ops seeds host org + Clerk membership + seat in one service-role operation | Platform |
| **(c) Temporary allowlist** | Env allowlist emails may create connection invites; service-role create path mints shell Clerk **and** seat | Allowlist + service-role create only |

Connection-invite **create** (service-role) may set seat on **new shell inviter** membership only — not a bureau Owner UI grant.

Fleet growth for carriers remains: Owner bootstrap, team invites, link requests—not connection-invite product.

### 5.7 Carrier connection invites ownership

| Decision | Recommendation |
|----------|----------------|
| Who creates | Users with ≥1 `service_seat` Permit Clerk membership (Phase 3); Phase 1: role Permit Clerk only + allowlist |
| Inviter membership on shell | `role = Permit Clerk`, `service_seat = true` (service-role write) |
| Acceptor | Primary Owner; **service_seat = false** |
| Carrier Owner create connection invites? | **No** (after Phase 1) |
| Exception | Platform admin / service-role tooling only |

---

## 6. Step-by-step rollout plan

### Phase 0 — Document + freeze conventions

| | |
|--|--|
| **Goals** | Single glossary; stop new code from inventing role sources; capture open audit notes |
| **Touchpoints** | This doc; short comments on `resolveNavActor`, `service-mode-scope`, invite modules |
| **Notes (not blocking)** | Dual `is_primary_owner` (profile + membership) — prefer membership as SSoT, profile as mirror; Owner Operator acting-role merge is **permissions** only (§4.1), not dual membership.role; shell org lifecycle remains connection-invite service responsibility (orphan cleanup already in create path — no Phase 1 change) |
| **Risks** | Low |
| **Done when** | Glossary accepted: membership = authz; home profile = identity; service_seat = Service Mode capability; Owner Operator exception documented |

### Phase 1 — Stop the bleeding (client gates: **all** Service Mode bypasses)

| | |
|--|--|
| **Goals** | Remove **every** non-clerk Service Mode / connection-invite bypass in client + API helpers; close obvious PE paths; pre-flight audit |
| **Pre-flight audit (before cut)** | SQL/report: (1) users with multi-org memberships who are not Permit Clerk on those orgs (will lose SM chrome); (2) all Permit Clerk memberships (who keeps SM under role-only); (3) connection-invite inviters; (4) pending link requests that would mint Clerk on approve. Share with ops before deploy. |
| **Touchpoints — must all change** | 1. `SERVICE_MODE_ELIGIBLE_ROLES` → `['Permit Clerk']` only 2. Delete primary_owner/created short-circuit in `isServiceModeEligibleCarrier` 3. `canCreateCarrierConnectionInvite` — remove Owner/Admin/`is_primary_owner` short-circuits 4. `CARRIER_CONNECTION_CREATOR_ROLES` align 5. `CarrierContextBar` copy 6. **Link-request approve:** hard-code role **`Viewer`** only (binary approve unchanged; no role picker in Phase 1) 7. **Self-invite block:** reject team invite when email **or** phone normalizes to inviter and role = Permit Clerk 8. **Self-reassign block:** reject own membership role → Permit Clerk without service-role 9. Tests for all above |
| **Optional interim** | Env allowlist for masters (temporary PE surface) |
| **Risks** | Owners lose multi-org SM chrome; **residual RLS cross-org until Phase 1b**; fail-closed AppHeader still hides Dashboard on profile load errors (monitor; soft-retry Phase 4). Communicate. |
| **Done when** | (1) No Owner/Admin/primary_owner/created path enables SM without Clerk membership role. (2) No Owner/Admin/primary creates connection invites without allowlist. (3) Cannot team-invite **own email or matching phone** as Permit Clerk. (4) Cannot reassign **own** membership to Permit Clerk via app. (5) Link-request approve hard-codes **Viewer** only. (6) Unit tests for each. (7) Pre-flight audit run documented. (8) **UI hide ≠ RLS** published. |

### Phase 1b — Restore membership paths on four tables, then narrow SM helper (same release train as Phase 1)

| | |
|--|--|
| **Goals** | (1) Restore membership-based SELECT for **`member_profiles`, `team_member_profiles`, `equipment_profiles`, `rig_configurations`** (025 removed pure membership multi-org for profiles/roster; equipment/rigs never had it). (2) Role-constrain equipment/rig membership path to Owner/Admin/Permit Clerk. (3) **Then** narrow SM helper to Permit Clerk so Owner/Admin no longer get foreign-org SM helper access. |
| **Touchpoints** | Full design §5.5. Migration order: restore membership branches → role-filter equipment/rigs → narrow `auth_user_service_mode_org_ids()` → fixture tests all four tables |
| **Risks** | Helper-only narrow **without** restore breaks multi-org Owner/Admin non-home profiles/roster **and** org-scoped equipment. Opening equipment to all memberships over-grants Driver/Viewer — use role constraint. |
| **Done when** | §5.5 done-when list (all four tables + role constraint + SM helper Clerk-only). |
| **Note** | Not full seat model (Phase 3). |

### Phase 2 — Model cleanups (acting role SSoT + hygiene)

| | |
|--|--|
| **Goals** | One acting-role resolver with Owner Operator exception; reduce dual-role bugs; hygiene |
| **Touchpoints** | `lib/nav-actor.ts` → `resolveActingActor`; AppHeader; dashboard tools; profile badges; membership sync on role edit; **document roster dual-source edit rules** (see `docs/plans/roster-edit-matrix.md`); **forced-owner → env** `NEXT_PUBLIC_FORCED_CARRIER_OWNER_EMAILS` / `FORCED_CARRIER_OWNER_EMAILS` |
| **Data** | Audit membership.role vs home user_roles mismatches |
| **Risks** | Nav regressions; keep fail-closed |
| **Done when** | Effective org drives nav; Owner Operator still has Driver capabilities on home; roster edit matrix documented; forced-owner not hardcoded |

### Phase 3 — Service Mode isolation (schema + RLS + write path)

| | |
|--|--|
| **Goals** | Durable `service_seat` default false; RLS = seat ∧ Clerk; **INSERT+UPDATE** protect; demotion clears seat; ops seating runbook |
| **Touchpoints** | Migration add column `DEFAULT false`; `BEFORE INSERT OR UPDATE` trigger (force false for non-service-role; clear seat if role ≠ Permit Clerk); rewrite SM helper to seat∧Clerk; connection-invite create sets seat (service-role); strip seat on all client paths; platform provision API; backfill sticky **connection-invite inviters only** (open Q5 plan default); ops runbook §5.2.1; optional dual `is_primary_owner` drift audit; admin migrate health optional |
| **Risks** | Lockout if backfill wrong — dry-run; feature flag; audit allowlists |
| **Done when** | (1) Cross-org SM reads only seat+Clerk. (2) Connection invites require prior seat. (3) Manager INSERT/UPDATE cannot set seat true. (4) Demotion from Clerk clears seat. (5) Owner fleet path unchanged. (6) Seating runbook executable. |

### Phase 4 — UX journey polish

| | |
|--|--|
| **Goals** | Journeys coherent; mitigate multi-org Admin loss; roster UX; onboarding fail-closed trap |
| **Touchpoints** | Profile welcome; Carriers empty states; invite landing as-built or optional change; hide SM chrome without seat; optional Carrier Mode multi-org switcher; roster list UX; link-request / deletion / profile-change copy; layout-level org context provider; **AppHeader:** distinguish load error vs incomplete onboarding (soft-retry / fail-open to Dashboard only when membership proves complete — avoid permanent trap) |
| **Risks** | Low if Phases 1–3 done |
| **Done when** | Persona QA + multi-org Admin checklist + clerk cold-start (a)+(ops seat) or (b) demo + fail-closed trap mitigated |

---

## 7. Open questions / non-goals

### Open questions

1. **Can a person be both fleet Owner and multi-carrier clerk?** If yes: home Owner membership **plus** separate Clerk+seat memberships on client orgs (or host). Recommend yes with dual memberships, not Owner+seat on same fleet org.
2. **Should Admin ever get service_seat?** Recommend no.
3. **Org switcher priority** for multi-org non-clerks after Phase 1?
4. **Phone-only team invites** — keep or require email? (Phase 1 still allows phone-only; self-invite block must normalize phone — §5.3.)
5. **Default backfill** — **Plan default Phase 3:** sticky seats only for **connection-invite inviters** (+ platform-marked bureaus), **not** all Permit Clerk rows. Open only if product wants broader backfill.
6. **Billing** for service_seat — later.
7. **Multi-home `member_profiles`** — defer redesign.
8. **Shell org lifecycle** — keep current connection-invite orphan cleanup; deeper redesign non-goal until ops pain.

### Non-goals (now)

- Rewriting auth away from Supabase
- Merging team invites and carrier connection invites into one table
- Full RBAC engine / policy language
- Mobile apps / SSO / SCIM
- Dropping roster in favor of only memberships
- Platform admin as an org role on customer carriers
- Automatic migration of every Owner into a service bureau
- Global entitlement as sole Service Mode gate

### Phase 3+ controls for sticky allowlists & service-role (security)

| Control | Rule |
|---------|------|
| Platform env allowlists | Temporary; inventory in admin docs; remove after seat backfill; never permanent PE for customer Owner emails |
| Forced-owner | Env-only after Phase 2; not a substitute for service_seat; audit quarterly |
| Service-role invite paths | Keep for accept/create reliability; all seat writes only here; log seat grants/revokes |
| Sticky seats from historical inviters | One-time backfill; revocable via platform; no automatic inheritance to new memberships |
| Client membership UPDATE | Never trusts client for `service_seat` or `is_primary_owner` |

---

## Appendix A — Key file index

| Area | Paths |
|------|--------|
| Types | `types/organization.ts`, `types/member-profile.ts` |
| Org context / mode | `lib/organization-context.ts`, `lib/service-mode-scope.ts` |
| Permissions | `lib/team-permissions.ts`, `lib/member-profile-permissions.ts`, `lib/nav-actor.ts` |
| Profiles / bootstrap | `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `lib/onboarding.ts` |
| Invites | `lib/team-invites.ts`, `lib/team-invite-accept.ts`, `lib/carrier-connection-invites.ts`, `lib/carrier-connection-invite-service.ts` |
| Adjacent | `lib/carrier-link-requests.ts`, `lib/deletion-requests.ts`, `lib/profile-change-requests.ts`, `lib/profile-field-permissions.ts` |
| UI | `components/AppHeader.tsx`, `components/CarrierContextBar.tsx`, `app/profile/page.tsx`, `app/carriers/page.tsx`, `app/login/page.tsx`, `app/invite/[token]/page.tsx`, `app/carrier-invite/[token]/page.tsx` |
| Platform admin | `lib/admin-auth.ts`, `app/admin/db/page.tsx` |
| Migrations | `018`–`036` under `supabase/migrations/` |

## Appendix B — Glossary (freeze)

| Term | Definition |
|------|------------|
| **Home org** | `member_profiles.organization_id` for the user |
| **Membership** | Row in `organization_memberships` granting org access + scalar role |
| **Primary owner** | Unique owner identity of an org (`is_primary_owner`) |
| **Roster** | `team_member_profiles` entry, possibly unlinked |
| **Carrier Mode** | Work as home org |
| **Service Mode** | Work scoped to a selected carrier when user has service-eligible membership(s) |
| **Service seat** | `organization_memberships.service_seat` — durable capability for Service Mode on that org (Phase 3) |
| **Owner Operator** | Home profile roles Owner + Driver; acting-role exception on home org |
| **Acting role** | Role/capabilities used for UI/API authorization in current effective org |
| **Platform admin** | Ops email/`app_metadata` for migrations/seat provisioning—not org role |
| **UI hide vs data access** | Client chrome gate ≠ Postgres RLS |

## Appendix C — Durable model alternatives (not chosen)

| Option | Why not primary |
|--------|-----------------|
| Role-only forever | Self-invite PE; no durable product tier |
| Global `user_product_entitlements` alone | One flag + any membership over-broad |
| Org `org_kind = service_bureau` alone | Clerk is often a person on many carrier orgs, not one bureau org type |
| A+C hybrid global+membership without target role | Rejected in Fix Round 1 — use seat ∧ Clerk on **target** org only |
