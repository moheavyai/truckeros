# Security Review: Bootstrap Gating, Roster Hydration, Permissions Views After Account Switch

**Scope:** `lib/member-profile.ts`, `lib/roster-profile-link.ts`, `app/profile/page.tsx`, `lib/team-member-profiles-api.ts`, RLS migrations `019`, `021`, `024`, `028`, `029`, `032`  
**Implementation ref:** `agent-tools/grok-impl-summary-59816093.md`  
**Focus:** Bootstrap vs team-member misclassification, roster/membership hydration, `effectiveOwnProfile` permission views, server save authority, RLS alignment  
**Date:** 2026-07-08  
**Status:** open  
**Criteria:** Exploitable privilege escalation, wrongful org bootstrap, cross-tenant linkage, auth bypass, client-only permission inflation

---

## Summary

The fix correctly centralizes bootstrap detection in `needsPrimaryOwnerBootstrap()` and aligns client/server self-save gates. **Server authority remains on the DB `actorProfile` row**, not the client-hydrated `effectiveOwnProfile` — a sound split for permission enforcement.

**Open security issues** fall into three clusters:

1. **RLS / hydration mismatch** — roster email/`linked_user_id` lookups run against `team_member_profiles` policies that require `auth_user_organization_id()` or `auth_user_membership_org_ids()`. Users with a roster row but **no** `member_profiles` row and **no** `organization_memberships` row cannot read their roster; hydration fails and the app may treat them as primary-owner bootstrap candidates.
2. **Carrier-save org fork** — hydrated Admin/Owner actors without a persisted profile can still trigger client-side Owner bootstrap roles and server-side new-org creation on `carrier_only` save.
3. **First self-save role trust** — roster/membership-linked self-saves default roles only when the client sends an empty `user_roles` array; submitted roles are not clamped to roster/membership, and `rejectNonBootstrapOwnerRoles` is not applied on the self-save path.

No code changes were made in this review (audit only).

---

## Attack paths verified safe

| Scenario | Result |
|----------|--------|
| Client forges `effectiveOwnProfile` (Admin) in React state / DevTools | **Blocked on writes:** `saveTeamMemberProfileForUser` loads `actorProfile` from DB (`team-member-profiles-api.ts:303-313`); bootstrap/org/role enrichment uses server-fetched roster + membership, not client hydration |
| Roster-linked Driver shown landing UI | **UI-only:** permission badges/team section derive from synthetic profile; destructive actions still hit API with DB actor |
| Team member edits another member's profile via API | **Blocked:** requires `actorProfile.organization_id` + `canEditMember` (`team-member-profiles-api.ts:473-478`) |
| Non-bootstrap team save assigns `Owner` to another member | **Blocked:** `rejectNonBootstrapOwnerRoles` on other-member path (`team-member-profiles-api.ts:482`) |
| True bootstrap self-save assigns arbitrary roles | **Blocked:** `normalizeBootstrapSelfRoles` clamps to Owner or Owner+Driver (`member-profile.ts:403-414`); `validateBootstrapCarrierSaveRoles` enforces Owner path |
| Forced owner bootstraps while already roster/membership-linked | **Blocked:** `needsPrimaryOwnerBootstrap` returns false when `hasExistingTeamMembership` (`member-profile.ts:312`, unit tests) |
| Persisted `member_profiles` row ignored in favor of stale roster | **Blocked:** `resolveActorProfile` prefers `ownProfile` over roster/membership (`member-profile.ts:341`) |
| Dev account switch issues cross-org session | **Blocked (dev route):** `completeDevAccountSwitch` verifies session email matches requested email (`dev-account-switch.ts:53-58`); switch allowlist scoped to actor org (separate review `grok-review-f6017827-security.md`) |
| Viewer self-save when profile row exists | **Blocked:** `canWriteTeamData(actorProfile)` gate (`team-member-profiles-api.ts:319-324`) |

---

## Open issues

### 1. RLS prevents roster hydration for roster-only users → wrongful primary-owner bootstrap

| Field | Value |
|-------|-------|
| **Severity** | bug |
| **Type** | privilege escalation / tenant escape |
| **Status** | open |

**Description:** `fetchLinkedTeamMemberRoster` queries `team_member_profiles` by `linked_user_id` or `driver_email` (`roster-profile-link.ts:14-45`). RLS SELECT on that table requires the row's `organization_id` to match either `auth_user_organization_id()` (from `member_profiles`) **or** `auth_user_membership_org_ids()` (`024_service_mode_membership_rls.sql:24-33`). There is **no** policy allowing self-read by `linked_user_id = auth.uid()` or JWT email alone.

For a user on the roster (email or `linked_user_id` set) who has **not** yet accepted an invite / has no `organization_memberships` row and no `member_profiles` row:

- Roster fetch returns `null` (RLS filters all rows).
- Membership fetch returns `null`.
- `needsPrimaryOwnerBootstrap` returns **true** (`member-profile.ts:318`).
- UI shows Welcome/owner bootstrap; `ensureBootstrapOwnerRoles` runs.
- Self-save follows bootstrap path → new `organizations` row + `is_primary_owner: true`.

**Exploit / impact:** A legitimate roster-only driver/admin (or attacker who registers with an email listed on a roster before invite accept) can create a **parallel carrier org as primary Owner** instead of joining the intended team. This is org sprawl and an effective escape from intended team membership.

**Note:** If the user already has `organization_memberships` (post-invite), membership fetch succeeds, bootstrap is suppressed, and roster read may succeed via `auth_user_membership_org_ids()` — the gap is specifically **roster-only, membership-none**.

**Suggestion:** Add an RLS policy or `SECURITY DEFINER` RPC for self-scoped roster resolution, e.g. `linked_user_id = auth.uid()` OR normalized `driver_email` matches JWT email (single-row, org-scoped). Alternatively, require invite accept (membership row) before first login. Add integration test against real RLS, not mocked Supabase.

---

### 2. Hydrated Admin carrier save can fork a new organization (client Owner roles + server org assignment)

| Field | Value |
|-------|-------|
| **Severity** | bug |
| **Type** | privilege escalation |
| **Status** | open |

**Description:** When `isProfileBootstrap` is false but `ownProfile` is still `null`, `handleSaveCarrierInfo` builds the API payload with persisted state, not hydrated state:

```1187:1187:app/profile/page.tsx
      const carrierPayload = buildCarrierOnlyApiSavePayload(formSnapshot, ownProfile, actorEmail)
```

`buildCarrierOnlyApiSavePayload` calls `ensureBootstrapOwnerRoles` when `!existing?.organization_id` (`member-profile.ts:161-164`), rewriting roles to `Owner` even though `effectiveOwnProfile` already carries the real org and Admin role.

Server path:

1. `needsPrimaryOwnerBootstrap` → `shouldBootstrap = false` (roster/membership present).
2. `prepareMemberProfileSave` sees Owner in form → `shouldBootstrapOrganization` true → assigns **new** `organization_id` + `is_primary_owner: true` (`member-profile.ts:1031-1034`).
3. Roster org correction only runs when `!payload.organization_id` (`team-member-profiles-api.ts:388-397`). New org is already set, so correction is skipped.
4. `isNewOrganizationBootstrap` may insert a duplicate `organizations` row.

**Exploit path:** Roster-linked Admin (hydrated landing, no `member_profiles` row) saves carrier information → becomes primary owner of a **new** org while still roster-linked to the original org in `team_member_profiles`.

**Suggestion:** Gate `ensureBootstrapOwnerRoles` in `buildCarrierOnlyApiSavePayload` on `needsPrimaryOwnerBootstrap`, not bare `!existing?.organization_id`. On server, when `!shouldBootstrap && (linkedRoster || organizationMembership)`, set `payload.organization_id` and `is_primary_owner = false` **before** or **after** `prepareMemberProfileSave`, overriding client-submitted Owner bootstrap roles. Pass `effectiveOwnProfile` (or linkage context) into client carrier helpers.

---

### 3. Roster/membership-linked first self-save accepts client-supplied roles (no server clamp)

| Field | Value |
|-------|-------|
| **Severity** | bug |
| **Type** | privilege escalation |
| **Status** | open |

**Description:** On self-save when `shouldBootstrap` is false and the actor lacks `organization_id` on the DB row:

```360:371:lib/team-member-profiles-api.ts
    } else if (!actorProfile?.organization_id && (linkedRoster || organizationMembership)) {
      ...
        if (!formForSave.user_roles?.length && rosterRoles.length > 0) {
          formForSave = { ...formForSave, user_roles: rosterRoles }
        }
```

Roles from roster/membership are applied **only when the client sends an empty `user_roles` array**. If the client POSTs `user_roles: ['Admin']` or `['Owner']` while roster says `Driver`, those roles persist into `member_profiles` upsert.

`rejectNonBootstrapOwnerRoles` is invoked on **other-member** saves (`team-member-profiles-api.ts:482`) but **not** on self-save. `selfSaveFormForActor` allows role edits when `!actorProfile` (`team-member-profiles-api.ts:259-261`).

After upsert, `syncOrganizationMembershipForMember` upserts membership with `primaryRoleFromUserRoles(saved.user_roles)` (`team-member-profiles-api.ts:457-467`), potentially **upgrading** an existing Driver membership to Admin/Owner on conflict.

**Exploit path:** Authenticated user with roster Driver linkage (once hydration works) or existing Driver membership crafts API body with elevated roles on first profile save.

**Suggestion:** For `!shouldBootstrap && (linkedRoster || organizationMembership)`, **always** clamp `user_roles` to roster/membership source (and call `rejectNonBootstrapOwnerRoles`). Ignore client role fields on first linkage save unless actor is primary owner.

---

### 4. Lookup errors silently downgrade to bootstrap (transient misclassification)

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Type** | availability / wrongful bootstrap |
| **Status** | open |

**Description:** `fetchOrganizationMembershipForUser` returns `null` on Supabase error (`roster-profile-link.ts:60-62`). Roster fetch logs warnings but also returns `null` on empty/error. Combined with no roster match, `needsPrimaryOwnerBootstrap` becomes true.

A transient DB/RLS failure for an **existing** team member could surface the Welcome card and enable bootstrap save (issues #1–#3), creating duplicate org data.

**Suggestion:** Propagate distinguishable error state; hold loading spinner / show retry instead of falling through to bootstrap. Fail closed for bootstrap when linkage fetch errors.

---

### 5. `effectiveOwnProfile` inflates UI permissions; admin token loads still gated on `loadedProfile`

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Type** | defense-in-depth / UI-security mismatch |
| **Status** | open |

**Description:** Profile page permission views (`canManageMemberPermissions`, `showTeamInvitesSection`, team roster actions) use `effectiveOwnProfile` (`page.tsx:1802-1812`). Initial admin async loads require raw `loadedProfile` (`page.tsx:581-587`):

```581:587:app/profile/page.tsx
          if (loadedProfile && isPrimaryOwner(loadedProfile)) {
            await loadAdminPendingChangeRequests(session.access_token)
          }
          if (loadedProfile && canManageMemberPermissions(loadedProfile)) {
            await loadAdminDeletionRequests(session.access_token)
            await loadTeamInvites(session.access_token)
          }
```

Hydrated roster/membership Admin sees manager UI affordances while invite/deletion queues are empty until a later reload. **Server APIs remain authoritative** if they enforce role checks; risk is mainly misleading UX and encouraging retries against endpoints the actor may not truly access.

**Suggestion:** Use hydrated actor for preload gates (same as UI). Verify each admin API route rejects roster-hydrated actors without persisted profile + membership role.

---

### 6. Email-based roster fallback: ambiguous org when multiple rows match

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Type** | wrong-tenant linkage |
| **Status** | open |

**Description:** `fetchLinkedTeamMemberRoster` uses `.order('updated_at', { ascending: false }).limit(1).maybeSingle()` (`roster-profile-link.ts:37-39`). If the same normalized email appears on roster rows in multiple orgs visible via membership (or after RLS fix in issue #1), the most recently updated row wins with no verification that `linked_user_id` matches or that an invite was accepted for that org.

**Suggestion:** Prefer `linked_user_id = auth.uid()` match; scope email fallback to orgs with pending accepted invite or explicit membership; reject ambiguous multi-row matches.

---

### 7. Hardcoded forced-carrier-owner bypass remains in bootstrap/save paths

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Type** | break-glass / account takeover surface |
| **Status** | open |

**Description:** `isForcedCarrierOwner` (`forced-carrier-owner.ts:4-5`) bypasses bootstrap suppression when unlinked, forces Owner roles on carrier save, and can promote via `supabaseAdmin` (`team-member-profiles-api.ts:408-418`). Acceptable for local dev; if that email is compromised or the check ships broadly, it is a concentrated privilege bypass.

**Suggestion:** Restrict forced-owner paths to `isDevEnvironment()` (not merely roster/profile state). Document that `FORCED_CARRIER_OWNER_EMAIL` must not be a production tenant admin.

---

### 8. `canWriteTeamData(null)` returns true (bootstrap cohort)

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **Type** | intentional bootstrap affordance |
| **Status** | open |

**Description:** `canWriteTeamData` returns `true` when actor is null (`member-profile-permissions.ts:30`). Combined with issue #1, users misclassified as bootstrap gain write affordances in UI. Server bootstrap validation mitigates true saves, but the null-actor write default widens the blast radius of misclassification.

**Suggestion:** Pair with fail-closed linkage resolution (issue #1/#4); consider `canWriteTeamData(null)` → false except when `needsPrimaryOwnerBootstrap` explicitly true.

---

### 9. Unit tests mock Supabase; RLS behavior not exercised

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **Type** | test gap |
| **Status** | open |

**Description:** `roster-profile-link.test.ts` uses chain mocks that always return data; no test asserts RLS denial for roster-only actors. `team-member-profiles-api` source-inspection tests cover `needsPrimaryOwnerBootstrap` wiring but not carrier-save org fork or role clamp.

**Suggestion:** Add integration tests with RLS-enabled Supabase (or policy unit tests) for roster-only hydration, carrier-only save org stability, and role clamp on first self-save.

---

## Severity summary

| Severity | Open count |
|----------|------------|
| bug | 3 |
| suggestion | 4 |
| nit | 2 |
| **Total open** | **9** |

---

## Verdict

Bootstrap **detection logic** (`needsPrimaryOwnerBootstrap`) is sound and **client/server aligned** for the common paths where roster or membership rows are **readable**. The account-switch landing fix is a real improvement when linkage data is available.

**Do not treat the area as security-closed** until:

1. Roster-only hydration works under RLS (issue #1) or invite-before-login is mandatory.
2. Carrier save cannot fork orgs for hydrated non-bootstrap actors (issue #2).
3. First linkage self-save clamps roles server-side (issue #3).

**Manual security smoke (recommended):**

1. Roster-only user (email on `team_member_profiles`, no membership, no `member_profiles`) — confirm whether roster fetch returns data under RLS; must **not** show Welcome card or allow new-org bootstrap.
2. Roster-linked Admin without `member_profiles` — carrier save must attach to existing org, not create `is_primary_owner` row.
3. Roster-linked Driver — API self-save with `user_roles: ['Admin']` must persist Driver (or membership role), not Admin.
4. User with `organization_memberships` only — bootstrap suppressed; verify no Owner role in upsert payload on full save.