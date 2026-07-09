# Security Review: `canActorSaveCarrierOnlyScope` Owner/Admin Expansion

**Scope:** `lib/team-member-profiles-api.ts`, `lib/member-profile.ts`, `app/profile/page.tsx`, migrations `020`, `023`  
**Date:** 2026-07-07  
**Criteria:** Exploitable issues only (cross-tenant access, privilege escalation, auth bypass, attacker-actionable data exposure)

---

## Open exploitable issues

**No open issues.**

Verified 2026-07-07:

- `canActorSaveCarrierOnlyScope` allows stored Owner/Admin and bootstrap (no org) with Owner/Admin in form; for existing non–primary-owner profiles, `selfSaveFormForActor` substitutes DB roles before gate checks, so form-injected Owner/Admin cannot bypass the server.
- Org-linked Drivers and Viewers are denied (`canActorSaveCarrierOnlyScope` / `canWriteTeamData`).
- Non–primary-owner Owner/Admin may pass the API gate but cannot write carrier fields, roles, or `is_primary_owner`: trigger `023` reverts guarded columns; trigger `020` blocks privileged-column self-service; unique index `idx_member_profiles_one_primary_owner_per_org` prevents duplicate primaries.
- `organization_id` remains server-derived (`prepareMemberProfileSave`); not accepted from the client form.