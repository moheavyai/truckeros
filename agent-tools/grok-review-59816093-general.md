# Account Switcher Bootstrap Fix — General Review

**Scope:** `lib/member-profile.ts`, `lib/roster-profile-link.ts`, `app/profile/page.tsx`, `lib/team-member-profiles-api.ts`, related tests  
**Reference:** `agent-tools/grok-impl-summary-59816093.md`  
**Focus:** Bootstrap detection for dev account switcher / roster-linked actors without `member_profiles` rows  
**Status:** Open issues remain — no fixes applied in this pass

**Tests:** **219/219** passing

```bash
npx vitest run \
  lib/member-profile.test.ts \
  lib/roster-profile-link.test.ts \
  app/profile/profile-ui.test.ts \
  lib/team-member-profiles-api.test.ts \
  lib/dev-account-switch.test.ts
```

---

## Verdict

The **primary bug is fixed**: naive `!ownProfile` bootstrap detection is replaced with `needsPrimaryOwnerBootstrap()`, and the profile page hydrates `effectiveOwnProfile` from roster/membership before choosing bootstrap vs landing. Dev-switching to a roster-linked Driver/Admin should no longer show the "Welcome to Truckeros" owner onboarding card.

Two follow-on gaps remain around **carrier save** and **initial admin data preload** for hydrated actors who still lack a persisted `member_profiles` row.

---

## Open Issues

### 1. bug — Roster-linked Admin carrier save can bootstrap a new organization

**Severity:** bug  
**Scenario:** Roster-linked Admin (or any Owner/Admin hydrated actor) **without** a `member_profiles` row saves carrier information.

**Root cause chain:**

1. Client `handleSaveCarrierInfo` calls `buildCarrierOnlyApiSavePayload(formSnapshot, ownProfile, …)` with `ownProfile === null` (`app/profile/page.tsx:1187`).
2. `buildCarrierOnlyApiSavePayload` forces `ensureBootstrapOwnerRoles` when `!existing?.organization_id` (`lib/member-profile.ts:161-164`), rewriting roles to `Owner` even though `isProfileBootstrap` is false and `effectiveOwnProfile` already has the real org.
3. Server correctly sets `shouldBootstrap = false` via `needsPrimaryOwnerBootstrap`, but `prepareMemberProfileSave` still sees Owner in the form and assigns a **new** `organization_id` + `is_primary_owner: true` (`lib/member-profile.ts:1031-1034`).
4. Roster org correction only runs when `!payload.organization_id` (`lib/team-member-profiles-api.ts:388-397`). Because step 3 already set an org, correction is skipped and `isNewOrganizationBootstrap` creates a duplicate `organizations` row.

**Impact:** An Admin who edits carrier info before accepting an invite / creating their own profile row could fork a second org and be promoted to primary owner — outside the intended team-member path.

**Suggested fix direction:**

- Pass `effectiveOwnProfile` (or explicit roster/membership context) into `buildCarrierOnlyApiSavePayload` and gate `ensureBootstrapOwnerRoles` on `needsPrimaryOwnerBootstrap`, not bare `!existing?.organization_id`.
- On the server, apply roster/membership `organization_id` **before** `prepareMemberProfileSave`, or override payload org/roles whenever `linkedRoster || organizationMembership` and `!shouldBootstrap` — even if the client sent Owner bootstrap roles.

**Test gap:** No unit/integration test covers roster-linked Admin `carrier_only` self-save.

---

### 2. suggestion — Initial admin preload still keys off `loadedProfile`, not hydrated actor

**Severity:** suggestion  
**Location:** `app/profile/page.tsx:581-587`

After resolving roster/membership, `loadedProfile` stays `null` for actors without a `member_profiles` row. Admin-only loaders are gated on `loadedProfile`:

```ts
if (loadedProfile && isPrimaryOwner(loadedProfile)) {
  await loadAdminPendingChangeRequests(session.access_token)
}
if (loadedProfile && canManageMemberPermissions(loadedProfile)) {
  await loadAdminDeletionRequests(session.access_token)
  await loadTeamInvites(session.access_token)
}
```

Meanwhile UI permissions use `effectiveOwnProfile` (e.g. `showTeamInvitesSection = canManageMemberPermissions(effectiveOwnProfile)`). A roster-linked Admin can see team-invite UI but start with an empty invites list until a later action triggers `loadTeamInvites`.

**Suggested fix:** Resolve `actorProfile` once in the load path and use it (or `effectiveOwnProfile`) for admin preload gates, not only `loadedProfile`.

---

### 3. nit — Client save helpers still use `ownProfile` where `effectiveOwnProfile` is authoritative

**Severity:** nit  
**Locations:**

| Call site | Uses | Should consider |
|-----------|------|-----------------|
| `buildCarrierOnlyApiSavePayload` | `ownProfile` | `effectiveOwnProfile` or bootstrap gate |
| `validateBootstrapCarrierSaveRoles` | `ownProfile` | `effectiveOwnProfile` |
| `buildSavePayloadForTarget` default | `ownProfile` | `effectiveOwnProfile` for self saves |

UI gates already use `effectiveOwnProfile`; payload builders lag behind, producing client/server divergence and confusing dev `[carrier-save]` logs. Not blocking the account-switcher landing fix, but worth aligning in a follow-up.

---

## Verified Fixed (this pass)

| Area | Status | Evidence |
|------|--------|----------|
| Naive `!ownProfile` bootstrap detection | **Fixed** | `needsPrimaryOwnerBootstrap` checks roster + membership + profile (`lib/member-profile.ts:306-319`) |
| Parallel roster/membership resolution on load | **Fixed** | `fetchLinkedTeamMemberRoster` + `fetchOrganizationMembershipForUser` in `page.tsx:533-536` |
| Landing permissions for roster-linked actors | **Fixed** | `effectiveOwnProfile` via `resolveActorProfile` (`page.tsx:370-376`); used for badges, team section, field permissions |
| Bootstrap card gating | **Fixed** | `isProfileBootstrap` derived from `needsPrimaryOwnerBootstrap`; `shouldShowOwnerBootstrapSetupCard` unchanged contract |
| `ensureBootstrapOwnerRoles` mount effect | **Fixed** | Gated on `needsPrimaryOwnerBootstrap` (`page.tsx:617-624`) |
| Server self-save bootstrap validation | **Fixed** | Same gate + roster role/org hydration (`lib/team-member-profiles-api.ts:329-397`) |
| `loadTeamData` for Owner/Admin managers | **Fixed** | `isPrimaryOwner(profile) \|\| hasManagementAccess(profile)` (`page.tsx:474-475`) |
| Forced owner edge case | **Fixed** | Bootstraps only when not team-linked (`member-profile.test.ts` forced-owner cases) |
| Post-save state cleanup | **Fixed** | Clears `linkedRosterProfile` / `organizationMembership` when profile row created (`page.tsx:1219-1221`) |
| Dev switcher reload path | **Unchanged / OK** | `window.location.reload()` after `completeDevAccountSwitch` ensures full bootstrap resolution on switch |

### Intended flow after fix

1. **Owner with profile** — landing + carrier + full roster; no bootstrap card.
2. **Team member with `member_profiles`** — role-appropriate landing; no bootstrap card.
3. **Roster-only / membership-only team member** — landing with correct role badges and team section; **no** Welcome card.
4. **Truly new primary owner** — bootstrap card + Owner assignment on save.
5. **Forced owner (`andrehampton1@outlook.com`)** — bootstraps only when not already linked to a team.

---

## Summary

| Severity | Open count |
|----------|------------|
| bug | 1 |
| suggestion | 1 |
| nit | 1 |
| **Total open** | **3** |

**Verdict:** The account-switcher bootstrap misclassification is **resolved** for the reported scenario (roster-linked Driver/Admin landing). **219/219** targeted tests pass. Remaining work is confined to edge cases where a hydrated Admin without a `member_profiles` row interacts with carrier save or admin preload — not the core dev-switch landing bug, but worth addressing before treating this area as fully closed.

**Manual smoke (recommended):**

1. Dev-switch to roster-only Driver → landing, role badges, no Welcome card, no carrier edit.
2. Dev-switch to roster-only Admin → landing, team roster visible, no Welcome card; confirm invites section populates (issue #2).
3. Dev-switch to brand-new account → Welcome card appears.
4. Switch back to owner → no bootstrap flash during load spinner.
5. *(If testing issue #1)* Roster-only Admin attempts carrier save before profile row exists → should attach to existing org, not create a new one.