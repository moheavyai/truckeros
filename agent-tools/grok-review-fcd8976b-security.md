# Security Final Re-Review: Carrier Save Logging & `organization_id` in Payload

**Scope:** `buildCarrierOnlyApiSavePayload`, `[carrier-save]` logging, bootstrap `carrier_only` permission, UI gate changes (`app/profile/page.tsx`, `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `supabase/migrations/020_member_profiles_privileged_columns.sql`)  
**Criteria:** Exploitable issues only (cross-tenant access, privilege escalation, auth bypass, attacker-actionable data exposure)  
**Date:** 2026-07-07

---

## Summary

Final re-review of the carrier save fix. All previously noted hygiene items (unconditional debug logging) are now closed. **No open exploitable issues.**

---

## Attack paths re-verified (all safe)

| Scenario | Result |
|----------|--------|
| Tamper `organization_id` in POST JSON to join another org | **Blocked:** `parseMemberProfileForm()` does not read `organization_id`; `prepareMemberProfileSave()` sets it from DB `actorProfile` or server-generated UUID on bootstrap only |
| Inject `organization_id` via form fields | **Blocked:** `MemberProfileFormData` omits `organization_id`; `buildCarrierOnlyApiSavePayload` copies from `existing` only |
| Self-update to change `organization_id` | **Blocked:** `prepareMemberProfileSave` preserves existing org; DB trigger `enforce_member_profile_privileged_columns` raises on change |
| Bootstrap into an existing org UUID | **Blocked:** server generates new UUID; trigger allows bootstrap only when `NOT member_profile_org_already_exists(NEW.organization_id)` |
| Non–primary-owner `carrier_only` save (API) | **Blocked:** `canActorSaveCarrierOnlyScope` → 403 before upsert |
| Viewer / read-only `carrier_only` save | **Blocked:** `canWriteTeamData` on API; client handler also gates |
| Bootstrap `carrier_only` without Owner/Admin to create org | **Blocked:** client `validateBootstrapCarrierSaveRoles`; server `shouldBootstrapOrganization` requires Owner / Admin role |
| Existing Viewer/Driver role escalation via carrier save | **Blocked:** `selfSaveFormForActor` + `buildCarrierOnlySavePayload` preserve DB roles when `existing` is set |
| `[carrier-save]` logs expose other tenants' data | **Not exploitable:** logs are dev-only (`NODE_ENV === 'development'`); no tokens, EIN, CDL, or credentials; no cross-user log endpoint |
| UI `showSaveCarrierInfoButton` gate relaxation | **Not exploitable:** server auth unchanged; writes remain server-gated |

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
| **Total open exploitable** | **0** |