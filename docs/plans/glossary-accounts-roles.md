# Glossary: Accounts, Roles, and Modes

**Source of truth:** `docs/plans/user-accounts-roles-flows.md`  
**Phase 0 freeze:** 2026-07-09

Use these terms consistently. Do not invent alternate role sources or treat UI chrome as RLS.

---

## Membership vs home profile vs roster

| Term | Table / store | Meaning |
|------|----------------|---------|
| **Membership** | `organization_memberships` | Authoritative **per-org access + role**. Unique `(organization_id, user_id)`. Scalar `role`. Multi-org authz SSoT. |
| **Home profile** | `member_profiles` | Logged-in user’s **identity + home carrier** row. One home org per user (`user_id` unique). PII + carrier fields; `user_roles[]`. |
| **Roster** | `team_member_profiles` | Org-scoped people list (may exist **before** invite accept). Optional `linked_user_id`. Not a substitute for membership. |

**Rules of thumb**

- Authz / multi-org access → **membership**
- “Who am I / what’s my home carrier?” → **home profile**
- “Who is on this org’s team list (including unlinked)?” → **roster**

---

## Org role vs service seat

| Term | Meaning |
|------|---------|
| **Org role** | Membership `role`: Owner, Admin, Driver, Permit Clerk, Viewer. Drives in-org permissions defaults. |
| **Service seat** | Whether a membership may be used as a **Service Mode** scope target on that org. |

**Phase 1 transitional (no schema yet):** service seat ≈ **Permit Clerk membership only**. No `service_seat` column until Phase 3. Owner/Admin/`primary_owner`/`created` do **not** grant Service Mode.

**Phase 3 target:** `service_seat = true` **and** `role = 'Permit Clerk'`. Seat is ops/service-role writable, not a free manager self-grant.

---

## Carrier Mode vs Service Mode

| | **Carrier Mode** | **Service Mode** |
|--|------------------|------------------|
| Storage | `localStorage` `truckeros_workspace_mode` = carrier (default) | same key = `'service'` |
| Effective org | Home org (`member_profiles.organization_id`) | Selected active carrier (`activeOrganizationId`) |
| Who (Phase 1) | Everyone (default) | Users with ≥1 **Permit Clerk** membership |
| UI | Fleet work on own carrier | Carrier selector, `/carriers` nav, work *on behalf of* linked carriers |
| Not | Cross-carrier service product | A substitute for Owner multi-org fleet management |

**UI hide ≠ data access.** Client eligibility only controls chrome. Cross-org **reads** also require matching Postgres RLS (`auth_user_service_mode_org_ids` + membership SELECT paths). Phase 1b restores membership SELECT on profiles/roster/equipment/rigs, then narrows the SM helper to Permit Clerk.

---

## Related terms (quick)

| Term | Meaning |
|------|---------|
| **Primary owner** | Billing/home identity of an org (`is_primary_owner` on membership; profile may mirror). Not Service Mode eligibility. |
| **Owner Operator** | Home `user_roles = ['Owner','Driver']` — permissions merge only, not dual membership roles. |
| **Acting role** | Role used for nav/tools for the **effective** org. SSoT: `resolveActingActor` / `resolveActingRolesFromInputs` in `lib/nav-actor.ts` (§4.1). Membership role by default; OO home exception merges home multi-select. |
| **Forced carrier owner** | Break-glass via `NEXT_PUBLIC_FORCED_CARRIER_OWNER_EMAILS` / `FORCED_CARRIER_OWNER_EMAILS`. Empty env: production = none; dev/test = temporary legacy email (`lib/forced-carrier-owner.ts`). |
| **Platform admin** | Ops/migrations (`ADMIN_EMAILS` / app_metadata) — not an org role. |
| **Roster dual-source** | Team list merges `member_profiles` + `team_member_profiles`. Edit matrix: `docs/plans/roster-edit-matrix.md`. |

---

## Phase map (do not jump ahead)

| Phase | What freezes |
|-------|----------------|
| **0** | This glossary |
| **1** | Client gates: SM + connection invite = **membership** Clerk only; link approve → Viewer; self-Clerk PE blocks (app + DB triggers in 038) |
| **1b** | RLS: restore membership SELECT on profiles/roster/equipment/rigs, **then** SM helper = Clerk only (037) |
| **2** | Acting-role SSoT (`resolveActingActor`), roster edit matrix, forced-owner env |
| **3** | `service_seat` schema + seat∧Clerk RLS |
| **4** | UX polish / multi-org non-clerk switcher |

### Residual after Phase 1 / 1b / 038

- Live JWT RLS fixtures not required for Phase 1 unit suite; PE closed by app asserts + 038 triggers.
- Connection create requires `organization_memberships.role = Permit Clerk` (not home `user_roles` alone).
- Self-promote block is promotion-only (stay-as-Clerk allowed). Always pass `actorUserId` into membership sync when known.
