# Security Re-Review (Round 4): Bootstrap Roles in Carrier Save

**Scope:** `app/profile/page.tsx`, `app/api/team-member-profiles/`, `lib/team-member-profiles-api.ts`, `lib/member-profile.ts`, `lib/member-profile-permissions.ts`  
**Focus:** Bootstrap `user_roles` merged into `save_scope: carrier_only` must not allow Viewer privilege escalation  
**Date:** 2026-07-07

---

## Summary

Round 4 examined whether bootstrap role inclusion in carrier-only saves (`buildCarrierOnlySavePayload` when `existing` is null) re-opens Viewer write or role-escalation paths. The carrier bootstrap role merge is **scoped to first-visit profile creation only**. Established Viewer accounts are blocked before carrier-scope logic runs, and existing profiles never accept role changes from the carrier save payload.

---

## Carrier-only save flow (verified)

| Step | Bootstrap (`actorProfile` / `ownProfile` null) | Existing Viewer profile |
|------|-----------------------------------------------|-------------------------|
| **UI gate** | `canWriteTeamData(null)` → `true`; carrier card shown (`isProfileBootstrap`) | `canWriteTeamData(viewer)` → `false`; `handleSaveCarrierInfo` returns early (`app/profile/page.tsx:579`) |
| **UI primary-owner gate** | `ownProfile && !isPrimaryOwner` skipped when null | Viewer is not primary owner; would also block even if write gate passed (`:580`) |
| **API write gate** | Skipped when `actorProfile` is null (`lib/team-member-profiles-api.ts:166`) | `Forbidden – viewer accounts cannot edit profiles` |
| **Role merge in `selfSaveFormForActor`** | `rolesAllowed = true` when `!actorProfile`; submitted roles used (`:123–129`) | `rolesAllowed = false`; DB `user_roles` substituted before scope logic |
| **`buildCarrierOnlySavePayload`** | Merges `user_roles` from form when `!existing` (`lib/member-profile.ts:122–124`) | Roles taken from `memberProfileFromRow(existing)`; form roles ignored (`:117–118`, test at `lib/member-profile.test.ts:376–388`) |
| **`prepareMemberProfileSave`** | May bootstrap org when roles include Owner / Admin | No role change possible via carrier path |

Bootstrap role inclusion applies only when no `member_profiles` row exists. A Viewer account always has a row carrying `user_roles: ['Viewer']`, so the bootstrap role-merge branch does not apply to Viewers.

---

## Viewer escalation attack paths evaluated

| Scenario | Result |
|----------|--------|
| **Existing Viewer → UI Save Carrier Info** | Blocked by `!canWriteTeamData(ownProfile)` |
| **Existing Viewer → API `POST` with `save_scope: carrier_only` + smuggled `user_roles`** | Blocked at API write gate before `selfSaveFormForActor` / `applySelfSaveScope` |
| **Existing Viewer → API `save_scope: carrier_only` (carrier fields only)** | Blocked at API write gate |
| **Existing non–primary-owner (e.g. Driver) → carrier save with smuggled roles** | `selfSaveFormForActor` overwrites roles from DB; `buildCarrierOnlySavePayload` preserves existing roles when `existing` is set |
| **Existing primary owner → carrier save with smuggled roles** | `buildCarrierOnlySavePayload` ignores form `user_roles` when `existing` is set; roles remain from DB snapshot |
| **Bootstrap first visit → carrier save with Owner / Admin** | Allowed by design for org onboarding; user is not yet a Viewer |
| **Bootstrap → carrier save with Viewer, then second carrier save to escalate** | Second save sees existing profile; Viewer write gate blocks |
| **Bootstrap → carrier save with Driver/Owner roles after owner deleted profile** | Requires primary-owner DELETE first; user no longer Viewer in `member_profiles` |

---

## Areas reviewed — no exploitable issue found

| Area | Assessment |
|------|------------|
| **Viewer escalation via carrier bootstrap roles** | Not exploitable; bootstrap role merge gated on `!existing` / null `actorProfile`. |
| **Viewer write via `carrier_only` scope** | Viewer check runs before `normalizeSaveScope` / `applySelfSaveScope`. |
| **Role smuggling on existing profiles** | Double protection: `selfSaveFormForActor` + `buildCarrierOnlySavePayload` both preserve DB roles. |
| **Null-profile bootstrap weakening Viewer guards** | Unchanged from round 3; still safe. |
| **Cross-user IDOR / roster / DELETE / `linked_user_id`** | No regressions identified. |

---

## No open issues

Bootstrap roles in carrier-only save do not allow Viewer escalation. Role inclusion is limited to first-visit bootstrap; established Viewer accounts remain fully blocked on both UI and API carrier save paths.

---

## Severity counts

| Severity | Open count |
|----------|------------|
| bug (critical) | 0 |
| bug (high) | 0 |
| suggestion (medium) | 0 |
| nit (low) | 0 |
| **Total open** | **0** |