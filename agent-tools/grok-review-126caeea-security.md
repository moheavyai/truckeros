# Security Final Review (Round 3): Driver Restrictions, Change Requests & `carrier_only` Gate

**Scope:** `lib/team-member-profiles-api.ts`, `lib/profile-change-requests.ts`, `lib/profile-field-permissions.ts`, `app/api/profile-change-requests/route.ts`, `app/api/team-member-profiles/route.ts`, `supabase/migrations/019_team_member_profiles.sql`, `supabase/migrations/020_member_profiles_privileged_columns.sql`, `supabase/migrations/022_profile_change_requests.sql`, `supabase/migrations/023_member_profiles_self_service_field_guard.sql`  
**Focus:** Driver restricted-field enforcement, profile-change-request API safety, `carrier_only` privilege gate, DB-level self-update defense  
**Date:** 2026-07-07

---

## Summary

Round 3 re-checked all focus areas after migration `023_member_profiles_self_service_field_guard.sql` landed. **No open exploitable issues.**

The previously reported PostgREST self-`UPDATE` bypass is **closed** at the database layer. API, change-request, and RLS paths remain sound.

---

## Verified closed (round 2 → round 3)

| Issue (round 2) | Round 3 status | Evidence |
|-----------------|----------------|----------|
| Direct Supabase self-`UPDATE` bypasses driver restrictions and role locking | **Closed** | `enforce_member_profile_self_service_restricted_fields` (`023_member_profiles_self_service_field_guard.sql:8–82`) freezes `user_roles`, all eight carrier columns, and all four `DRIVER_RESTRICTED_FIELD_KEYS` to `OLD` on non–primary-owner self-updates; primary-owner / cross-user / service-role writes bypass intentionally |
| Driver `save_scope: 'full'` smuggles carrier fields | **Closed** | `selfSaveFormForActor` forces `member_only` for drivers on `full`, then strips carrier (`lib/team-member-profiles-api.ts:136–149`) |
| Driver `save_scope: 'carrier_only'` without primary-owner gate | **Closed** | Rejected before save: `Forbidden – only primary owners can save carrier-only updates` (`lib/team-member-profiles-api.ts:188–191`) |
| Change-request POST trusts client `baseline_profile` | **Closed** | `submitProfileChangeRequests` defaults to `memberProfileFromRow(actor)` (`lib/profile-change-requests.ts:169`) |
| `profile_change_requests` INSERT lacks `field_key` allowlist | **Closed** | DB `CHECK` (`022_profile_change_requests.sql:10–11`) + `assertAllowedProfileChangeFieldKey` |
| Duplicate pending change requests | **Closed** | Partial unique index `idx_profile_change_requests_pending_dedupe` + `replacePendingProfileChangeRequests` delete-before-insert |
| `profile_change_requests` UPDATE policy missing `WITH CHECK` | **Closed** | Migration 023 recreates primary-owner UPDATE policy with matching `USING` / `WITH CHECK` (`023:99–120`) |

---

## Attack paths re-verified (all safe)

| Scenario | Result |
|----------|--------|
| Driver → direct PostgREST `UPDATE` with escalated `user_roles` | **Blocked:** trigger reverts `user_roles` to `OLD` |
| Driver → direct PostgREST `UPDATE` with carrier / restricted identity fields | **Blocked:** trigger reverts all guarded columns to `OLD` |
| Driver → direct PostgREST `UPDATE` with contact fields (`driver_phone`, `driver_email`, `emergency_contact`) | **Allowed:** intentional self-service contact edits |
| Driver → API `full` save + smuggled `user_roles` / carrier | **Blocked:** API scope stripping + role substitution from DB |
| Driver → API `carrier_only` save | **Blocked:** 403 at `saveTeamMemberProfileForUser` |
| Driver → POST change requests (API or PostgREST) | **Safe:** driver-only + self-only asserts; server baseline; allowlisted `field_key` |
| Driver → PATCH approve own change request | **Blocked:** RLS requires `is_primary_owner` |
| Driver → DELETE another user's pending request | **Blocked:** DELETE policy requires `requester_user_id = target_user_id = auth.uid()` and `status = 'pending'` |
| Non–primary-owner → self-update `organization_id` / `is_primary_owner` | **Blocked:** `enforce_member_profile_privileged_columns` (`020`) |
| Primary owner → approve change request for org driver | **Safe:** cross-user update bypasses self-service guard; org-scoped approve path |
| Viewer → API profile write | **Blocked:** `canWriteTeamData` |

---

## Open issues

**No open issues.**

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

---

## Deploy note

Apply migration `023_member_profiles_self_service_field_guard.sql` before production deploy so the DB self-service field guard is active in the target environment.