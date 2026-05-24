# Supabase — State Permit Rules (Core Intelligence)

This folder contains the **foundational data layer** for the TruckerOS Permit Agent.

## Current Status: Phase III — Expanded North American Coverage

- **56 jurisdictions**: 48 US states + 8 Canadian provinces (AB, BC, SK, MB, ON, QC, NB, NS)
- Strong coverage of all major US corridors + major Canadian cross-border routes
- Rich `special_notes`, `curfew_restrictions`, `seasonal_weight_restrictions` (frost laws), escort thresholds, and source traceability
- Migration `003_enhance_state_permit_rules.sql` added for richer columns
- Agent updated with Canadian-aware terminology and logic

## Key Files

- `migrations/001_create_state_permit_rules.sql` — Core table
- `migrations/003_enhance_state_permit_rules.sql` — Added `source`, `special_notes`, `curfew_restrictions`, escort thresholds, `last_updated`
- `seed-state-permit-rules.ts` — High-quality seed with 39 states (run after migrations)

## How to Run the Seed

```bash
# 1. Install dependencies (one time)
npm install

# 2. Make sure your .env.local has valid Supabase keys
#    (the script uses the anon key by default — fine for development)

# 3. Run the seed
npm run seed:state-rules
```

The script is safe to re-run. It uses `upsert` on `state_code`.

## Table Purpose

The `state_permit_rules` table powers the data-driven logic inside `agents/permit-agent.ts`.

For any load that exceeds standard legal dimensions, the agent looks up each state in the route corridor and checks:

```ts
needsPermit = width  > (permit_threshold_width_ft  ?? legal_width_ft)  ||
              height > (permit_threshold_height_ft ?? legal_height_ft) ||
              ...
```

If a state has no row, the agent falls back to "requires permit" (conservative).

## Security & Ownership (Completed)

- `user_id` column + full Row Level Security (RLS) policies have been added via migration `005_add_user_id_and_rls_to_permit_requests.sql`.
- Users can only view, insert, update, or delete their own `permit_requests` records.
- This enables secure "My Requests" functionality in the future.

## Next Steps

- Create an admin UI to maintain state permit rules.
- Expand seed data to all 50 states + territories (some already added).
- Build "My Requests" history view in the dashboard.

---

## Migration History & Important Gotchas (001–011+)

**Always run migrations in order** (001 → 011+). The Supabase CLI does this automatically when you `supabase db push` or `supabase migration up`.

### Known Gaps in the Committed Migration Set
- The initial `CREATE TABLE` for `permit_requests` (and a few other base tables) is **not present** in any file in this repo. Only ALTERs exist (002, 005, 009). In practice the table was created by early dashboard SQL or a bootstrap that was never committed. When provisioning a brand-new Supabase project you must ensure the base tables exist before 002/005/008/009 will succeed.
- The `update_updated_at_column()` plpgsql function is (re)created in 007 and 008. Migrations 009–011 rely on it. Running only "8,9,10" on a fresh DB can leave the function (or earlier RLS/indexes) missing.

### equipment_profiles (the "legacy kitchen-sink" table)
- Created in **009** as a simple table for the original intake form (`axle_spacing text`, no `type` column).
- **010** deliberately left it untouched and introduced the proper normalized tables (`tractors`, `trailers`, `rig_configurations` with `axle_spacings jsonb`).
- The `/equipment` Rig Builder (and the Rig Selector in permit-test) **still writes exclusively to the legacy table** using the `RIGBUILDER:v1:JSON-in-notes` pattern + a `type` discriminator. This is an intentional MVP shortcut documented in the code comments.
- **011** is the first migration that captures the *actual* shape required by the current Rig Builder:
  - Adds `type text` (with lenient CHECK for legacy rows)
  - Converts `axle_spacing` to `text[]` (with safe backfill of old strings)
  - Backfills `type` for existing RIGBUILDER rows
- After 011, both the Equipment & Rig Builder **and** the legacy permit-test "save profile" path produce valid rows.

### Future Direction
When the team is ready, the Rig Builder should be ported to insert into the dedicated tables created in 010. At that point `equipment_profiles` becomes read-only legacy data for old intake records, and the "kitchen-sink" pattern can be retired.

**Rule of thumb**: any time you add a new top-level column or change a type that the builder or legacy intake writes, add (or update) a migration **before** merging. Manual ALTERs in the SQL editor are the #1 source of the "it works on my machine but not on a clean migration" pain we have seen with the type / axle_spacing errors.
