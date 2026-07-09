# Tests Specialist Review — Account Switcher Bootstrap Gating

**Status:** open  
**Scope:** Bootstrap detection (`needsPrimaryOwnerBootstrap`), roster/membership hydration, profile landing views after dev account switch  
**Implementation:** `agent-tools/grok-impl-summary-59816093.md`  
**Primary files:** `lib/member-profile.ts`, `lib/roster-profile-link.ts`, `app/profile/page.tsx`, `lib/team-member-profiles-api.ts`, `lib/dev-account-switch.ts`  
**Test files reviewed:**

| File | Style | Approx. tests |
|------|-------|---------------|
| `lib/member-profile.test.ts` | Unit | ~115 |
| `lib/roster-profile-link.test.ts` | Unit (mocked Supabase) | 3 |
| `app/profile/profile-ui.test.ts` | Static source inspection | 39 |
| `lib/team-member-profiles-api.test.ts` | Unit + source inspection | 36 |
| `lib/dev-account-switch.test.ts` | Unit + regression slices | 22 |

**Related (not in primary suite):** `app/api/dev/switch-user/route.test.ts`, `components/DevAccountSwitcher.tsx` (wired via `profile-ui.test.ts` only)

**Do not fix in this review** — assessment only.

---

## Executive summary

The fix correctly moves bootstrap detection from naive `!ownProfile` to **`needsPrimaryOwnerBootstrap()`**, with parallel roster/membership resolution and **`effectiveOwnProfile`** hydration for landing permissions. **Unit coverage for the core gate and hydration helpers is strong.** Dev-switch org resolution and roster lookup precedence are also well tested.

**Main risks:**

1. **No behavioral test proves the roster-linked / membership-only self-save path on the server** — `team-member-profiles-api.test.ts` wires mocks for linked roster and membership but always returns `null`; only source-inspection asserts `shouldBootstrap` branching.
2. **Profile page UI tests confirm symbols and regressions against the old `!ownProfile` pattern**, but **do not slice the initial-load bootstrap vs team-member branch** (the exact bug surface).
3. **`resolveActorProfile` membership-only hydration is untested** — only roster-linked and persisted-profile paths have unit tests.
4. **Dev org resolution diverges from profile page** — `resolveDevSwitchOrganizationId` uses `member_profiles` then roster only; it does **not** consult `organization_memberships`, so a membership-only switch target may resolve `null` org in the switcher while the profile page shows the correct landing view.
5. **No render/integration test** for account-switch → profile load → landing vs Welcome card (accepted project limitation, but this feature is the primary manual verification target).

Estimated coverage: **~65% of critical paths** (pure gate logic strong; cross-layer behavioral paths and membership-only edges weak).

---

## 1. Bootstrap gating (`needsPrimaryOwnerBootstrap`)

### What is covered

| Case | Test location |
|------|---------------|
| First-time owner, no profile, no team linkage → `true` | `member-profile.test.ts` — `needsPrimaryOwnerBootstrap` |
| `member_profiles` row with `organization_id` → `false` | Same |
| Roster-linked user without `member_profiles` → `false` | Same |
| `organization_memberships` row without `member_profiles` → `false` | Same |
| Forced owner (`andrehampton1@outlook.com`) without team → `true` | Same |
| Forced owner linked to roster → `false` | Same |
| `hasExistingTeamMembership` detects roster or membership | Same |
| Mount effect gated to `needsPrimaryOwnerBootstrap` (not `!ownProfile`) | `profile-ui.test.ts` — `auto-assigns bootstrap Owner roles on mount and carrier save` |
| Negative regression: old `!ownProfile \|\| isForcedCarrierOwner` mount path removed | Same (`expect(source).not.toMatch(...)`) |
| Carrier save uses `isProfileBootstrap` snapshot, not unconditional bootstrap | `profile-ui.test.ts` — carrier save slices |
| API self-save uses `shouldBootstrap = needsPrimaryOwnerBootstrap(...)` | `team-member-profiles-api.test.ts` — `saveTeamMemberProfileForUser bootstrap gate` (source) |
| Bootstrap validation only when `shouldBootstrap` | Same (source regex) |

### Gaps

| Priority | Gap | Risk | Suggested test |
|----------|-----|------|----------------|
| **P1** | **`ownProfile` exists without `organization_id` and without team linkage** — gate returns `false` via `return !options.ownProfile`; no explicit test | Partial/stale profile row could suppress bootstrap unexpectedly | Unit: `{ ownProfile: { user_id: 'u1', user_roles: ['Driver'] } }` → `false` |
| **P1** | **`ownProfile.is_primary_owner === true` without `organization_id`** — early return `false`; no test | Primary-owner flag without org may block bootstrap path | Unit: `{ ownProfile: { is_primary_owner: true } }` → `false` |
| **P1** | **Both roster and membership present** — `hasExistingTeamMembership` true; precedence of `resolveActorProfile` (roster over membership) untested at integration level | Wrong role/org if both exist and disagree | Unit: `resolveActorProfile(null, roster, userId, membership)` when both set; API save with both mocks |
| **P2** | **`linkedRoster` with empty/missing `organization_id`** — `hasExistingTeamMembership` is false if org id falsy | Roster row without org could still bootstrap | Unit: `{ linkedRoster: { id: 'r1', organization_id: '' } }` |
| **P2** | **Membership role normalization edge cases** — `resolveActorProfile` uses `validateUserRoles([role])`; invalid role string | Empty roles on landing for membership-only actors | Unit: `organizationMembership: { organization_id: 'org-1', role: 'bogus' }` |

### Bootstrap gate matrix

| Actor state | Expected bootstrap | Unit tested | UI/API behavioral |
|-------------|-------------------|-------------|-------------------|
| No profile, no roster, no membership | `true` | ✅ | ❌ |
| `member_profiles` + `organization_id` | `false` | ✅ | ❌ |
| Roster link only | `false` | ✅ | ❌ (API mocks always null) |
| Membership only | `false` (gate) | ✅ | ❌ (hydration + save) |
| Forced owner, no team | `true` | ✅ | ⚠️ (forced owner API bootstrap tests exist, not roster-blocked forced owner) |
| Forced owner + roster | `false` | ✅ | ❌ |
| Partial `ownProfile` without org | `false` | ❌ | ❌ |

---

## 2. Actor hydration (`resolveActorProfile`, `memberProfileFromLinkedRoster`)

### What is covered

| Case | Test |
|------|------|
| Roster → synthetic `MemberProfile` with `is_primary_owner: false` | `memberProfileFromLinkedRoster` |
| `resolveActorProfile` hydrates from roster when `ownProfile` null | `resolveActorProfile` |
| Persisted `ownProfile` preferred over roster | `resolveActorProfile` |
| `effectiveOwnProfile` useMemo in page | `profile-ui.test.ts` (symbol) |
| Page passes `effectiveOwnProfile` to permissions, landing, carrier, team | `profile-ui.test.ts` (multiple `toContain`) |

### Gaps

| Priority | Gap | Risk | Suggested test |
|----------|-----|------|----------------|
| **P1** | **`resolveActorProfile(null, null, userId, membership)`** — membership-only hydration | Admin/Driver landing broken for users with membership but no roster row | Unit: membership with `role: 'Admin'` → `user_roles: ['Admin']`, `organization_id` set |
| **P1** | **Initial load branch: `shouldBootstrap` false → `actorProfile` form + `loadTeamData`** | Core fix path never sliced in UI tests | UI slice: `else if (actorProfile)` block calls `loadTeamData` and does **not** call `ensureBootstrapOwnerRoles` |
| **P1** | **Initial load branch: `shouldBootstrap` true → `ensureBootstrapOwnerRoles`** | Welcome card regression | UI slice: `if (shouldBootstrap)` in auth load handler |
| **P2** | **Post-save state cleanup** — `setLinkedRosterProfile(null)` / `setOrganizationMembership(null)` when real profile created | Stale hydration after first save | UI slice in `handleSave` / `handleSaveCarrierInfo` success paths |
| **P2** | **Roster field mapping completeness** — `driver_full_name`, `company_name`, permissions | Landing badges/team section wrong | Extend `memberProfileFromLinkedRoster` with full roster fixture |
| **P3** | **`effectiveOwnProfile` vs `ownProfile` separation** — carrier save uses `ownProfile` in `buildCarrierOnlyApiSavePayload` | Intentional but undocumented; roster-linked carrier save edge | Document + optional slice asserting `ownProfile` in carrier payload builder |

---

## 3. Roster / membership fetch helpers (`roster-profile-link.ts`)

### What is covered

| Case | Test |
|------|------|
| `linked_user_id` lookup returns row; email lookup skipped when linked hit | `fetchLinkedTeamMemberRoster` (first test asserts `emailLookup` not called) |
| Email fallback when linked id miss | Second test (via shared mock; weaker assertion) |
| `fetchOrganizationMembershipForUser` returns `{ organization_id, role }` | `fetchOrganizationMembershipForUser` |

### Gaps

| Priority | Gap | Risk | Suggested test |
|----------|-----|------|----------------|
| **P1** | **Email normalization via `normalizeInviteEmail`** — casing/whitespace | Dev switch to roster-by-email fails silently | Unit: `' Driver@Example.COM '` matches normalized roster email |
| **P2** | **Supabase error paths** — `console.warn` + return null | Load hangs or throws on DB error | Unit: `{ data: null, error: { message: '...' } }` → `null` |
| **P2** | **`fetchOrganizationMembershipForUser` with null/empty `organization_id`** | False membership link | Unit: `{ organization_id: null, role: 'Admin' }` → `null` |
| **P2** | **Parallel fetch on profile load** — `Promise.all([fetchLinkedTeamMemberRoster, fetchOrganizationMembershipForUser])` | One fetch dropped on refactor | UI slice in `page.tsx` auth load `else` branch |
| **P3** | **`order('updated_at', { ascending: false }).limit(1)`** contract | Wrong roster row if duplicates | Mock two rows; assert latest selected (integration) |

---

## 4. Profile page landing views (account switch targets)

### What is covered (source inspection)

| Area | Assertions |
|------|------------|
| Welcome/bootstrap card only when `showOwnerBootstrapSetup` | Bootstrap card slice, mutual exclusivity with carrier card |
| `isProfileBootstrap` derived from `needsPrimaryOwnerBootstrap` | Symbol + mount effect regex |
| Roster/membership fetch imports and state | `fetchLinkedTeamMemberRoster`, `linkedRosterProfile`, `resolveActorProfile` |
| `effectiveOwnProfile` drives permissions, landing badges, team section | Widespread `toContain` |
| `loadTeamData` refresh after mutations | Multiple `await loadTeamData(..., effectiveOwnProfile)` |
| Dev switcher wiring | `DevAccountSwitcher` in `AppHeader`, switch handler order, reload after switch |
| Driver landing: Edit My Profile, role badges | Driver/admin UI slices |
| Bootstrap save welcome message | `Welcome! Your carrier account is ready.` |

### Gaps

| Priority | Gap | Risk | Suggested test |
|----------|-----|------|----------------|
| **P0** | **No slice for roster-only switch landing** — assert `showOwnerBootstrapSetup` depends on `isProfileBootstrap` which depends on gate inputs including `linkedRosterProfile` | Reintroduction of Welcome card for roster-only members | UI slice: `isProfileBootstrap` useMemo passes `linkedRoster: linkedRosterProfile` |
| **P1** | **`loadTeamData` Admin/Owner manager gate** — `hasManagementAccess(profile)` enables full org roster | Admin without `member_profiles` may not see team roster | UI slice: `shouldLoadFullOrg = ... isPrimaryOwner(profile) \|\| hasManagementAccess(profile)` |
| **P1** | **Roster-linked Admin sees team section; Driver sees limited self-service** | Role-appropriate landing is the bug report | Handler/permission contract tests using `effectiveOwnProfile` from roster hydration (unit chain or RTL) |
| **P1** | **Loading spinner covers resolution** — no bootstrap flash on switch back | UX regression manual-only | UI: `loading` gates render before `isProfileBootstrap` drives Welcome card |
| **P2** | **`showOwnerBootstrapSetup` false when `editingTarget.kind !== 'self'`** | Bootstrap card while editing team member | Existing helper test covers kind; page wiring not sliced |
| **P2** | **Negative: roster-linked actor must not render bootstrap card** | Primary regression | UI slice: when `linkedRosterProfile` set, `showOwnerBootstrapSetup` cannot be true without `shouldBootstrap` true (document invariant) |
| **P3** | **No RTL** — dropdown switch, landing badges, team roster visibility | Accepted limitation; should be explicit in manual QA | See manual checklist below |

### Account-switch view map (manual steps vs automated)

| Manual step (from impl summary) | Automated coverage |
|--------------------------------|------------------|
| 1. Owner with profile → carrier + full roster, no Welcome | ⚠️ Symbols only |
| 2. Team member with `member_profiles` → role landing | ⚠️ Permissions tested elsewhere; not switch-specific |
| 3. Roster-only member → no Welcome, correct badges | ✅ Gate unit; ❌ landing UI |
| 4. Truly new primary owner → Welcome + Owner on save | ✅ Bootstrap unit + API bootstrap tests |
| 5. Forced owner edge cases | ✅ Gate unit; ⚠️ API forced-owner tests don't combine with roster block |
| 6. Switch back, no bootstrap flash | ❌ Manual only |

---

## 5. Server save path (`team-member-profiles-api.ts`)

### What is covered

| Case | Test |
|------|------|
| Null-profile bootstrap: org creation, role clamping, forced owner | Multiple `saveTeamMemberProfileForUser` behavioral tests |
| `needsPrimaryOwnerBootstrap` + fetch helpers present in source | `saveTeamMemberProfileForUser bootstrap gate` |
| `shouldBootstrap` branches to `validateBootstrapSelfSave` / `validateBootstrapCarrierOnlySave` | Source regex |
| Non-bootstrap forced-owner `ensureBootstrapOwnerRoles` on `carrier_only` | Source regex |
| Mock infrastructure for `mockLinkedRosterMaybeSingle` / `mockMembershipLookupMaybeSingle` | `beforeEach` in `saveTeamMemberProfileForUser` |

### Gaps

| Priority | Gap | Risk | Suggested test |
|----------|-----|------|----------------|
| **P0** | **Roster-linked self-save: `shouldBootstrap === false`, org/roles from roster** | Server may still run bootstrap validation or assign Owner on first save | Behavioral: `mockMaybeSingle` → null profile; `mockLinkedRosterMaybeSingle` → `{ organization_id, user_roles: ['Driver'] }`; assert upsert payload has `organization_id`, `is_primary_owner: false`, no bootstrap validation throw |
| **P1** | **Membership-only self-save** | Same as roster path for invited users | Behavioral: membership mock only; assert org injection branch (`payload.organization_id = membership.organization_id`) |
| **P1** | **`syncOrganizationMembershipForMember` after non-bootstrap roster save** | Membership table out of sync | Assert `organization_memberships.upsert` in call order when linked roster present |
| **P1** | **Role injection when form roles empty** — `else if (!actorProfile?.organization_id && (linkedRoster \|\| organizationMembership))` | First save loses roster roles | Behavioral: empty `user_roles` in form → payload gets roster roles |
| **P2** | **Forced owner + linked roster → no bootstrap** | Forced owner could still bootstrap via `saveScope === 'carrier_only' && forcedCarrierOwner` branch | Behavioral: forced email + roster mock + null profile |
| **P2** | **`validateBootstrapSelfSave` not called when roster-linked** | False validation errors for team members | Spy/assert no throw on minimal driver fields for roster-linked save |

### Server path wiring map

| Branch | Implementation | Behavioral test |
|--------|----------------|-----------------|
| `shouldBootstrap` → bootstrap validation | ✅ Source | ✅ Null profile |
| `!shouldBootstrap` + roster/membership → org/roles injection | ✅ Source | ❌ |
| `payload.organization_id` backfill from roster/membership | ✅ Source | ❌ |
| `syncOrganizationMembershipForMember` after save | ✅ Source | ❌ |
| Forced owner off-bootstrap `ensureBootstrapOwnerRoles` | ✅ Source | ⚠️ Partial |

---

## 6. Dev account switch (`dev-account-switch.ts`, switcher UI)

### What is covered

| Case | Test |
|------|------|
| `verifyOtp` token_hash exchange | `dev-account-switch.test.ts` |
| `resolveDevSwitchOrganizationId` prefers `member_profiles` | Unit |
| Roster `linked_user_id` over `driver_email` | Unit |
| Email fallback when no linked row | Unit |
| Allowlist from admin roster + member profiles | Unit |
| Persona localStorage persist/clear | Unit |
| Switch-user route avoids `getAuthenticatedMemberProfile` | `route.test.ts` + regression slice |
| Switcher: reload order, switch-back, roster row lookup for current user | `profile-ui.test.ts` |

### Gaps

| Priority | Gap | Risk | Suggested test |
|----------|-----|------|----------------|
| **P1** | **`resolveDevSwitchOrganizationId` ignores `organization_memberships`** | Switcher org context wrong for membership-only users; may affect allowlist/org-scoped features | Unit: add membership lookup or document intentional divergence; test profile vs switcher parity |
| **P2** | **End-to-end switch → profile gate** — no test connects switch completion to profile initial load | Switch works but profile still bootstraps | Integration test or documented manual QA (primary) |
| **P2** | **`DevAccountSwitcher` has no dedicated test file** | Regressions only caught via `profile-ui` import wiring | Optional `DevAccountSwitcher.test.ts` for handler slices |
| **P3** | **Switch-back clears persona before reload** | Stale persona email | Covered in switcher slice; no runtime test |

---

## 7. Test quality & methodology

### Strengths

- **`needsPrimaryOwnerBootstrap` is the single source of truth** — tested with all manual-verification personas at unit level.
- **Regression guard** explicitly forbids old `!ownProfile` mount bootstrap in `profile-ui.test.ts`.
- **Roster fetch precedence** (`linked_user_id` before email) tested in both `roster-profile-link` and `dev-account-switch`.
- **Bootstrap API path** has substantial behavioral coverage for true new owners and forced owner.
- **Profile UI tests** follow established slice patterns (`bootstrapSetupCardSlice`, `handleSaveCarrierInfoSlice`) and document RTL limitation in file header.

### Weaknesses

1. **Mocks wired but unused** — `team-member-profiles-api.test.ts` sets up linked roster/membership mocks but never exercises non-null paths.
2. **UI tests stop at symbol presence** for the fix’s critical load branch (parallel fetch → gate → landing vs Welcome).
3. **Membership-only hydration** missing from `resolveActorProfile` unit tests.
4. **Dev switch org resolution** narrower than profile page resolution — latent inconsistency.
5. **No render harness** — account-switch landing views remain manual QA.

---

## 8. Recommended test additions (minimal high-ROI set)

If adding only **6 tests**:

1. **Unit:** `resolveActorProfile(null, null, 'user-1', { organization_id: 'org-1', role: 'Admin' })` → Admin profile shape.
2. **Behavioral API:** Roster-linked self-save (null `member_profiles`, roster mock with `organization_id` + `user_roles`) → upsert payload has org, `is_primary_owner: false`, skips bootstrap validation.
3. **Behavioral API:** Membership-only self-save → org injected, `syncOrganizationMembershipForMember` called.
4. **UI slice:** Profile auth-load `else` branch — `Promise.all` fetch, `shouldBootstrap` false → `loadTeamData(supabase, ..., actorProfile)` without `ensureBootstrapOwnerRoles` in that branch.
5. **UI slice:** `loadTeamData` `shouldLoadFullOrg` includes `hasManagementAccess(profile)` (Admin roster visibility).
6. **Unit or dev-switch:** Document/test org resolution parity — `organization_memberships` fallback or explicit comment that profile page handles it post-reload.

---

## 9. Suggested follow-up checklist

- [ ] Add behavioral `saveTeamMemberProfileForUser` tests with non-null `mockLinkedRosterMaybeSingle` / `mockMembershipLookupMaybeSingle`.
- [ ] Add `resolveActorProfile` membership-only unit test.
- [ ] Add profile `page.tsx` source slices for initial-load bootstrap vs team-member branches.
- [ ] Add `hasManagementAccess` / `shouldLoadFullOrg` UI slice.
- [ ] Add post-save `setLinkedRosterProfile(null)` / `setOrganizationMembership(null)` UI slices.
- [ ] Reconcile or document `resolveDevSwitchOrganizationId` vs profile `fetchOrganizationMembershipForUser`.
- [ ] Run manual dev-switch checklist (steps 1–6 in impl summary) before closing ticket.
- [ ] (Future) RTL harness for switch → profile landing once adopted project-wide.

---

## Verdict

**Approve unit gate logic; do not treat green suite as proof of account-switch landing correctness.**

`needsPrimaryOwnerBootstrap` and the forced-owner/roster-linked cases are well covered at the pure-function layer, and regressions against the old `!ownProfile` bootstrap trigger are guarded in UI source tests. The **highest-risk gap** is the absence of **behavioral API and UI slices for roster-linked and membership-only actors** — the exact scenario that motivated the fix. Dev-switch tests cover org resolution for roster rows but **not `organization_memberships`**, which may matter for membership-only team members.

**Status:** open — coverage gaps documented; no code changes made.