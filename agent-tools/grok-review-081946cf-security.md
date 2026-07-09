# Security Review: Auto Owner/Admin Bootstrap

**Scope:** `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`, `lib/member-profile-permissions.ts`, `supabase/migrations/020_member_profiles_privileged_columns.sql`, `supabase/migrations/023_member_profiles_self_service_field_guard.sql`  
**Focus:** Implicit `Owner / Admin` injection (`ensureBootstrapOwnerAdminRoles`), carrier bootstrap save path, removal of self-service role checkboxes  
**Implementation ref:** `agent-tools/grok-impl-summary-081946cf.md`  
**Date:** 2026-07-07

---

## Summary

Reviewed the carrier-save fix that auto-assigns `Owner / Admin` during bootstrap (client mount, client carrier save, and server `carrier_only` path) and hides the self-service User Roles checkbox section. **No open exploitable issues.**

The change intentionally relaxes the prior requirement that users explicitly select `Owner / Admin` before org creation. Auto-injection is scoped to users **without an `organization_id`**; org-linked accounts retain existing role-locking and carrier-scope gates from prior rounds.

---

## Bootstrap role injection flow (verified)

| Layer | When injection runs | Gate |
|-------|---------------------|------|
| **Client mount** | `useEffect` when `!ownProfile && editingTarget.kind === 'self'` | First visit only (no DB row) |
| **Client carrier save** | `handleSaveCarrierInfo` → `ensureBootstrapOwnerAdminRoles` before validation/payload | `canWriteTeamData` + `canSaveCarrierInfo` |
| **Server carrier save** | `saveTeamMemberProfileForUser` when `save_scope === 'carrier_only' && (!actorProfile \|\| !actorProfile.organization_id)` | `canWriteTeamData` → bootstrap validation → `canActorSaveCarrierOnlyScope` |
| **API payload builder** | `buildCarrierOnlyApiSavePayload` when `!existing?.organization_id && !existing?.is_primary_owner` | Skipped once profile is org-linked or already primary owner |

`ensureBootstrapOwnerAdminRoles` prepends `Owner / Admin` (deduped) after `validateUserRoles` filtering — invalid role strings are stripped before injection.

---

## Carrier-only save matrix

| Actor state | UI carrier save | API `carrier_only` | Role outcome |
|-------------|-----------------|-------------------|--------------|
| **No profile (bootstrap)** | Allowed; roles auto-injected | Allowed; server injects roles | New org + `is_primary_owner: true` (by design) |
| **Profile, no org, DB `Owner / Admin`** | Allowed | Allowed | Bootstrap org creation |
| **Profile, no org, DB `Driver` only** | Carrier card hidden (`shouldShowCarrierInformationCard`); save not reachable via normal UI | Allowed if caller POSTs `carrier_only`; server injects `Owner / Admin` | Bootstrap org + primary-owner promotion (API-only for anomalous rows) |
| **Profile, no org, `is_primary_owner: true`** | Allowed | Allowed | `shouldBootstrapOrganization` true even without form roles |
| **Org-linked Driver** | Blocked (`canSaveCarrierInfo` / hidden card) | Blocked (`canActorSaveCarrierOnlyScope` → 403) | DB roles preserved |
| **Org-linked Viewer** | Blocked (`canWriteTeamData`) | Blocked (`Forbidden – viewer accounts cannot edit profiles`) | No write |
| **Org-linked non–primary-owner `Owner / Admin`** | Allowed (role in DB) | Allowed | Carrier fields only; roles from DB |
| **Primary owner** | Allowed | Allowed | Org preserved; `buildCarrierOnlySavePayload` ignores smuggled form roles when `existing.organization_id` set |

---

## Attack paths evaluated

| Scenario | Result |
|----------|--------|
| **New signup bootstraps org without selecting roles in UI** | **Allowed by design** — mount + save injection; server mirrors client |
| **Org-linked Driver smuggles `user_roles: ['Owner / Admin']` in `carrier_only` POST** | **Blocked** — `selfSaveFormForActor` substitutes DB roles; `buildCarrierOnlySavePayload` keeps DB roles when `existing.organization_id` set; server skips `ensureBootstrapOwnerAdminRoles` when org present |
| **Org-linked Viewer → `carrier_only` save** | **Blocked** — `canWriteTeamData` on API (`lib/team-member-profiles-api.ts:206–208`) |
| **Bootstrap POST with empty / omitted `user_roles`** | **Allowed** — server `ensureBootstrapOwnerAdminRoles` + `validateBootstrapCarrierSaveRoles` pass after injection; creates own org (not cross-tenant) |
| **Tamper `organization_id` in POST body to join another org** | **Blocked** — `prepareMemberProfileSave` derives org from DB actor or generates new UUID; migration `020` blocks self-service org reassignment |
| **Bootstrap into existing org UUID** | **Blocked** — trigger `020` requires `NOT member_profile_org_already_exists(NEW.organization_id)` |
| **Non–primary-owner self-update `user_roles` via `member_only` / `full`** | **Blocked** — `selfSaveFormForActor` locks roles; DB trigger `023` reverts `user_roles` to `OLD` |
| **Org-less Driver promotes via `carrier_only` (direct API)** | **Allowed for own account only** — bootstrap UPDATE sets `is_primary_owner: true`, bypassing `023` role freeze intentionally; user creates a **new** org, does not infiltrate an existing tenant |
| **Remove role checkboxes → self-demote from Owner / Admin during bootstrap** | **Not possible** — implicit assignment only; non–primary-owners cannot self-edit roles (`canSelfEditRoles`) |
| **Cross-user `target_user_id` / roster IDOR** | **No regressions** — unchanged primary-owner enforcement on non-self paths |

---

## Areas reviewed

| Area | Assessment |
|------|------------|
| **Privilege escalation within an existing org** | Not exploitable; injection and form-role merge gated on missing `organization_id`. |
| **Viewer write / role escalation** | Not exploitable; viewer gate precedes bootstrap logic. |
| **Client-only trust (UI hides roles)** | Not exploitable; server applies matching `ensureBootstrapOwnerAdminRoles` before upsert. |
| **DB privileged-column / field guards** | Still sound; one-time bootstrap UPDATE with `is_primary_owner: true` correctly bypasses `023` freeze. |
| **Implicit bootstrap copy / badge UX** | Display-only; no authorization impact. |
| **Org-less partial profile API bootstrap** | Reviewed; acceptable by design for onboarding recovery. UI does not expose carrier save when DB roles lack `Owner / Admin` and user is not primary owner. Direct API call only affects the caller's own row. |

---

## Change vs. prior review (`grok-review-fcd8976b-security.md`)

Prior review stated bootstrap without explicit `Owner / Admin` was blocked by `validateBootstrapCarrierSaveRoles`. **That gate is now intentionally bypassed** via `ensureBootstrapOwnerAdminRoles` running first. This is a product/onboarding change, not a cross-tenant or org-member escalation vector, because it applies only when the actor has no `organization_id`.

---

## No open issues

Auto Owner/Admin bootstrap does not introduce exploitable cross-tenant access, org-member privilege escalation, or auth bypass. Org-linked Driver/Viewer protections from rounds 2–4 remain intact.

---

## Severity counts

| Severity | Open count |
|----------|------------|
| bug (critical) | 0 |
| bug (high) | 0 |
| bug (medium) | 0 |
| suggestion (medium) | 0 |
| nit (low) | 0 |
| **Total open exploitable** | **0** |