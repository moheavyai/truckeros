# Merged Review — Bootstrap Carrier Fix

## Bugs

### Issue 1 — bug
- Client allows carrier save when profile exists without org + Owner/Admin only in form; server rejects (bootstrap validation only when !actorProfile)
- Fix: Run validateBootstrapCarrierSaveRoles on server when !actorProfile OR !actorProfile.organization_id; expand canActorSaveCarrierOnlyScope to check form roles when no org
- **Status**: closed

### Issue 2 — bug
- canSaveCarrierInfo treats any organization_id as sufficient; org Drivers see carrier UI but server rejects
- Fix: Align canSaveCarrierInfo with server — require isPrimaryOwner OR Owner/Admin in DB roles OR bootstrap (no profile/no org) with Owner/Admin in form
- **Status**: closed

### Issue 3 — bug
- is_primary_owner promotion on UPDATE blocked by DB trigger 020 — remove client-side promotion path or document as admin-only
- Fix: Only set is_primary_owner on INSERT/bootstrap (no existing row); for existing row without org, use upsert that creates org on first carrier save with null actor treated as insert path
- **Status**: closed

### Issue 4 — suggestion
- Collapse button gated on primaryOwner not canManageCarrier
- **Status**: closed

### Issue 5 — suggestion
- Server bootstrap role check error message stale
- **Status**: closed

### Issue 6 — suggestion
- profile-ui tests missing canManageCarrier wiring
- **Status**: closed

### Issue 7 — suggestion
- buildCarrierOnlySavePayload drops form roles for existing rows without org — merge roles when !existing.organization_id
- **Status**: closed

---

## Implementation Summary

### Changes

| File | Fix |
|------|-----|
| `lib/member-profile.ts` | `canSaveCarrierInfo` aligned with server: primary owner, persisted Owner/Admin, or bootstrap (no org + form Owner/Admin). `buildCarrierOnlySavePayload` preserves form roles when `!existing.organization_id`. `prepareMemberProfileSave` sets `is_primary_owner` only on bootstrap path (no org), not on org UPDATE. |
| `lib/team-member-profiles-api.ts` | `canActorSaveCarrierOnlyScope(actor, form)` accepts form Owner/Admin when profile lacks org. Bootstrap role validation runs when `!actorProfile \|\| !actorProfile.organization_id`. Error message updated to include Owner/Admin accounts. |
| `app/profile/page.tsx` | Collapse button gated on `canManageCarrier` instead of `primaryOwner`. |
| `lib/member-profile.test.ts` | Updated `canSaveCarrierInfo`, `buildCarrierOnlySavePayload`, `prepareMemberProfileSave` tests; org-linked Driver blocked. |
| `lib/team-member-profiles-api.test.ts` | Added bootstrap form-role test; updated bootstrap gate source inspection and error message. |
| `app/profile/profile-ui.test.ts` | Asserts `canManageCarrier` wiring for edit/save/collapse buttons; updated server bootstrap gate regex. |

### Test Run

```
npx vitest run app/profile/profile-ui.test.ts lib/member-profile.test.ts lib/team-member-profiles-api.test.ts lib/profile-persistence.test.ts
```

**Result:** 4 files, **127/127 passing** (profile-ui 32, member-profile 68, profile-persistence 11, team-member-profiles-api 16).

### Flow After Fix

1. **First visit (no profile)** — select Owner/Admin → carrier save bootstraps org + `is_primary_owner`.
2. **Partial profile (row, no org)** — select Owner/Admin in form → client and server both allow carrier save; form roles flow through payload.
3. **Org-linked Driver** — `canSaveCarrierInfo` returns false; carrier edit/save/collapse hidden; server rejects if attempted.
4. **Primary owner / persisted Owner/Admin** — carrier rename and field updates unchanged.
5. **Org member without primary flag** — no client-side `is_primary_owner` promotion on UPDATE (DB trigger safe).