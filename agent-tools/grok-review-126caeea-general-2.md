# Profile Page UX & Role Logic — General Review Pass 2

**Scope:** `app/profile/page.tsx`, `lib/member-profile.ts`, `lib/profile-field-permissions.ts`, `lib/profile-change-requests.ts`, `app/api/profile-change-requests/route.ts`, `supabase/migrations/022_profile_change_requests.sql`, `lib/profile-persistence.ts`, `lib/team-member-profiles-api.ts`, related tests  
**Reference:** `agent-tools/grok-impl-summary-126caeea.md`  
**Tests run:** `profile-ui.test.ts` 27/27 passing; `tsc --noEmit` reports errors in `app/profile/page.tsx`

---

## Verified Fixed Since Prior Carrier-Mode Reviews

| Area | Status |
|------|--------|
| Concurrent carrier + profile saves | `isAnySaveInFlight` gates all save/navigation controls (`page.tsx:892`, `disabled={isSaving}`) |
| Save payload snapshot race | `buildSavePayloadForTarget(priorTarget, formForSave, ownProfile)` frozen before `await` (`page.tsx:698`) |
| Bootstrap roles in carrier-only save | `buildCarrierOnlySavePayload` merges `user_roles` when `!existing` (`lib/member-profile.ts:122–124`) |
| Carrier revert after save | `mergeCarrierFieldsOntoProfile` applied post carrier save (`page.tsx:654`) |
| Team-member edit persistence | `restoreEditingTargetAfterSave` + return-to-landing after new roster member (`page.tsx:729–745`) |
| Server driver field stripping | `selfSaveFormForActor` applies `applyDriverRestrictedFieldBaseline` (`lib/team-member-profiles-api.ts:136–140`) |

---

## Open Issues

### 1
- **Severity:** bug
- **File:line:** `app/profile/page.tsx:839–841`
- **Description:** `editingLabel` calls `showLandingProfileView(...)`, but that identifier is not imported or defined. The imported helper is `shouldShowLandingProfileView` (used correctly at line 850). TypeScript reports `TS2552: Cannot find name 'showLandingProfileView'`. Any render after auth load will throw `ReferenceError` when evaluating `editingLabel`, breaking the profile page whenever the editing banner would be shown (member edit, bootstrap, or new-member flows).
- **Suggestion:** Replace `showLandingProfileView` with `shouldShowLandingProfileView`, or alias on import. Add a source-inspection test asserting the editing-label ternary references the imported symbol.
- **Status:** open

### 2
- **Severity:** bug
- **File:line:** `app/profile/page.tsx:713–715`, `lib/profile-change-requests.ts:65–82`
- **Description:** Driver saves run `submitRestrictedFieldChangeRequests` **before** `saveViaApi`. If change-request inserts succeed but the profile upsert fails (network, validation, RLS), pending `profile_change_requests` rows are left in the database while allowed contact-field edits were not persisted. There is no rollback or compensating delete.
- **Suggestion:** Submit change requests only after a successful profile save, wrap both in a server-side transaction endpoint, or delete inserted request rows when the profile save fails.
- **Status:** open

### 3
- **Severity:** bug
- **File:line:** `lib/migration-manifest.json:1–11`, `supabase/migrations/022_profile_change_requests.sql`
- **Description:** Migration `022_profile_change_requests.sql` exists but is **not** listed in `lib/migration-manifest.json`. Automated migrate scripts will skip it; production/staging environments that rely on the manifest will lack the `profile_change_requests` table and RLS policies, causing driver save flows to fail at POST `/api/profile-change-requests`.
- **Suggestion:** Add `"022_profile_change_requests.sql"` to the manifest (after `021_multi_carrier_foundation.sql`) and document manual apply if environments are already deployed.
- **Status:** open

### 4
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:462–491`, `app/api/profile-change-requests/route.ts:67–74`
- **Description:** The client counts restricted deltas with `detectRestrictedFieldChanges(formSnapshot, getFormBaseline())` but POSTs `baseline_profile: ownProfile` (persisted row). The server baseline is `memberProfileFromRow(body.baseline_profile)`, not the form baseline ref. If `formBaselineRef` and `ownProfile` diverge (e.g. partial state updates, date normalization, or stale React state), the success suffix (`submittedChangeCount`) can disagree with rows actually inserted—drivers may see “N fields submitted for review” when fewer or zero requests were created.
- **Suggestion:** Send `baseline_profile: getFormBaseline()` (or omit client baseline and let the server load the authenticated profile row from DB as the single source of truth).
- **Status:** open

### 5
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:176–182`, `lib/member-profile.ts:196–204`, `app/profile/page.tsx:947–951`
- **Description:** After first **Save Carrier Info** without **Owner / Admin** selected, `isProfileBootstrap` becomes false and `primaryOwner` is false, so `shouldShowCarrierInformationCard` hides the carrier card and `shouldShowMemberEditCard` hides the member form on landing. The user is left with only the Team Roster (must click **Edit** on their own row to assign roles and finish setup). Onboarding copy (“Select Owner / Admin under roles, then add carrier details here”) implies carrier setup happens in the visible card, not via a hidden follow-up edit.
- **Suggestion:** Keep carrier and/or member edit cards visible until `is_primary_owner` or validated owner role is persisted; disable **Save Carrier Info** until **Owner / Admin** is checked; or update onboarding copy to state that roster **Edit** is required after carrier save when roles were not selected.
- **Status:** open

### 6
- **Severity:** suggestion
- **File:line:** `app/api/profile-change-requests/route.ts:27–48`, `lib/profile-change-requests.ts:85–102`, `app/profile/page.tsx` (no consumer)
- **Description:** Primary owners can GET pending change requests via API, and migration RLS allows UPDATE for approval—but there is no in-app approve/reject UI, no PATCH/POST approve route, and no logic to apply approved values to `member_profiles`. Drivers can submit requests that admins cannot action without direct DB/API work.
- **Suggestion:** Add owner-facing pending-requests panel on profile or admin surface, plus approve/reject API that updates request status and merges approved fields into the target profile.
- **Status:** open

### 7
- **Severity:** suggestion
- **File:line:** `supabase/migrations/022_profile_change_requests.sql:5–18`, `lib/profile-change-requests.ts:75–79`
- **Description:** Each driver save inserts new `pending` rows with no unique constraint on `(target_user_id, field_key, status)`. Re-saving the same restricted edit (or saving again before admin review) creates duplicate pending requests for the same field, cluttering the owner queue and complicating approval.
- **Suggestion:** Upsert on `(target_user_id, field_key)` where `status = 'pending'`, or reject/cancel superseded pending rows before insert.
- **Status:** open

### 8
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:746–751`, `app/profile/page.tsx:1053–1063`
- **Description:** After a successful driver save with restricted edits, the UI resets the form from the persisted profile (`setFormState(memberProfileFromRow(profile))`), so restricted fields revert to pre-approval values and the amber “Requires Admin approval” banner clears. The success message mentions admin review, but the form no longer shows the submitted values—drivers may believe their edits were discarded.
- **Suggestion:** After submit, keep displaying pending values in restricted fields (read-only or with a “pending review” badge) until the request is approved/rejected; optionally surface pending-request status from GET.
- **Status:** open

### 9
- **Severity:** suggestion
- **File:line:** `lib/member-profile.ts:196–204`, `app/profile/page.tsx:1232–1348`
- **Description:** On landing, non-bootstrap self users (typical drivers) do not see the member edit card—they must click **Edit** on their own roster row. This matches the simplified landing design but adds an extra step compared to always showing “Your Profile” on landing; drivers may not realize self-edit is only reachable via roster **Edit**.
- **Suggestion:** For `isDriverSelfServiceActor` on landing, auto-show the member edit card (or a prominent “Edit your profile” CTA above the roster).
- **Status:** open

### 10
- **Severity:** nit
- **File:line:** `lib/profile-change-requests.ts` (entire module), `app/api/profile-change-requests/route.ts`
- **Description:** No unit or integration tests cover `submitProfileChangeRequests`, `listPendingProfileChangeRequestsForOrg`, or the API route handlers. Driver approval flow correctness is only indirectly asserted via `profile-ui.test.ts` source slices on `page.tsx`.
- **Suggestion:** Add `lib/profile-change-requests.test.ts` and route-level tests for POST/GET auth, baseline handling, and empty-change short-circuit.
- **Status:** open

### 11
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:525–527`
- **Description:** `saveViaApi` casts `result.data?.data` to `TeamMemberProfile` (`TS2352` under `tsc --noEmit`). The cast is structurally unsafe and may hide response-shape regressions from the team-member-profiles API.
- **Suggestion:** Narrow with a type guard (e.g. check `organization_id` / roster-specific fields) or share a typed response helper with the API route.
- **Status:** open

---

## Summary

| Severity | Count |
|----------|-------|
| bug | 3 |
| suggestion | 6 |
| nit | 2 |
| **Total open** | **11** |

**Pass-2 verdict:** Landing UX, carrier merge, and driver permission plumbing are largely sound and prior carrier-mode regressions appear addressed. The `showLandingProfileView` typo is a ship-blocking runtime defect. Driver change-request flow is structurally incomplete for production (migration manifest gap, non-atomic save ordering, no approval surface) and needs follow-up before drivers rely on restricted-field submissions in live environments.