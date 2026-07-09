# Carrier Information Save Fix — General Review Pass 2

**Scope:** `lib/member-profile.ts`, `lib/team-member-profiles-api.ts`, `app/profile/page.tsx`, `app/api/team-member-profiles/route.ts`, related tests  
**Reference:** `agent-tools/grok-impl-summary-fcd8976b.md`  
**Prior review:** `agent-tools/grok-review-fcd8976b-general.md` (pass 1)  
**Tests run:** `npx vitest run lib/member-profile.test.ts lib/team-member-profiles-api.test.ts lib/profile-persistence.test.ts app/profile/profile-ui.test.ts` → **108/108 passing**

---

## Verified Fixed Since Pass 1

| Area | Status | Evidence |
|------|--------|----------|
| `organization_id` in client payload builder | Fixed | `buildCarrierOnlyApiSavePayload` sets `organization_id` from `existing` (`lib/member-profile.ts:128-138`); covered by unit + integration tests |
| Bootstrap `carrier_only` when no profile row | Fixed | Guard blocks only `actorProfile && !isPrimaryOwner` (`lib/team-member-profiles-api.ts:189-191`) |
| Carrier button/inputs not blocked by global `isSaving` / `canWriteProfile` | Fixed | `disabled={savingCarrier}` on inputs + submit (`app/profile/page.tsx:1179,1188`); `showSaveCarrierInfoButton` no longer checks `canWriteProfile` (`page.tsx:1064-1067`) |
| Concurrent carrier + profile save race | Fixed | Both handlers early-return on `savingCarrier \|\| savingProfile` (`page.tsx:760,824`); profile/roster controls use `isSaving = isAnySaveInFlight(...)` (`page.tsx:1069,1237`) |
| Bootstrap roles merged into carrier-only payload | Fixed | `buildCarrierOnlySavePayload` includes `user_roles` when `!existing` (`lib/member-profile.ts:122-124`); test `includes selected roles during first-visit bootstrap saves` |
| Post-save state refresh | Fixed | `mergeCarrierFieldsOntoProfile` + `refreshOwnProfileAfterSave` + `loadTeamData` in `handleSaveCarrierInfo` (`page.tsx:798-803`) |
| `[carrier-save]` debug trail | Fixed | Client before/after/error (`page.tsx:782-811`); server before/after upsert (`lib/team-member-profiles-api.ts:196-220`) |

Core primary-owner rename and Owner/Admin bootstrap paths preserve `organization_id` server-side via `prepareMemberProfileSave(form, userId, actorProfile)` using the DB actor row, with `ensureOrganizationBootstrap` syncing org `name` from saved `company_name`.

---

## Open Issues

### 1
- **Severity:** bug
- **File:line:** `app/profile/page.tsx:1064-1067,1138-1142`, `lib/member-profile.ts:445-472`, `lib/team-member-profiles-api.ts:188-194`
- **Description:** Bootstrap users can click **Save Carrier Info** without selecting **Owner / Admin**. Server accepts `carrier_only` with `actorProfile === null` and only bootstraps org/`is_primary_owner` when roles include Owner/Admin (`shouldBootstrapOrganization`). A Driver-only or empty-role bootstrap save persists carrier fields on a non–primary-owner profile with no `organization_id`. After save, `isProfileBootstrap` is false and `primaryOwner` is false, so `shouldShowCarrierInformationCard` hides the Carrier Information card — saved carrier data is no longer visible on the profile surface. Recovery is possible only via roster **Edit** on the self row (not documented in onboarding copy).
- **Suggestion:** Gate `showSaveCarrierInfoButton` and/or `handleSaveCarrierInfo` on in-form `user_roles` including Owner/Admin during bootstrap; optionally reject bootstrap `carrier_only` server-side when roles lack Owner/Admin.
- **Status:** open

### 2
- **Severity:** bug
- **File:line:** `app/profile/page.tsx:806-808,1020,1410-1414`, `lib/member-profile.ts:222-230,152-158`
- **Description:** After a **successful** bootstrap carrier save with Owner/Admin (org created, `is_primary_owner` true), `shouldShowMemberEditCard` returns false on landing (`editingMemberKey === null`, `isProfileBootstrap === false`). The member edit form — including `showBootstrapProfilePrompt` (“Add your driver information here…”) — is not rendered. The carrier success message still says “Complete your driver details **below**, then click Save Profile” (`page.tsx:806-808`), but no driver form appears below the carrier card. Users must discover roster **Edit** on their own row to finish setup, contradicting the guided two-step onboarding implied by copy and tests (`profile-ui.test.ts` asserts bootstrap prompt strings).
- **Suggestion:** Keep `shouldShowMemberEditCard` true for primary owners until `shouldShowBootstrapProfilePrompt` is false (driver name persisted), or relocate the bootstrap completion prompt outside the hidden member card (e.g. below carrier card or in `carrierMessage`).
- **Status:** open

### 3
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:768-776`, `app/profile/page.tsx:836-843`
- **Description:** `formSnapshot` is captured **after** `await supabase.auth.getSession()`, unlike `handleSave` which builds `savePayload` before its first await. `setSavingCarrier(true)` disables carrier inputs on the next render, but the pattern is inconsistent and leaves a brief window where session fetch latency could overlap with stale closure reads if disable semantics change.
- **Suggestion:** Move `const formSnapshot = { ...form }` and `buildCarrierOnlyApiSavePayload(...)` above the `getSession()` await, matching `handleSave`.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `lib/team-member-profiles-api.ts:377-399`, `app/api/team-member-profiles/route.ts:39`, `lib/member-profile.ts:128-138`
- **Description:** Client sends `organization_id` via `buildCarrierOnlyApiSavePayload`, but `parseMemberProfileForm` strips it and the server derives org exclusively from the DB `actorProfile` in `prepareMemberProfileSave`. Client `organization_id` is never consumed — safe against spoofing, but the impl summary’s “missing organization_id in payload” framing overstates client impact; the durable server fix is bootstrap permission + `prepareMemberProfileSave` with `actorProfile`.
- **Suggestion:** Document that POST body `organization_id` is ignored by design, or add a server-side assertion/log when body `organization_id` (if present) mismatches `actorProfile.organization_id`.
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:1179,1188`, `app/profile/page.tsx:760,824`
- **Description:** Carrier inputs and **Save Carrier Info** use `disabled={savingCarrier}` only, not `isSaving`. While **Save Profile** is in flight, carrier controls remain visually enabled; the handler no-ops silently via `if (savingCarrier || savingProfile) return`. Users may also edit carrier fields during a profile save; if profile save resets form state, in-progress carrier edits can be lost without warning.
- **Suggestion:** Disable carrier controls when `savingProfile` is true (e.g. `disabled={savingCarrier || savingProfile}`), or surface feedback when a save is blocked by the other flow.
- **Status:** open

### 6
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:782-811`, `lib/team-member-profiles-api.ts:196-220`
- **Description:** `[carrier-save]` `console.log` / `console.warn` run unconditionally on every carrier save (client and server), including production. Logs include `company_name` and org IDs — useful for the stated manual verification workflow but noisy and potentially sensitive in shared log sinks.
- **Suggestion:** Gate behind `process.env.NODE_ENV !== 'production'` (client) and a `DEBUG_CARRIER_SAVE` env flag (server); keep error paths only in production.
- **Status:** open

### 7
- **Severity:** suggestion
- **File:line:** `lib/team-member-profiles-api.ts:183-224`, `lib/team-member-profiles-api.test.ts`
- **Description:** Tests exercise `selfSaveFormForActor`, `buildCarrierOnlyApiSavePayload`, and `prepareMemberProfileSave` in isolation, but `saveTeamMemberProfileForUser` has no direct tests for: bootstrap `carrier_only` with null `actorProfile` succeeding, non–primary-owner `carrier_only` throwing `Forbidden`, or viewer self-save rejection. Permission regressions in the async orchestration layer would not be caught.
- **Suggestion:** Extract self-save guard logic into a pure helper (e.g. `assertSelfCarrierSaveAllowed(actorProfile, saveScope)`) with unit tests, or add mocked Supabase tests for `saveTeamMemberProfileForUser`.
- **Status:** open

### 8
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:128-138`, `lib/member-profile.ts:454-474`
- **Description:** `organization_id` assignment is duplicated between `buildCarrierOnlyApiSavePayload` (client/logging) and `prepareMemberProfileSave` (server authority). The two paths can drift if one is updated without the other.
- **Suggestion:** Share a single `resolveOrganizationIdForSave(form, existing)` helper used by both builders.
- **Status:** open

### 9
- **Severity:** suggestion
- **File:line:** `app/profile/profile-ui.test.ts` (entire file)
- **Description:** UI tests remain static source-text assertions. They verify wiring (`buildCarrierOnlyApiSavePayload`, `disabled={savingCarrier}`, `[carrier-save]` strings) but cannot catch runtime failures such as bootstrap member-card visibility after carrier save (issue #2) or silent no-op when clicking carrier save during profile save.
- **Suggestion:** Add component or integration tests with mocked API responses for bootstrap and primary-owner carrier save flows.
- **Status:** open

### 10
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:775`
- **Description:** `const formSnapshot = { ...form }` is a shallow copy; nested `user_roles` array is shared with live `form` state. Low risk today because carrier save reads roles synchronously after snapshot, but inconsistent with the stated isolation goal.
- **Suggestion:** Deep-copy `user_roles` (e.g. `user_roles: [...(form.user_roles as string[])]`) or introduce a shared `snapshotForm(form)` helper.
- **Status:** open

### 11
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:782-784`
- **Description:** `tsc --noEmit` reports `TS2339: Property 'organization_id' does not exist on type '{ source: string; save_scope: "carrier_only"; }'` on the `[carrier-save] client before` log line. The spread of `carrierPayload` is not reflected in TypeScript’s inferred `apiPayload` type, hiding regressions in payload shape.
- **Suggestion:** Type `apiPayload` as `Record<string, unknown>` or define a narrow `CarrierOnlyApiPayload` interface including optional `organization_id`.
- **Status:** open

---

## Summary

| Severity | Open count |
|----------|------------|
| bug | 2 |
| suggestion | 7 |
| nit | 2 |
| **Total open** | **11** |

---

## Pass-2 Verdict

The stated carrier-save failure modes (missing org preservation on rename, bootstrap permission rejection, carrier UI blocked during unrelated saves) are **resolved** for primary-owner and Owner/Admin bootstrap happy paths. **108/108** targeted tests pass.

Pass 2 adds a **bootstrap completion UX gap** (issue #2): after a successful org bootstrap via carrier save, the guided “finish driver profile below” flow breaks because the member edit card hides on landing. Issue #1 (carrier save without Owner/Admin) remains a ship-risk for first-visit onboarding. Remaining items are snapshot timing, logging hygiene, test depth, and type-safety polish.

No code changes were made in this review pass.