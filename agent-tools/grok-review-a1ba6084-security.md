# Security Review: `team_invites` Migration 033 + Team Roster Delete/Re-invite in Edit Card

**Scope:** `supabase/migrations/033_team_invites_table.sql`, `lib/admin-migrate-team-invites.ts`, `app/api/admin/migrate/route.ts`, `scripts/apply-migrations.mjs`, `app/api/team-invites/route.ts`, `app/profile/page.tsx` (Member actions section)  
**Implementation ref:** `agent-tools/grok-impl-summary-a1ba6084.md`  
**Focus:** Migration repair path auth/DDL exposure, `team_invites` RLS completeness vs 027–029 chain, invite token handling, roster delete/re-invite authorization after UI relocation  
**Date:** 2026-07-08  
**Status:** open  
**Criteria:** Exploitable privilege escalation, cross-tenant access, auth bypass, client-only permission inflation, insecure partial-migration states

---

## Summary

Migration **033** follows the established **031 repair pattern**: idempotent DDL, admin-gated apply (`requireAdminUser` + same-origin POST + production opt-in), and schema-check-driven fallback. The `team_invites` RLS in 033 matches the org-manager policies from **027** (Owner/Admin scoped SELECT/INSERT/UPDATE). **No new exploitable issues** were found in the migration apply path itself.

Moving **Re-invite**, **Delete**, and **Request removal** from the roster table into the member edit card is a **UI-only relocation**. Authorization still flows through the same helpers (`canReinviteMember`, `canDeleteMember`, `canRequestMemberRemoval`) on the client and the existing `/api/team-invites` and `/api/team-member-profiles/[id]` DELETE handlers on the server. **Server authority is unchanged**; hiding buttons in the table does not remove enforcement.

**Residual risk** is deployment hygiene: 033 creates the table and org-manager RLS but does **not** install migration **029** RPCs or drop permissive **028** invitee policies. A live DB that already has `team_invites` from a partial 027/028 apply but never received 029 can remain in an insecure state while schema checks report the table as healthy.

---

## Attack paths verified safe

| Scenario | Result |
|----------|--------|
| Unauthenticated `POST /api/team-invites` (re-invite) | **Blocked:** 401 without Bearer token (`app/api/team-invites/route.ts:80-83`) |
| Driver/Viewer calls `POST /api/team-invites` | **Blocked:** `canManageMemberPermissions` → 403 (`route.ts:86-88`) |
| Re-invite primary owner via forged client state | **Blocked:** `canReinviteMember` rejects `is_primary_owner` (`lib/team-invite-helpers.ts:67`) |
| Re-invite with `Owner` role in payload | **Blocked:** `validateInviteRole` rejects Owner (`lib/team-invites.ts:77-79`) |
| Non-manager triggers re-invite from edit card (DevTools) | **Blocked:** `handleReinviteMember` re-checks `canManageMemberPermissions` + `canReinviteMember` (`app/profile/page.tsx:1503-1507`) |
| Permit Clerk direct-deletes member via edit card | **Blocked:** UI shows Request removal only (`allowCardRequestRemoval && !allowCardDelete`); server routes Permit Clerk to `createDeletionRequest` (`lib/team-member-profiles-api.ts:631-638`) |
| Owner/Admin delete arbitrary org member by IDOR | **Blocked:** DELETE loads actor from DB; `canDeleteMember` / `canActorRequestMemberDeletion`; queries scoped with `actorProfile.organization_id` (`team-member-profiles-api.ts:605-669`) |
| Viewer deletes member by calling DELETE API directly | **Blocked:** `canDeleteMember` requires management access or Permit Clerk path (`lib/team-permissions.ts:289-301`) |
| Cross-tenant invite list/create | **Blocked:** `organization_id` taken from authenticated actor profile, not request body (`route.ts:44-47`, `98-100`) |
| `POST /api/admin/migrate` without admin session | **Blocked:** `requireAdminUser()` (`app/api/admin/migrate/route.ts:267-270`) |
| Cross-origin CSRF on admin migrate POST | **Blocked:** `isSameOriginPostRequest` (`route.ts:263-265`) |
| Live DDL in production without opt-in | **Blocked:** `MIGRATE_ALLOW_LIVE_IN_PRODUCTION` gate (`route.ts:284-297`) |
| Non-admin runs `scripts/apply-migrations.mjs` | **Not a network attack:** requires local `SUPABASE_SERVICE_ROLE_KEY` + `DATABASE_URL` — operator credential scope |

---

## Open issues

### 1. Targeted 033 repair does not verify or apply migration 029 / removal of 028 permissive policies

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Type** | insecure partial-migration state |
| **File** | `lib/admin-migrate-team-invites.ts:29-44`, `supabase/migrations/033_team_invites_table.sql`, `supabase/migrations/028_org_manager_rls_and_invite_accept.sql:137-166`, `supabase/migrations/029_tighten_invite_accept_rls.sql` |
| **Description** | Schema checks only verify `team_invites` columns exist (`organization_id`, `invite_token`, `status`). If a live DB applied **027+028** but never **029**, insecure policies remain active: broad `organization_memberships` INSERT on invite accept and phone-enumerable `team_invites` SELECT/UPDATE for invitees (issues 15–16 in `grok-review-3c84806b.md`). **033 is skipped** in that state because the table already exists, so the repair path does not remediate. Conversely, if only **033** runs on a greenfield DB, the table works for org managers but `preview_team_invite` / `accept_team_invite` RPCs are absent; accept falls back to service-role logic in `lib/team-invite-accept.ts:196-207` when RPCs are missing. |
| **Suggestion** | Extend admin/CLI schema checks to verify `preview_team_invite` and `accept_team_invite` exist (or that 028 invitee policies are absent). Add targeted `029` fallback mirroring the 031/033 pattern. Document in migrate GET response when RPCs are missing. |
| **Status** | open |

### 2. Invite tokens and links exposed in manager-facing UI and list API

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Type** | credential / sensitive data exposure |
| **File** | `app/api/team-invites/route.ts:49-71`, `app/profile/page.tsx:1530-1537`, `lib/team-invite-helpers.ts:72-82` |
| **Description** | `GET /api/team-invites` returns full rows including `invite_token` and `invite_link` to any Owner/Admin. Re-invite success uses `formatInviteDeliverySummary`, embedding the invite link in the on-page success message inside the edit card. Relocating re-invite into the card increases visibility of bearer-equivalent tokens on shared screens / shoulder-surfing. Pre-existing behavior, not introduced by server logic change. |
| **Suggestion** | Return token-free summaries in list GET (id, email/phone, role, status, expires_at). Show “link copied / sent via email” in UI instead of full URL where possible. Consider one-time display or clipboard-only pattern for manual link sharing. |
| **Status** | open |

### 3. `appBaseUrl` for invite links derived from request Host headers

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Type** | open redirect / phishing |
| **File** | `app/api/team-invites/route.ts:25-31`, `lib/team-invites.ts:99-101` |
| **Description** | When `NEXT_PUBLIC_APP_URL` is unset, `appBaseUrl()` builds invite links from `x-forwarded-host` / `host`. An authenticated Owner/Admin who can influence those headers (or a misconfigured reverse proxy) could cause generated `invite_link` values to point at an attacker-controlled origin. Re-invite from the edit card uses the same POST path. |
| **Suggestion** | Require `NEXT_PUBLIC_APP_URL` for invite creation in production, or validate computed origin against an allowlist before persisting `invite_link`. |
| **Status** | open |

### 4. Phone-only invites accept without phone verification (pre-existing)

| Field | Value |
|-------|-------|
| **Severity** | suggestion |
| **Type** | weak binding |
| **File** | `supabase/migrations/029_tighten_invite_accept_rls.sql:119-127`, `lib/team-invites.ts:175-183` |
| **Description** | `accept_team_invite` and `validateAcceptTeamInvite` enforce email match only when `invite_email` is set. Phone-only invites are accepted by any authenticated user holding the token — appropriate for SMS delivery model but weaker than email-bound invites. Re-invite via edit card can create phone-only invites when roster contact has phone only. |
| **Suggestion** | Document threat model; when Twilio is enabled, consider binding accept to verified phone on the auth user or a signed SMS deep link. |
| **Status** | open |

### 5. `confirmDeleteMember` does not re-validate permissions client-side before DELETE

| Field | Value |
|-------|-------|
| **Severity** | nit |
| **Type** | defense in depth |
| **File** | `app/profile/page.tsx:1588-1606` |
| **Description** | Delete from the edit card sets `deleteCandidate` from UI-gated state and calls the API without a final `canDeleteMember` / `canRequestMemberRemoval` check in `confirmDeleteMember`. Server enforcement remains authoritative; this is a minor consistency gap if UI and server rules ever diverge. |
| **Suggestion** | Re-check `allowCardDelete` / `allowCardRequestRemoval` (or equivalent helpers) immediately before `fetch(DELETE)` in `confirmDeleteMember`. |
| **Status** | open |

---

## Migration 033 — security notes

| Check | Result |
|-------|--------|
| Auth on `GET/POST /api/admin/migrate` | Unchanged — `requireAdminUser()` + same-origin POST |
| SQL injection via migration 033 | **Not applicable** — static SQL from `getMigration033Sql()` |
| `team_invites` RLS policies | Org-manager scoped; `invited_by_user_id = auth.uid()` on INSERT; no public/invitee SELECT policies in 033 |
| Idempotent re-apply | Safe — `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` |
| `migration033Sql` in admin GET response | Pre-existing pattern — admin-only disclosure of DDL snippets |
| NOTIFY pgrst | Correct — reduces schema-cache stale surface after apply |
| Inconclusive schema check triggers 033 | Acceptable — only admin migrate / operator CLI; DDL is idempotent |

**033 vs 027 RLS:** Policies in 033 are equivalent to 027 lines 66–109. No regression.

**033 vs 028/029:** 033 does **not** create invitee policies (good) and does **not** install SECURITY DEFINER RPCs (gap — see open issue 1).

---

## Roster edit card — security notes

| Check | Result |
|-------|--------|
| Actions visible only when editing existing non-self member | `showMemberCardActions` requires `editingMember`, not self, not new target (`page.tsx:1838-1841`) |
| Re-invite gated | `allowCardReinvite` → `canReinviteMember` (Owner/Admin + contact) |
| Delete gated | `allowCardDelete` → `canDeleteMember` |
| Request removal gated | `allowCardRequestRemoval` → `canRequestMemberRemoval`; mutually exclusive with delete button (`page.tsx:2429`) |
| Confirmation before destructive action | Delete/request still uses modal (`page.tsx:2876-2921`) |
| Server endpoints unchanged | Re-invite → `POST /api/team-invites`; delete → `DELETE /api/team-member-profiles/[id]` |
| UI relocation weakens authorization | **No** — permissions enforced server-side; table removal is presentation only |

---

## Severity counts

| Severity | Open count |
|----------|------------|
| bug (critical/high) | 0 |
| suggestion | 4 |
| nit | 1 |

---

## Test coverage (security-relevant)

From implementation summary — **83 tests passed** across:

- `lib/admin-migrate-team-invites.test.ts` — missing-table / inconclusive schema detection
- `lib/migrations.test.ts` — 033 manifest and SQL shape
- `app/profile/profile-ui.test.ts` — actions in edit card slice, not roster table
- `lib/team-invite-helpers.test.ts` — `canReinviteMember` blocks owner/self
- `app/api/team-invites/route.test.ts` — auth, Owner role rejection

**Gaps (non-blocking):** No integration test asserting DELETE from edit-card flow re-checks server 403 for non-managers; no automated check that 029 RPCs exist after targeted 033 apply.

---

## Recommendations (priority)

1. Add **029 RPC / 028 policy** verification to admin migrate schema checks and targeted fallback (issue 1).
2. Reduce **invite token** surfacing in list API and success toasts (issue 2).
3. Require **`NEXT_PUBLIC_APP_URL`** for invite link generation in production (issue 3).
4. Optional: client-side permission re-check in `confirmDeleteMember` (issue 5).

No code changes were made in this review (audit only).