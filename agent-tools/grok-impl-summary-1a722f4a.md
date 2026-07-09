# Invite Flow Improvements — Implementation Summary

## Files Changed

| File | Change |
|------|--------|
| `lib/invite-notifications.ts` | **New** — email/SMS notification helpers, `[invite-notify]` logging, `sendInviteNotifications()` |
| `lib/invite-notifications.test.ts` | **New** — stub/logging tests |
| `lib/team-invite-helpers.ts` | **New** — contact resolution, invite role, re-invite guards, `createTeamInviteViaApi()`, delivery summary |
| `lib/team-invite-helpers.test.ts` | **New** — helper unit tests |
| `lib/dev-mode.ts` | **New** — dev gating (`isDevEnvironment`, `isDevAccountSwitcherEnabled`, base owner email) |
| `app/api/team-invites/route.ts` | Wire `sendInviteNotifications`; revoke prior pending invites for same email/phone; return `{ email, sms }` |
| `app/api/team-invites/route.test.ts` | POST success shape test with mocked notifications |
| `app/api/dev/switch-user/route.ts` | **New** — dev-only magic-link account switching via Supabase admin API |
| `components/DevAccountSwitcher.tsx` | **New** — dev banner + account dropdown |
| `components/AppHeader.tsx` | Render `DevAccountSwitcher` above header |
| `app/profile/page.tsx` | Save and Invite, Re-invite, dev accept-test buttons, invite delivery feedback |
| `app/profile/profile-ui.test.ts` | New invite/dev UI assertions; updated `handleSave` slice markers |

## Design Decisions

### 1. Parallel email + SMS notifications (stub mode)
- **Email**: gated on `INVITE_EMAIL_ENABLED=true` (mirrors existing `TWILIO_ENABLED` for SMS).
- **`sendInviteNotifications()`** logs every delivery attempt with prefix `[invite-notify]` including channel, recipient, role, `invite_link`, and `sent` vs `stubbed`.
- POST `/api/team-invites` returns `{ success, data, email, sms }` for UI feedback.

### 2. Save and Invite
- Emerald **Save and Invite** button appears on the **New Team Member** card (under User Roles, alongside **Save New Member**).
- Reuses existing save validation via `handleSave(..., { andInvite: true })`.
- After successful roster save, calls `createTeamInviteViaApi()` with `driver_email`, `driver_phone`, and primary allowed role from `user_roles`.
- Success message includes invite link and stub hints when applicable.

### 3. Re-invite on roster cards
- **Re-invite** button on Team Roster rows for Owner/Admin when member has email or phone and is not primary owner/self.
- Creates a fresh invite; server auto-revokes prior pending invites for the same email/phone before insert.

### 4. Dev account switcher
- Gated: `NODE_ENV !== 'production'` OR `NEXT_PUBLIC_DEV_ACCOUNT_SWITCHER=true`.
- Amber banner in `AppHeader`: **Test mode: viewing as X**.
- Dropdown lists `andrehampton1@outlook.com` plus org roster/member `driver_email` values.
- `POST /api/dev/switch-user` uses `SUPABASE_SERVICE_ROLE_KEY` + `auth.admin.generateLink()`; client redirects to magic link.
- Selected email stored in `localStorage` key `dev-test-persona-email`.

### 5. In-portal invite testing (dev only)
- Pending invites show **Open accept link** (`/invite/[token]`) and **Accept as current user** when logged-in email matches invite email.
- One-click accept calls `POST /api/team-invites/accept`.

## How to Test Manually

1. **Start dev server** with `SUPABASE_SERVICE_ROLE_KEY` set for account switching.
2. **Sign in** as owner (`andrehampton1@outlook.com`).
3. **Team Invites section**: create invite with email + phone → check server console for `[invite-notify]` stub logs; UI shows invite link.
4. **+ Add New Member**: fill name, email/phone, roles → click **Save and Invite** → member saved + invite created in one step.
5. **Team Roster**: click **Re-invite** on a member with contact info → new link + stub logs.
6. **Dev switcher** (header banner): pick another team email → magic-link redirect.
7. **Dev accept testing**: on a pending invite matching your email, click **Accept as current user** or **Open accept link**.
8. **Enable real delivery** (future): set `INVITE_EMAIL_ENABLED=true` and/or `TWILIO_ENABLED=true`.

## Test Run Results

```text
# Invite-related tests (all pass)
npx vitest run lib/invite-notifications.test.ts lib/team-invite-helpers.test.ts app/api/team-invites/route.test.ts app/profile/profile-ui.test.ts
→ 4 files, 50 tests passed

# Full suite
npm test
→ 689 passed, 2 failed (pre-existing, unrelated permit-test drift)
  - app/permit-test/load-details-ui.test.ts — expects 2-arg buildPermitCargoSnapshot; code uses 3-arg
  - lib/routing-envelope-display.test.ts — header nav assertion
```

All invite-flow tests introduced or updated in this task pass.