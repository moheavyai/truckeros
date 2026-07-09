# Carrier Information Save Bootstrap Fix — General Review (Final Verify)

**Scope:** `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`, related tests  
**Reference:** `agent-tools/grok-impl-summary-5bcd107e.md`, `agent-tools/grok-review-5bcd107e.md`  
**Focus:** Final verification of bootstrap carrier-save fixes; open issues only

**Tests:** **127/127** passing — `member-profile.test.ts` (68), `profile-ui.test.ts` (32), `profile-persistence.test.ts` (11), `team-member-profiles-api.test.ts` (16)

```bash
npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts lib/team-member-profiles-api.test.ts lib/profile-persistence.test.ts
```

---

## Open Issues

_No open issues._

---

## Verified Fixed (this pass)

| Area | Status | Evidence |
|------|--------|----------|
| Client/server gate mismatch (partial profile, no org, Owner/Admin in form only) | **Fixed** | `canSaveCarrierInfo` allows `!profile.organization_id && hasOwnerAdminRole(form)` (`lib/member-profile.ts:170-172`); `canActorSaveCarrierOnlyScope(actor, form)` mirrors form-role bootstrap (`lib/team-member-profiles-api.ts:134-140`); server runs `validateBootstrapCarrierSaveRoles` when `!actorProfile \|\| !actorProfile.organization_id` (`lib/team-member-profiles-api.ts:212-219`); test `allows bootstrap carrier_only when profile has no org and form has Owner / Admin` |
| `canSaveCarrierInfo` broader than server (org-linked Driver) | **Fixed** | Removed bare `organization_id` branch; org-linked Driver blocked (`lib/member-profile.ts:160-174`, `lib/member-profile.test.ts:609-617`) |
| `buildCarrierOnlySavePayload` drops in-form roles for existing rows without org | **Fixed** | Merges `user_roles` when `!existing \|\| !existing.organization_id` (`lib/member-profile.ts:122-124`); tests `preserves form roles when existing profile has no organization_id` |
| `is_primary_owner` promotion on UPDATE vs DB trigger 020 | **Fixed** | `prepareMemberProfileSave` only sets `is_primary_owner` on bootstrap path (no existing `organization_id`); existing-org branch preserves flag only when already true (`lib/member-profile.ts:525-536`); test `does not promote is_primary_owner on update when existing profile has org but flag was false` |
| Bootstrap role validation scope (server) | **Fixed** | Gate runs for null actor **and** actors without `organization_id`; error message includes Owner/Admin accounts (`lib/team-member-profiles-api.ts:212-225`) |
| Collapse button gated on `primaryOwner` alone | **Fixed** | `canManageCarrier = canSaveCarrierInfo(ownProfile, form)` drives edit/save/collapse (`app/profile/page.tsx:1060,1085-1092,1180`); profile-ui asserts `canManageCarrier` wiring |
| API payload `organization_id` contract | **Fixed** | JSDoc documents server authority and logging-only client field (`lib/member-profile.ts:132-137`) |
| Owner/Admin selected before first carrier save (UI visibility) | **Fixed** | `shouldShowCarrierInformationCard(..., form)` + `canSaveCarrierInfo` + `validateBootstrapCarrierSaveRoles` in handler |
| Primary-owner second save `company_name` rename | **Fixed** | `prepareMemberProfileSave` preserves `organization_id`; rename flows through carrier payload builders |
| Member edit card after bootstrap carrier save | **Fixed** | `shouldShowMemberEditCard` + bootstrap prompt wiring unchanged and passing |
| Carrier / profile save mutual exclusion | **Fixed** | `carrierSaveInFlight` + handler early-returns |
| Dev-only `[carrier-save]` logging | **Fixed** | `logCarrierSaveDebug` / `logCarrierSaveWarn` gated on development |

### Intended flow after fix

1. **First visit (no profile)** — select Owner/Admin → carrier save bootstraps `organization_id` + `is_primary_owner`.
2. **Partial profile (row, no org)** — select Owner/Admin in form → client and server both allow carrier save; form roles flow through payload.
3. **Org-linked Driver** — `canSaveCarrierInfo` returns false; carrier edit/save/collapse hidden; server rejects if attempted.
4. **Primary owner / persisted Owner/Admin** — carrier rename and field updates unchanged.
5. **Org member without primary flag** — no client-side `is_primary_owner` promotion on UPDATE (DB trigger safe).

---

## Summary

| Severity | Open count |
|----------|------------|
| bug | 0 |
| suggestion | 0 |
| nit | 0 |
| **Total open** | **0** |

**Verdict:** All bugs and suggestions from prior general passes (`grok-review-5bcd107e-general.md` issues #1–#9, pass 2, pass 3) are resolved. Client and server carrier-save gates are aligned for bootstrap, partial-profile, and org-linked Driver scenarios. **127/127** targeted tests pass.

**Manual smoke (recommended):** development console filter `[carrier-save]`; bootstrap with Owner/Admin → verify org UUID + `is_primary_owner`; primary-owner rename → verify `organizations.name` matches new `company_name`.