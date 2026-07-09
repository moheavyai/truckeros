# Final Re-Review: Forced Carrier Owner (02a74f17) — After Fix Round 3

**Reviewer:** general  
**Scope:** `lib/team-member-profiles-api.ts` (`upsertClient` / `forcedCarrierOwnerNeedsAdminPromotion`)  
**Tests:** 63/63 passing (`forced-carrier-owner` 4, `team-member-profiles-api` 24, `profile-ui` 35)

---

## Fix Round 2 — Verification

| # | Issue | Verdict |
|---|-------|---------|
| 7 | `ensureOrganizationBootstrap` fails RLS after admin upsert | **Resolved** — bootstrap uses `upsertClient` (`lib/team-member-profiles-api.ts:296`). |
| 9 | Save Profile button / `isFieldDisabled` omit `forcedCarrierOwner` | **Resolved** — UI parity in `app/profile/page.tsx`. |
| 8 | Admin fallback dev warning | **Superseded** — round 3 throws when promotion/bootstrap requires admin and key is missing. |

---

## Fix Round 3 — Verification

| # | Issue | Verdict |
|---|-------|---------|
| 1 | Forced-owner full save bypasses admin client on null-profile bootstrap | **Resolved** — `upsertClient` selects admin for all forced-owner self-saves when `hasAdminAccess && supabaseAdmin` (`lib/team-member-profiles-api.ts:275-276`), not only `carrier_only`. Full-scope bootstrap test asserts admin upsert + admin org bootstrap (`lib/team-member-profiles-api.test.ts:432-481`). |
| 2 | Forced-owner org-linked promotion fails without service role key | **Resolved** — `forcedCarrierOwnerNeedsAdminPromotion` gates promotion/bootstrap paths; missing admin throws `Carrier save requires SUPABASE_SERVICE_ROLE_KEY on server for account promotion.` (`lib/team-member-profiles-api.ts:266-273`). Tests cover `carrier_only` and `full` scopes (`lib/team-member-profiles-api.test.ts:533-581`). |

---

## Summary

**Fix round 3 targets:** 2/2 verified fixed.

**Open bugs:** 0

All forced-carrier-owner save paths that require promotion or org bootstrap now either use the admin client (when configured) or fail with an explicit server-configuration error.

---

## Optional Suggestions (not counted as open bugs)

- **Bootstrap UX:** Forced owner with existing non-primary row still lacks amber bootstrap welcome and Owner/Admin badge until DB promotion (`shouldShowOwnerAdminBadge` / `isProfileBootstrap` read persisted state only).
- **Team UI before promotion:** `loadTeamData`, roster management, and link-request approval remain gated on `isPrimaryOwner(ownProfile)` until carrier save completes.
- **Tests:** `ensureOrganizationBootstrap` upsert payloads (org `name`, membership `is_primary_owner`) are still not asserted beyond call-count / client selection.