# Code Review: Carrier Information Save Fix — General Pass 3

**Scope:** `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`, related tests  
**Reference:** `agent-tools/grok-impl-summary-fcd8976b.md`  
**Focus:** `organization_id` handling, `[carrier-save]` debug logging, Save Carrier Info button / input enabled state

---

## Verification Summary

| Focus area | Status | Evidence |
|------------|--------|----------|
| **`organization_id` in client payload** | **Fixed** | `buildCarrierOnlyApiSavePayload` copies `existing.organization_id` when present; omits on bootstrap (`lib/member-profile.ts:128–138`). Tests in `member-profile.test.ts`, `team-member-profiles-api.test.ts`, `profile-persistence.test.ts`. |
| **`organization_id` on server upsert** | **Fixed** | Server reads `actorProfile` from DB and `prepareMemberProfileSave` preserves or bootstraps `organization_id` (`lib/team-member-profiles-api.ts:193–194`, `lib/member-profile.ts:454–474`). Bootstrap `carrier_only` allowed when `actorProfile` is null (`team-member-profiles-api.ts:189`). |
| **Debug logging** | **Fixed** | Client logs `[carrier-save] client before/after/error` (`page.tsx:782–811`); server logs `[carrier-save] server before/after upsert` (`team-member-profiles-api.ts:197–220`). |
| **Carrier button / inputs enabled** | **Fixed** | Save button and carrier inputs use `disabled={savingCarrier}` only (`page.tsx:1179, 1188`). `showSaveCarrierInfoButton` no longer gates on `canWriteProfile` (`page.tsx:1064–1067`). |
| **Tests** | **Passing** | **108/108** across `member-profile.test.ts` (58), `team-member-profiles-api.test.ts` (7), `profile-persistence.test.ts` (11), `profile-ui.test.ts` (32). |

### `organization_id` — end-to-end flow

1. **Existing primary owner:** Client payload includes `organization_id` from `ownProfile`. Server ignores body `organization_id` (not parsed by `parseMemberProfileForm`) and instead sets it from DB `actorProfile` in `prepareMemberProfileSave`. Upsert preserves org; `ensureOrganizationBootstrap` syncs org name from `company_name`.
2. **Bootstrap (no profile row):** Client omits `organization_id`. Server allows `carrier_only`, `prepareMemberProfileSave` generates UUID + `is_primary_owner` when Owner/Admin role is present. DB trigger permits INSERT with new org + primary owner.
3. **Manual check:** Filter browser + server console for `[carrier-save]`; `client before.organization_id` should match `server after upsert.savedOrgId` for existing owners.

### Debug logging — what to expect

```
[carrier-save] client before  { keys, organization_id, company_name, save_scope }
[carrier-save] server before upsert { actorOrgId, payloadOrgId, company_name, save_scope }
[carrier-save] server after upsert  { actorOrgId, payloadOrgId, savedOrgId, company_name }
[carrier-save] client after   { ok, error, savedOrgId, savedCompanyName }
```

On failure: `[carrier-save] client error` plus `[team-member-profiles] POST error` on server.

### Button enabled — intended behavior

- **Save Carrier Info** and carrier inputs disable only during `savingCarrier` (not global `isSaving`, not `!canWriteProfile`).
- **Save Profile** still uses `disabled={isSaving || !canWriteProfile || isLoadingMember}` — so it disables during carrier save (correct).
- Handler mutual exclusion: both `handleSaveCarrierInfo` and `handleSave` return early when `savingCarrier || savingProfile` (`page.tsx:760, 824`).

---

## Open Issues

### 1
- **Severity:** suggestion
- **File:line:** `lib/team-member-profiles-api.ts:377–399`, `app/api/team-member-profiles/route.ts:39`
- **Description:** Client sends `organization_id` in the JSON body, but `parseMemberProfileForm` does not read it. Server authority comes solely from the DB `actorProfile` snapshot via `prepareMemberProfileSave`. This is security-correct (no client-trusted org id), but the client payload field is **documentation/logging only** — not part of the API contract the route actually consumes.
- **Suggestion:** Either document that `organization_id` in the POST body is ignored by design, or add an integration test asserting the route never applies body `organization_id` when it disagrees with `actorProfile.organization_id`.
- **Status:** open

### 2
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:1188`, `app/profile/page.tsx:1237`
- **Description:** Carrier save button uses `disabled={savingCarrier}` only, while **Save Profile** uses `isSaving` (includes `savingCarrier`). During an in-flight **Save Profile**, the carrier button remains visually enabled; the handler no-ops via `if (savingCarrier || savingProfile) return`, which can look like a dead click with no feedback.
- **Suggestion:** Disable carrier button/inputs when `savingProfile` is also true (e.g. `disabled={savingCarrier || savingProfile}`), or show a brief status when a save is blocked by the other flow.
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:782–790`, `lib/team-member-profiles-api.ts:197–220`
- **Description:** `[carrier-save]` logs are unconditional and run in production on every carrier save (client `console.log`, server `console.log`). Useful for debugging the org-id fix, but adds noise and may log carrier company names in prod logs.
- **Suggestion:** Gate behind `process.env.NODE_ENV !== 'production'` (client) and a `DEBUG_CARRIER_SAVE` env flag (server), or remove after manual verification is complete.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:790–795`
- **Description:** Client `after` log records `savedOrgId` from the API response but does not echo `payloadOrgId` sent on the wire. Cross-checking client vs server org id requires correlating separate client-before and server-after log lines manually.
- **Suggestion:** Add `payloadOrgId: apiPayload.organization_id ?? null` to the client `after` log when `ok` is true, or log a single `orgMatch: payloadOrgId === savedOrgId` boolean.
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `app/profile/profile-ui.test.ts:415–416`
- **Description:** UI tests assert client `[carrier-save]` log strings exist but do not assert server log presence or `buildCarrierOnlyApiSavePayload` / `organization_id` wiring beyond handler string matches. Server logging and org-id path are covered only in unit tests, not an end-to-end assertion that client payload keys include `organization_id`.
- **Suggestion:** Add `expect(carrierHandler).toContain('organization_id: apiPayload.organization_id')` and a `team-member-profiles-api.test.ts` case that server `payloadOrgId` equals `actorOrgId` for existing owners.
- **Status:** open

### 6
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:441–442`
- **Description:** Member/driver fields use `isFieldDisabled`, which still checks global `isSaving`. While carrier inputs correctly use `savingCarrier` only, editing driver fields is blocked during carrier save. This is consistent with preventing conflicting form edits but differs from the carrier-card “scope-local disable” pattern.
- **Suggestion:** No change required if intentional; otherwise align member fields to `savingProfile` only so carrier save does not block unrelated sections.
- **Status:** open

### 7
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:1058–1063`
- **Description:** **Edit Carrier Info** still requires `canWriteProfile`, while **Save Carrier Info** visibility does not. Bootstrap users (`ownProfile` null, `canWriteProfile` true via `canWriteTeamData(null)`) are unaffected; edge cases with a loaded viewer profile would hide Edit but could not save anyway due to handler guards.
- **Suggestion:** Accept as-is; optional consistency pass if Edit button gating should mirror `showSaveCarrierInfoButton`.
- **Status:** open

---

## Summary by Severity

| Severity | Count |
|----------|-------|
| bug | 0 |
| suggestion | 5 |
| nit | 2 |
| **Total open** | **7** |

---

## Focus-Area Verdict

| Area | Verdict |
|------|---------|
| **`organization_id`** | **Resolved.** Client explicitly carries org when known; server preserves/bootstraps from DB + roles; bootstrap permission fixed. Body field is redundant but harmless. |
| **Debug logging** | **Resolved for debugging.** Structured `[carrier-save]` trail on client and server; consider prod gating. |
| **Button enabled** | **Resolved for stated bug.** Carrier save no longer blocked by `canWriteProfile` or unrelated `isSaving`; minor asymmetry remains when profile save is in flight. |

No open **bugs** remain for the three focus areas. Remaining items are UX polish, logging hygiene, and test-depth improvements.

---

## Notes

- `.next/dev/logs/next-development.log` entries showing `Cannot set organization_id without primary owner bootstrap` and old `carrier save` warn prefix predate this fix; current code uses `[carrier-save] client error` and allows bootstrap `carrier_only`.
- No code changes were made in this review pass.