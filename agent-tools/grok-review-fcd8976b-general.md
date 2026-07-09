# Code Review: Carrier Information Save Fix — General Pass (Final Verify)

**Scope:** `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`, related tests  
**Reference:** `agent-tools/grok-review-fcd8976b.md`, `agent-tools/grok-impl-summary-fcd8976b.md`  
**Focus:** Final verification of merged-review fixes; open issues only (no fixes applied)

**Tests:** **119/119** passing — `member-profile.test.ts` (62), `profile-ui.test.ts` (32), `profile-persistence.test.ts` (11), `team-member-profiles-api.test.ts` (14)

---

## Open Issues

_No open issues._

---

## Resolved (this pass)

### 1 — `saveTeamMemberProfileForUser` mocked async guards
- **Was:** suggestion — async orchestration lacked direct mocked-Supabase tests for viewer self-save rejection and non–primary-owner `carrier_only` Forbidden.
- **Fixed:** `lib/team-member-profiles-api.test.ts` — `describe('saveTeamMemberProfileForUser')` with mocked `@supabase/supabase-js` client; asserts both Forbidden paths throw before `upsert` is called.

### 2 — Profile UI RTL limitation documented in tests
- **Was:** suggestion — UI tests remain static source-text assertions.
- **Fixed (accepted limitation):** `app/profile/profile-ui.test.ts:64–79` — explicit test `documents source-only inspection as accepted RTL limitation without a render harness` asserts file header and absence of `@testing-library/react` / `render(` in `page.tsx`.

---

## Summary

| Severity | Open count |
|----------|------------|
| bug | 0 |
| suggestion | 0 |
| nit | 0 |
| **Total open** | **0** |

**Verdict:** All bugs, nits, and suggestions from prior general passes are resolved. Bootstrap carrier save, server-side role gate, `organization_id` handling (shared `prepareMemberProfileSave` path + JSDoc), dev-gated `[carrier-save]` logging, `carrierSaveInFlight` UI lock, form snapshot isolation, client `orgMatch` logging, mocked async save guards, and documented RTL limitation are verified fixed.