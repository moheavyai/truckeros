# Security Review: User Roles Section Always Visible (Own Profile)

**Scope:** `lib/member-profile.ts` (`shouldShowUserRolesSection`), `app/profile/page.tsx` (`UserRolesCheckboxGrid`, dedicated User Roles section), `app/profile/profile-ui.test.ts`  
**Date:** 2026-07-07  
**Criteria:** Exploitable issues only (cross-tenant access, privilege escalation, auth bypass, attacker-actionable data exposure)

---

## Summary

Reviewed the UX refactor that moves own-profile role checkboxes into a dedicated **User Roles** section (always shown when `editingTarget.kind === 'self'`), while team-member roles remain in the member edit card. The change is **presentation-only**: shared form state, `toggleRole`, save handlers, and server authorization are unchanged. **No open exploitable issues.**

---

## What changed (security-relevant)

| Layer | Before | After |
|-------|--------|-------|
| **Visibility** | Own-profile roles inside member edit card (hidden on landing when card hidden) | Own-profile roles in standalone section whenever editing self (including bootstrap / landing) |
| **Authorization props** | `canEditRoles`, `canWriteProfile`, `disabled` on checkboxes | Same props on extracted `UserRolesCheckboxGrid` |
| **`toggleRole` guard** | `canSelfEditRoles(ownProfile)` | Unchanged |
| **Save paths** | `handleSave` / `handleSaveCarrierInfo` use shared `form.user_roles` | Unchanged; carrier bootstrap still reads roles from shared form snapshot |
| **Server** | `selfSaveFormForActor`, `buildCarrierOnlySavePayload`, DB triggers `020` / `023` | No changes in this diff |

`shouldShowUserRolesSection` returns `editingTarget.kind === 'self'` only — it does not bypass any permission function and is not referenced server-side.

---

## Attack paths evaluated

| Scenario | Result |
|----------|--------|
| **Non–primary-owner self-edit → UI toggle Owner / Admin** | **Blocked:** `canSelfEditRoles` false when `is_primary_owner` false; checkboxes `disabled={!canEditRoles \|\| !canWriteProfile \|\| disabled}`; `toggleRole` returns early |
| **Non–primary-owner → API smuggle `user_roles` via Save Profile** | **Blocked:** `selfSaveFormForActor` substitutes DB `user_roles` when `!canSelfEditRoles(actorProfile)` (`lib/team-member-profiles-api.ts:149–155`) |
| **Non–primary-owner → API smuggle roles via `save_scope: carrier_only`** | **Blocked:** `buildCarrierOnlySavePayload` ignores form roles when `existing.organization_id` is set (`lib/member-profile.ts:122–124`); `selfSaveFormForActor` also preserves DB roles |
| **Direct Supabase self-`UPDATE` on `user_roles`** | **Blocked:** trigger `enforce_member_profile_self_service_restricted_fields` reverts `user_roles` to `OLD` for non–primary-owner self-updates (`023_member_profiles_self_service_field_guard.sql:30–33`) |
| **Viewer → edit roles or carrier** | **Blocked:** `canWriteTeamData` false; API throws before upsert (`lib/team-member-profiles-api.ts:205–207`) |
| **Bootstrap first visit → select Owner / Admin + Save Carrier Info** | **Allowed by design:** null `actorProfile` / `ownProfile`; `canSelfEditRoles(null)` and `canWriteTeamData(null)` true; `validateBootstrapCarrierSaveRoles` + `shouldBootstrapOrganization` gate org creation — same as pre-refactor bootstrap path |
| **Bootstrap without Owner / Admin → carrier save** | **Blocked:** `validateBootstrapCarrierSaveRoles` client + server (`lib/team-member-profiles-api.ts:216–219`) |
| **Org-linked Driver/Viewer → escalate via detached User Roles section** | **Not exploitable:** section only surfaces UI; writes still server-gated and DB-guarded as above |
| **Primary owner → edit other member roles via detached section** | **Not applicable:** `shouldShowUserRolesSection` false for `member_profile` / `team_member_profile` targets; team roles stay in member card with same `canEditRoles` (actor primary-owner check) and server `isPrimaryOwner` gate (`lib/team-member-profiles-api.ts:265–267`) |
| **Cross-tenant role visibility** | **Not exploitable:** section shows only the signed-in user's own `form.user_roles`; no new data fetch or cross-user ID |

---

## Information disclosure note (not exploitable)

Landing self-view users (e.g. Driver) now see a disabled **User Roles** section with their own role checkboxes. This reveals only the actor's own roles and the app's public role enum (`USER_ROLE_OPTIONS`). No cross-user or cross-tenant data is exposed; not attacker-actionable under the review criteria.

---

## Open exploitable issues

**No open issues.**

Verified 2026-07-07:

- `UserRolesCheckboxGrid` preserves `disabled={!canEditRoles \|\| !canWriteProfile \|\| disabled}` and `toggleRole` still requires `canSelfEditRoles(ownProfile)`.
- Own-profile role edits persist only through existing API save flows (`buildSavePayloadForTarget` → `/api/team-member-profiles`); no new client-side write path.
- Server role substitution (`selfSaveFormForActor`), carrier-only role merge scoping (`!existing \|\| !existing.organization_id`), and DB self-service field guard (`023`) remain intact and unchanged by this refactor.

---

## Severity counts

| Severity | Open count |
|----------|------------|
| bug (critical) | 0 |
| bug (high) | 0 |
| bug (medium) | 0 |
| **Total open exploitable** | **0** |