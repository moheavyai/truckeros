# Code Review (Final Re-review Round 5): Profile Page UX (Carrier Mode)

**Scope:** `app/profile/page.tsx`, `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `lib/profile-persistence.ts`, tests  
**Reference:** `agent-tools/grok-review-3c36845c-general.md` (round-4 open issue: save payload snapshot race)

---

## Round 4 Fix Verification

The single round-4 issue is **verified fixed**:

| # | Fix | Verified |
|---|-----|----------|
| 1 | Save payload snapshot before await | `buildSavePayloadForTarget(target, formSnapshot, profileSnapshot)` accepts explicit snapshots; `handleSave` assigns `savePayload = buildSavePayloadForTarget(priorTarget, form, ownProfile)` at line 648 **before** `setSavingProfile(true)` and **before** `await supabase.auth.getSession()`; `saveViaApi(accessToken, savePayload)` uses the frozen payload |
| 2 | Cancel disabled during save | Cancel editing button uses `disabled={isLoadingMember \|\| isSaving}` at line 872 |
| 3 | Tests | `profile-ui.test.ts` asserts snapshot-before-await pattern and cancel disabled during save; **90/90** profile-related tests passing (profile-ui 25, member-profile 44, permissions 15, persistence 6) |

---

## Open Issues

No open issues

---

## Summary by Severity

| Severity | Open |
|----------|------|
| bug | 0 |
| suggestion | 0 |
| nit | 0 |
| **Total open** | **0** |

**Round-5 verdict:** The `handleSave` snapshot fix resolves the priorTarget / payload mismatch. Payload is frozen synchronously before any async gap; cancel and other navigation controls are gated on `isSaving`. Profile page changes are ready to ship.