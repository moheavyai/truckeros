# Re-Review Round 3: Profile Page UX (Carrier Mode) — General Pass 2

**Scope:** `app/profile/page.tsx`, `lib/member-profile.ts`, `lib/member-profile-permissions.ts`, `lib/profile-persistence.ts`, `lib/team-member-profiles-api.ts`  
**Prior review:** `agent-tools/grok-review-3c36845c.md` (12 round-2 issues marked fixed)

---

## Findings

### 1
- **Severity:** bug
- **File:line:** `app/profile/page.tsx:910-919`, `app/profile/page.tsx:984`, `app/profile/page.tsx:1156`, `app/profile/page.tsx:1290`
- **Description:** `savingCarrier` and `savingProfile` are independent, but only the active flow disables its own controls. While a carrier save is in flight, **Save Profile**, the team-member dropdown, and roster **Edit** buttons remain enabled (`disabled` checks `savingProfile` only, not `savingCarrier`). A user can start both upserts concurrently; whichever response applies last wins for `ownProfile` / `form`, risking stale or partial state.
- **Suggestion:** Treat any in-flight save as global busy state (e.g. `const isSaving = savingCarrier || savingProfile` for all save/navigation controls), or reject the second action while either flag is true.
- **Status:** open

### 2
- **Severity:** suggestion
- **File:line:** `app/profile/page.tsx:590-594`, `app/profile/page.tsx:773`, `app/profile/page.tsx:869-873`
- **Description:** On first visit, **Save Carrier Info** is enabled before roles are persisted. `buildCarrierOnlySavePayload` merges carrier fields with the saved-profile snapshot and does not include in-form `user_roles`. A new user who selects **Owner / Admin**, fills carrier fields, and clicks **Save Carrier Info** creates a profile row without that role (no org bootstrap). `shouldShowCarrierInformationCard` then becomes false (`isProfileBootstrap` is false, `primaryOwner` is false), so the carrier card disappears until a subsequent **Save Profile** — despite onboarding copy implying this step sets up the organization.
- **Suggestion:** During bootstrap, either (a) disable **Save Carrier Info** until **Owner / Admin** is selected *and* persisted via **Save Profile**, (b) include validated in-form roles in the bootstrap carrier payload, or (c) update onboarding copy to state explicitly that two saves are required (carrier, then profile/roles).
- **Status:** open

### 3
- **Severity:** nit
- **File:line:** `app/profile/page.tsx:804-809`, `app/profile/page.tsx:982-984`
- **Description:** `selectedTeamMemberKey` still derives from `editingMemberKey`, which is set only after a successful fetch. During load the dropdown is disabled, but its displayed value can remain on the prior member while the banner shows “Loading team member…” for the newly chosen member.
- **Suggestion:** Use `loadingMemberKey ?? editingMemberKey ?? …` for the controlled `<select>` value.
- **Status:** open

---

## Summary

| Severity | Count |
|----------|-------|
| bug | 1 |
| suggestion | 1 |
| nit | 1 |
| **Total** | **3** |

**Verified fixed since pass 2:** first-visit write/role bootstrap (`canWriteTeamData(null)`, `canSelfEditRoles(null)`, API `selfSaveFormForActor`), bootstrap carrier card + onboarding banner, separate `savingCarrier`/`savingProfile` labels, `restoreEditingTargetAfterSave`, roster response parsing (`savedRoster`), carrier collapse confirm, server `save_scope`, and persistence unit tests.