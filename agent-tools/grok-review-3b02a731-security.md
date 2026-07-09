# Security Review: Permit Profile Autofill (Client-Side Team Member Reads)

**Scope:** `app/permit-test/page.tsx`, `lib/permit-profile-autofill.ts`, `lib/member-profile-permissions.ts`, `lib/permit-requests.ts`, `app/api/permit-requests/route.ts`, RLS migrations `019`, `005`, `009`  
**Implementation ref:** `agent-tools/grok-impl-summary-3b02a731.md`  
**Date:** 2026-07-07  
**Status:** open  
**Criteria:** Exploitable issues (cross-tenant access, privilege escalation, auth bypass, attacker-actionable data exposure), RLS correctness, PII handling in saved snapshots, auth gates

---

## Summary

Permit profile autofill correctly avoids **cross-org** reads and **cross-user writes** on `permit_requests`. Route-analysis APIs receive only `dotNumber` / `mcNumber`, not full driver PII.

**Open issues** center on (1) a **UI vs RLS mismatch** — bulk team load is gated to primary owners in app code, but database RLS still allows **any org member** to read all teammate profiles client-side; and (2) **unvalidated, high-sensitivity PII** persisted in `permit_requests.cargo.carrierDriver` JSONB snapshots.

No code changes were made in this review (audit only).

---

## Attack paths verified safe

| Scenario | Result |
|----------|--------|
| Unauthenticated user saves permit with teammate PII | **Blocked:** `/api/permit-requests` requires `Authorization: Bearer` JWT; `savePermitRequestForUser` rejects missing/invalid tokens (`lib/permit-requests.ts:140–165`, `app/api/permit-requests/route.ts:27–33`) |
| Client supplies `user_id` to save under another account | **Blocked:** `buildPermitRequestInsertRecord` forces `user_id` from validated JWT (`lib/permit-requests.ts:167–170`) |
| Read another user's saved `carrierDriver` snapshot via `permit_requests` | **Blocked:** RLS `auth.uid() = user_id` on SELECT (`supabase/migrations/005_add_user_id_and_rls_to_permit_requests.sql:28–31`) |
| Query `member_profiles` for a **different** organization's UUID | **Blocked:** RLS requires `organization_id = auth_user_organization_id()` (caller's own profile org) (`019_team_member_profiles.sql:116–125`) |
| Non-primary user uses **in-app** driver dropdown to autofill a teammate without loaded rows | **Blocked in UI state:** `loadPermitTeamData` only bulk-fetches when `isPrimaryOwner(profile)`; `resolveDriverProfileForSelection` searches `orgMemberRows` / `teamRosterRows` already in memory (`app/permit-test/page.tsx:106–118`, `lib/permit-profile-autofill.ts:135–161`) |
| Primary owner autofill of org drivers / roster | **Expected:** legitimate workflow; data scoped to same `organization_id` |
| Full carrier/driver PII sent to `/api/optimize-route` or `/api/analyze-permit` from permit-test | **Not observed:** payloads use `permitFormToLoadDetailsCarrierFields` (dot/mc only) (`app/permit-test/page.tsx:1299`, `:1719`, `:1778`) |
| PII logged from permit-test carrier fields | **Not observed:** no `console.*` of CDL/EIN/DOB in `app/permit-test/` |

---

## Open issues

### 1. RLS grants org-wide profile read to all org members; app gates bulk load to primary owner only

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Type** | data exposure (intra-org) |
| **Status** | open |

**Description:** `loadPermitTeamData` only runs org-wide `select('*')` when `isPrimaryOwner(profile)` (`app/permit-test/page.tsx:106–114`). Implementation summary states non-primary users "see only their own profile" — that is **UI/state gating only**, not enforced by the database.

RLS policies from migration `019` allow **any** authenticated org member to SELECT all rows in their org:

```116:125:supabase/migrations/019_team_member_profiles.sql
CREATE POLICY "Org members can view profiles in their organization"
ON member_profiles
FOR SELECT
USING (
  auth.uid() = user_id
  OR (
    organization_id IS NOT NULL
    AND organization_id = auth_user_organization_id()
  )
);
```

Same pattern for `team_member_profiles` (`019_team_member_profiles.sql:171–177`). No role check (Viewer, Driver, Dispatcher, etc.).

**Exploit path:** Authenticated non-primary org member (e.g. Driver or Viewer) opens browser devtools and runs the same Supabase client query the primary owner uses:

```js
supabase.from('member_profiles').select('*').eq('organization_id', '<their org id>')
supabase.from('team_member_profiles').select('*').eq('organization_id', '<their org id>')
```

RLS returns full rows including EIN, CDL, DOB, emergency contact. Attacker can manually populate permit fields or persist teammate PII in their own permit save (see issue #2).

**Note:** Pre-existing RLS design (also used on `app/profile/page.tsx:262–270`); permit autofill **amplifies impact** by documenting primary-owner-only UX while DB allows broader read.

**Suggestion (not implemented):** If role-based read is required, tighten SELECT policies (e.g. self-row + primary-owner org-wide, or membership-role predicates). Alternatively document org-wide read as intentional and update implementation summary to avoid implying RLS-backed isolation.

---

### 2. Full carrier/driver PII persisted in `permit_requests.cargo.carrierDriver` without server validation

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Type** | PII retention / insufficient server-side controls |
| **Status** | open |

**Description:** Save payloads embed a rich `cargo.carrierDriver` object with sensitive fields copied from client `formData` (`app/permit-test/page.tsx:1474–1492`, `:1609–1627`):

- Carrier: `companyName`, `usdotNumber`, `mcNumber`, `ein`, `carrierAddress`, `carrierPhone`, `carrierEmail`, `insuranceContact`
- Driver: `driverFullName`, `cdlNumber`, `cdlState`, `driverPhone`, `driverEmail`, `dateOfBirth`, `emergencyContact`
- Metadata: `selectedDriverKey` (profile/roster UUID composite)

Server accepts `cargo` as `Record<string, any>` and inserts it verbatim (`lib/permit-requests.ts:49–50`, `:118–119`). No allowlist, no validation that `selectedDriverKey` refers to a profile the caller may use, no redaction of DOB/CDL/EIN.

**Impact:**

- **Access control:** Mitigated by per-user RLS on `permit_requests` — only the submitting user reads their history.
- **Governance:** Teammate PII filed by a primary owner is stored under the **submitter's** `user_id`, not the driver's; no audit trail tying snapshot to authorized profile read.
- **Injection:** Any authenticated user can POST arbitrary PII in `cargo.carrierDriver` even without reading `member_profiles` (manual form entry or crafted API body).
- **Retention:** JSONB in `permit_requests` (migration `009`) retains high-sensitivity data for history/analytics unless separately purged.

**Suggestion (not implemented):** Server-side schema for `cargo.carrierDriver`; optional server-side resolution from `selectedDriverKey` using service-role or RLS-bound lookup; field-level retention policy; consider excluding `dateOfBirth` / full CDL from snapshots if not required for permit history.

---

### 3. Client-side gates are not security boundaries

| Field | Value |
|-------|-------|
| **Severity** | low |
| **Type** | defense-in-depth gap |
| **Status** | open |

**Description:** Security-relevant behavior relies on client checks that are bypassable:

| Gate | Location | Limitation |
|------|----------|------------|
| `isPrimaryOwner` before bulk fetch | `page.tsx:106` | Bypass via direct Supabase queries (issue #1) |
| `workspaceMode === 'carrier'` for driver dropdown | `page.tsx:2242` | Carrier/driver **inputs always rendered**; autofill dropdown hidden in service mode only |
| `resolveDriverProfileForSelection` | `permit-profile-autofill.ts:135–161` | Trusts in-memory arrays populated client-side |
| `buildTeamMemberList` non-primary self-only list | `member-profile-permissions.ts:127–132` | List UX only; not enforced server-side on save |

No server API participates in profile read or autofill authorization for permit workflow.

---

### 4. Primary owner loads full `select('*')` into browser state

| Field | Value |
|-------|-------|
| **Severity** | low |
| **Type** | client-side PII footprint |
| **Status** | open |

**Description:** For primary owners, `loadPermitTeamData` fetches all columns for every org `member_profiles` and `team_member_profiles` row (`page.tsx:108–112`) and stores them in React state (`orgMemberRows`, `teamRosterRows`). PII is present in memory, React DevTools, and DOM after autofill. Expected for autofill UX; increases blast radius if XSS or compromised browser extension.

---

### 5. `selectedDriverKey` stores internal identifiers in permit history

| Field | Value |
|-------|-------|
| **Severity** | low |
| **Type** | identifier disclosure |
| **Status** | open |

**Description:** Saved snapshots include `selectedDriverKey` (e.g. `member_profile:<uuid>` or `team_member_profile:<uuid>`) (`page.tsx:1491`, `:1626`). Reveals internal profile/roster UUIDs to anyone who can read the submitter's permit history (the submitter themselves via RLS). Low risk unless UUIDs are treated as secrets cross-system.

---

## Auth gates

### Page access (`app/permit-test/page.tsx`)

| Check | Behavior | Assessment |
|-------|----------|------------|
| `loadingAuth` spinner | Blocks render until initial `getSession()` completes (`:2044–2057`) | OK |
| Redirect if no session | `router.push('/login')` on missing session (`:141–143`, `:164–166`) | Client-side only; no Next.js `middleware.ts` in repo |
| Post-auth without `user` | If session missing, `loadingAuth` becomes `false` while `user` stays `null`; full form can flash before redirect | Pre-existing client-auth pattern; not introduced by autofill |
| Save handlers | Re-check session before `/api/permit-requests` (`:1403–1407`, `:1537–1542`) | OK |
| Profile optional | Page works without `member_profiles` row; team autofill empty | OK |

### API access

| Endpoint | Auth | Carrier PII |
|----------|------|-------------|
| `POST /api/permit-requests` | JWT required | Accepts full `cargo.carrierDriver` from client |
| `POST /api/optimize-route` | None | Receives `dotNumber`/`mcNumber` only from permit-test payloads |
| `POST /api/analyze-permit` | None (optional JWT for autoSave) | Receives `dotNumber`/`mcNumber` only from permit-test payloads |

---

## RLS on `member_profiles` queries (permit-test)

| Query | Caller | App gate | RLS enforcement |
|-------|--------|----------|-----------------|
| Own row: `.eq('user_id', session.user.id)` | All authenticated users | Always (`:145–149`) | Self-row SELECT allowed |
| Org rows: `.eq('organization_id', profile.organization_id)` | Primary owner in app | `isPrimaryOwner(profile)` (`:106`) | Any org member with matching `auth_user_organization_id()` |
| Roster: same org filter | Primary owner in app | `isPrimaryOwner(profile)` | Any org member in org |

**Cross-org:** `auth_user_organization_id()` is derived from the caller's `member_profiles.organization_id` (`019:78–88`). Queries filtering another org's UUID return no rows under RLS. Multi-carrier **membership** (`organization_memberships` in `021`) is **not** incorporated into `member_profiles` SELECT policy — service-mode brokers with access via membership but a different `member_profiles.organization_id` cannot load that carrier's team via RLS (functional gap; `SERVICE_MODE_TODO` in `permit-profile-autofill.ts:130`).

---

## PII in saved permit snapshots

| Data | Where stored | Who can read | Server validation |
|------|--------------|--------------|-------------------|
| Full carrier + driver fields | `permit_requests.cargo` JSONB | Submitter only (RLS `user_id`) | None — opaque `Record<string, any>` |
| `selectedDriverKey` | Same JSONB path | Submitter only | None |
| `dotNumber` / `mcNumber` | Route API request bodies (transient) | N/A (not saved by those endpoints from this flow) | Parsed but not persisted there |

History page loads `permit_requests` with `select('*')` (`app/history/page.tsx:75–79`) but UI types omit `cargo`; full JSONB including `carrierDriver` is still returned to the client over the wire.

---

## Severity counts

| Severity | Open count |
|----------|------------|
| medium | 2 |
| low | 3 |
| **Total open** | **5** |

---

## Files reviewed

- `app/permit-test/page.tsx` — auth guard, `loadPermitTeamData`, save payloads, UI gating
- `lib/permit-profile-autofill.ts` — mapping, selection resolution
- `lib/member-profile-permissions.ts` — `buildTeamMemberList`, `isPrimaryOwner`
- `lib/permit-requests.ts` — insert path, `cargo` handling
- `app/api/permit-requests/route.ts` — JWT gate
- `app/api/optimize-route/route.ts`, `app/api/analyze-permit/route.ts` — outbound fields
- `supabase/migrations/019_team_member_profiles.sql` — `member_profiles` / `team_member_profiles` RLS
- `supabase/migrations/005_add_user_id_and_rls_to_permit_requests.sql` — permit ownership RLS
- `supabase/migrations/009_add_equipment_profiles_and_intake_fields.sql` — `cargo` JSONB column