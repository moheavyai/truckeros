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
