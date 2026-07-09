## Review Issues (Merged Round 3)

Prior rounds fixed unless re-listed. Only residual/new open issues.

### Issue 1 [General-2][General-4][Security] — Severity: bug
- **File**: lib/team-invite-accept.ts (restoreInviteClaimIfNeeded / post-claim error handling)
- **Description**: Claim restore runs on ANY post-claim failure, including after membership upsert already succeeded (e.g. profile insert fails). Invite returns to pending while membership exists; phone-only invites can be double-claimed by another user.
- **Suggestion**: Only restore claim when membership grant did not commit. Track whether membership upsert succeeded; if it did, leave invite accepted (or compensate by deleting membership — prefer leave accepted and return partial-success/error without reopening). If membership failed, restore pending.
- **Status**: fixed
- **Response**: Track `membershipCommitted` after successful membership upsert. Restore pending only when `!membershipCommitted`. If membership committed but profile/roster fails, leave invite accepted, log warning, rethrow error. Test covers both paths.

### Issue 2 [Security] — Severity: bug
- **File**: isSafeLocalDevHost / app/api/team-invites/route.ts
- **Description**: Host userinfo bypass: values like `127.0.0.1:80@evil.com` or `localhost:3000@evil.com` pass after port split leaves localhost/127.0.0.1. Invite link becomes `http://127.0.0.1:80@evil.com/invite/{token}` and browsers navigate to evil.com.
- **Suggestion**: Reject host containing `@`. Parse with URL constructor against a dummy base and require hostname exactly localhost/127.0.0.1/::1 with no userinfo. Add tests for `@` and userinfo forms.
- **Status**: fixed
- **Response**: Reject any host containing `@`; parse via `new URL('http://' + host)` and require empty username/password and hostname exactly `localhost` / `127.0.0.1` / `::1`. Tests for `127.0.0.1:80@evil.com`, `localhost:3000@evil.com`, `user@localhost`.

### Issue 3 [General-2][General-4] — Severity: suggestion
- **File**: components/AppHeader.tsx / lib/nav-actor.ts error path
- **Description**: Error fail-safe sets empty roles + global → resolveEffectivePermissions falls through to Viewer defaults and shows equipment/profile (fail-open). Comment/intent is fail-closed.
- **Suggestion**: On fetch error set navActor null (and navReady true) so showEquipment/showProfile stay false/hidden until success, matching fail-closed policy.
- **Status**: fixed
- **Response**: On load error set `navActor` to `null` (with `navReady` true in finally). Restricted nav stays hidden (`navReady && navActor ? …`). Source test asserts fail-closed null, not empty Viewer actor.

### Issue 4 [General-2] — Severity: nit
- **File**: isMultiOrgInviteJoin helper
- **Description**: Unused existingIsPrimaryOwner parameter on multi-org join helper if present.
- **Suggestion**: Remove unused param or use it; keep API honest.
- **Status**: fixed
- **Response**: Removed `existingIsPrimaryOwner` from `isMultiOrgInviteJoin` signature and all call sites/tests.

---

**Round 3 totals:** 4 fixed (0 open)

---

## Implementation Summary (Fix Round 3)

| # | Change |
|---|--------|
| 1 | `membershipCommitted` gate on claim restore |
| 2 | `isSafeLocalDevHost` rejects `@` + URL-parsed hostname only |
| 3 | AppHeader error → `setNavActor(null)` fail-closed |
| 4 | Dropped unused `existingIsPrimaryOwner` from multi-org helper |

**Tests:** 54 related tests passed (`team-invite-accept`, `team-invites`, team-invites routes, AppHeader).
