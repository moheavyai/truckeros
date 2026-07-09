# Security Review: Hardcoded Email Bypass for Carrier Save

**Scope:** `lib/forced-carrier-owner.ts`, `lib/team-member-profiles-api.ts`, `lib/member-profile.ts`, `app/profile/page.tsx`, `app/api/team-member-profiles/route.ts`, `supabase/migrations/020_member_profiles_privileged_columns.sql`, `supabase/migrations/023_member_profiles_self_service_field_guard.sql`  
**Focus:** Email-based privilege bypass for `andrehampton1@outlook.com` — auth derivation, POST spoofing, production impact, cross-user effects  
**Implementation ref:** `agent-tools/grok-impl-summary-02a74f17.md`  
**Date:** 2026-07-07

---

## Executive summary

The forced-carrier-owner mechanism is **not spoofable by arbitrary users** via the API: the server derives `actorEmail` exclusively from `supabase.auth.getUser()` on the bearer token, and `parseMemberProfileForm()` does not consume client-supplied email, `is_primary_owner`, or `organization_id`.

**Other users cannot trigger the bypass.** Only an authenticated session whose Supabase auth email matches `andrehampton1@outlook.com` receives elevated treatment.

The primary security concern is **intentional privilege backdooring of a single production account** — hardcoded in source, bundled to the client, and bypassing multiple authorization gates. Compromise or transfer of that account grants persistent Owner/Admin carrier-save powers regardless of DB role state.

Database triggers (`020`, `023`) provide defense-in-depth that prevents the forced owner from escalating within another organization when they are a non–primary-owner member.

---

## Auth & input trust model (verified)

| Check | Result | Evidence |
|-------|--------|----------|
| Server `actorEmail` from auth token only | **Pass** | `saveTeamMemberProfileForUser`: `const actorEmail = userData.user.email` after `supabase.auth.getUser()` (`lib/team-member-profiles-api.ts:188–195`) |
| POST body cannot supply actor email | **Pass** | `parseMemberProfileForm()` whitelists profile fields only; no `email` / `actor_email` keys (`lib/team-member-profiles-api.ts:427–449`) |
| POST body cannot set `is_primary_owner` | **Pass** | Not parsed; `prepareMemberProfileSave()` computes privileged columns server-side (`lib/member-profile.ts:643–667`) |
| POST body cannot set `organization_id` | **Pass** | Not parsed; org derived from DB `actorProfile` or server-generated UUID on bootstrap (`lib/member-profile.ts:133–137`, `654–664`) |
| `carrier_email` form field ≠ actor identity | **Pass** | `isForcedCarrierOwner()` compares only the `actorEmail` parameter, never `form.carrier_email` |

Client-side gates use `user?.email` from the Supabase session (`app/profile/page.tsx:828`, `1132`). Client checks are UX-only; server re-derives identity from the JWT.

---

## Forced-owner bypass matrix

| Gate bypassed | Layer | Condition |
|---------------|-------|-----------|
| `canWriteTeamData` (Viewer block) | Server | `forcedCarrierOwner && saveScope === 'carrier_only'` (`lib/team-member-profiles-api.ts:212–217`) |
| `validateBootstrapCarrierSaveRoles` | Server + client | Dedicated `forcedCarrierOwner` branch skips throw / error UI (`lib/team-member-profiles-api.ts:222–223`, `app/profile/page.tsx:838–841`) |
| `canActorSaveCarrierOnlyScope` | Server | `isForcedCarrierOwner(actorEmail)` returns `true` (`lib/team-member-profiles-api.ts:134`) |
| `canSaveCarrierInfo` | Client | Same (`lib/member-profile.ts:185`) |
| Bootstrap role injection | Server + client | `ensureBootstrapOwnerAdminRoles()` always applied for forced owner (`lib/team-member-profiles-api.ts:222–223`, `lib/member-profile.ts:649–651`) |
| `is_primary_owner` promotion on upsert payload | Server | `prepareMemberProfileSave()` forces `is_primary_owner: true` when forced owner has existing `organization_id` (`lib/member-profile.ts:656–657`) |
| Org bootstrap without roles | Server | `shouldBootstrapOrganization()` short-circuits for forced owner without org (`lib/member-profile.ts:636`) |
| Carrier card visibility | Client | `shouldShowCarrierInformationCard()` always `true` for forced email (`lib/member-profile.ts:286`) |

**Not bypassed (still enforced):**

| Gate | Why |
|------|-----|
| Edit/delete other team members | Requires `isPrimaryOwner(actorProfile)` from **DB**, not `isForcedCarrierOwner` (`lib/team-member-profiles-api.ts:281–287`, `371–372`) |
| Cross-user `target_user_id` | Unchanged primary-owner requirement |
| `member_only` / `full` save for Viewers | Viewer bypass scoped to `carrier_only` only |
| DB `is_primary_owner` self-promotion in existing org | Trigger `020` raises on `OLD.is_primary_owner IS DISTINCT FROM NEW.is_primary_owner` |
| DB carrier / role writes for non–primary-owner members | Trigger `023` reverts privileged columns when `NEW.is_primary_owner` is false |

---

## Attack paths evaluated

| Scenario | Result |
|----------|--------|
| Attacker adds `email`, `actor_email`, or `user_email` to POST JSON | **Blocked** — fields ignored; auth email used |
| Attacker sets `is_primary_owner: true` or `organization_id` in POST | **Blocked** — not parsed; server computes payload |
| Attacker spoofs forced owner via `carrier_email` | **Blocked** — unrelated field |
| Non-privileged user triggers forced-owner branch | **Blocked** — email match is exact (trim + lowercase) |
| Forced owner (Driver/Viewer) in **another** org saves `carrier_only` | **App allows; DB contains** — upsert attempts `is_primary_owner: true` flip; trigger `020` rejects; trigger `023` freezes carrier/roles if promotion somehow skipped |
| Forced owner compromises another user's data cross-tenant | **Blocked** — no path to write another `user_id`; org id pinned to actor's DB row |
| Forced owner edits roster / members without DB primary-owner flag | **Blocked** — `isPrimaryOwner(actorProfile)` gate on non-self paths |
| Account takeover of `andrehampton1@outlook.com` | **High impact** — full carrier-save bypass + bootstrap powers for that account |

---

## Impact on other users

| Question | Assessment |
|----------|------------|
| Can other users gain forced-owner privileges? | **No** — email allowlist is not client-trusted |
| Can other users' org data be modified by the bypass? | **No** — cross-user writes require DB `is_primary_owner`; org id cannot be reassigned via POST |
| Can org members be affected if privileged account joins as Driver? | **No escalation** — DB triggers block self-promotion and carrier overwrites for non–primary-owner rows |
| Can org members be affected if privileged account is primary owner of **their own** org? | **Yes, by design** — normal primary-owner admin powers over their team only |
| Information leaked to other users? | **Minor** — privileged email is visible in client JS bundle (`lib/forced-carrier-owner.ts` imported by `app/profile/page.tsx`) |

---

## Findings

### F1 — Hardcoded production privilege backdoor

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | bug |
| **Status** | open |
| **Location** | `lib/forced-carrier-owner.ts:2`, consumers in `lib/team-member-profiles-api.ts`, `lib/member-profile.ts`, `app/profile/page.tsx` |

**Description:** A single email address is hardcoded as a universal bypass for carrier-save authorization, bootstrap validation, viewer write restrictions, and `is_primary_owner` payload promotion. The constant is compiled into both server and client bundles.

**Impact:** Anyone who controls the `andrehampton1@outlook.com` Supabase auth session receives Owner/Admin carrier treatment regardless of `member_profiles.user_roles` or viewer status. This is equivalent to a persistent backdoor for one account.

**Exploitability by third parties:** Not directly spoofable via API. Risk is account compromise, credential sharing, or leaving a developer bypass enabled in production.

**Recommendation:** Remove before general production release, or gate behind `process.env.FORCED_CARRIER_OWNER_EMAIL` that is unset in production; add audit logging when the bypass fires; enforce MFA on the privileged account.

---

### F2 — Privileged account email disclosed in client bundle

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | suggestion |
| **Status** | open |
| **Location** | `lib/forced-carrier-owner.ts` (imported client-side via `app/profile/page.tsx:19`) |

**Description:** `FORCED_CARRIER_OWNER_EMAIL = 'andrehampton1@outlook.com'` ships in browser JavaScript. Any user can inspect the bundle and identify the privileged account.

**Impact:** Targeted phishing, credential stuffing, or social engineering against a known high-privilege identity. Does not alone grant access.

**Recommendation:** Keep allowlist server-only; client UI gates should rely on server-returned capability flags (e.g. `can_save_carrier: true`) rather than comparing emails in the browser.

---

### F3 — Application layer attempts `is_primary_owner` promotion that DB rejects for org-linked non-owners

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | suggestion |
| **Status** | open |
| **Location** | `lib/member-profile.ts:654–658`; test `lib/forced-carrier-owner.test.ts:44–56`; mocked integration `lib/team-member-profiles-api.test.ts:253–295` |

**Description:** For a forced owner who is an org-linked non–primary-owner (e.g. `Driver`, `organization_id` set, `is_primary_owner: false`), `prepareMemberProfileSave()` emits `is_primary_owner: true`. Migration `020` raises `Cannot change is_primary_owner on self-update` on that upsert. Unit/integration tests mock DB success and do not reflect trigger behavior.

**Impact:** **No cross-user privilege escalation** — other org members are protected. Forced owner likely sees save failures in this state. Creates app/DB inconsistency and false confidence from tests.

**Recommendation:** Only set `payload.is_primary_owner = true` when `existing.is_primary_owner` is already true, or when bootstrapping a new org (`OLD.organization_id IS NULL`). Align tests with trigger semantics.

---

### F4 — Server auth derivation and POST spoofing controls (positive)

| Field | Value |
|-------|-------|
| **Severity** | informational |
| **Category** | nit |
| **Status** | open |
| **Location** | `lib/team-member-profiles-api.ts:188–195`, `427–449`; `app/api/team-member-profiles/route.ts:38–58` |

**Description:** Verified: forced-owner checks bind to JWT-derived email only. No exploitable path for arbitrary users to inject a forged actor email or privileged columns through the save API.

**Recommendation:** Maintain this invariant in code review; add a negative API test that POSTing `email` / `is_primary_owner` / `organization_id` does not alter server authorization outcome.

---

### F5 — Viewer `carrier_only` bypass is app-layer only for non–primary-owner org members

| Field | Value |
|-------|-------|
| **Severity** | low |
| **Category** | nit |
| **Status** | open |
| **Location** | `lib/team-member-profiles-api.ts:212–217` |

**Description:** Forced owner skips the viewer write gate for `carrier_only` self-saves before upsert. If the actor is a Viewer in an existing org and not DB primary owner, the request reaches Supabase but DB triggers prevent privileged mutations.

**Impact:** No demonstrated harm to other users; possible confusing 500/error responses for the privileged account.

**Recommendation:** Short-circuit forced-owner saves when `actorProfile` exists, has `organization_id`, and `is_primary_owner !== true`, returning a clear 403 instead of attempting a doomed upsert.

---

## Production allowlist impact summary

| Environment | Risk |
|-------------|------|
| **Production (current code)** | Single account permanently exempt from role/bootstrap/viewer carrier gates; email visible in source |
| **Other registered users** | Unchanged authorization; cannot invoke bypass |
| **Org tenants** | Protected from forced-owner lateral escalation by DB triggers `020` / `023` |
| **Compliance / audit** | Undocumented super-user by email may fail least-privilege and change-control expectations |

---

## Severity counts

| Severity | Category | Open count |
|----------|----------|------------|
| high | bug | 1 |
| medium | suggestion | 2 |
| low | nit | 1 |
| informational | nit | 1 |
| **Cross-user exploitable** | — | **0** |

---

## Conclusion

**No open vulnerability allows arbitrary users to spoof the forced-owner bypass via POST body or client tampering.** Server-side auth derivation is correct.

**Open security debt:** a hardcoded, client-visible email backdoor grants broad carrier-save privileges to one account in production. Other users are not directly exploitable through this mechanism; database triggers limit cross-tenant and in-org escalation when the privileged account is a non–primary-owner member.

Prioritize **F1** (remove or environment-gate the allowlist) and **F2** (server-only enforcement) before production hardening.