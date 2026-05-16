# state_permit_rules Table Documentation

## Purpose
This table is the **core intelligence** of the TruckerOS Permit Agent. It stores per-state legal limits and permit thresholds for oversize and overweight loads. The agent queries this table for every state in a computed route corridor to determine exactly where permits are required.

## Current Coverage (Phase III — Expanded)

**56 jurisdictions**:
- **48 US states** (all except Hawaii)
- **8 Canadian provinces** (AB, BC, SK, MB, ON, QC, NB, NS)

Strong coverage of all major North American trucking corridors and key cross-border routes.

**Major Corridors Now Well Covered**:
- **I-10** (FL → CA)
- **I-35** (MN → TX)
- **I-40** (NC → CA)
- **I-70** (MD → UT)
- **I-80** (NY → CA)
- **I-81** (VA → PA — one of the busiest oversize routes in the East)
- **I-90 / I-94** (East to West)
- **I-95** (ME → FL)

Notable high-value additions in Phase II:
- **Pennsylvania (PA)** — Critical I-81 + Turnpike data
- **California (CA)** — Complex rules + curfews + escort thresholds
- **New York (NY)**, **Virginia (VA)**, **Maryland (MD)**, **West Virginia (WV)**
- **Texas (TX)**, **Arizona (AZ)**, **New Mexico (NM)**, **Utah (UT)**
- Full Midwest + Plains coverage (IL, OH, IN, MO, IA, KS, NE, MN, WI, SD, ND)
- Western expansion (CO, ID, WA, OR, WY, MT)

## Schema (after 003_enhance migration)

| Column Name                    | Description |
|--------------------------------|-------------|
| state_code                     | 2-letter USPS code (PK) |
| state_name                     | Full name |
| legal_*                        | True legal limits without permit |
| permit_threshold_*             | Point at which a permit becomes required (falls back to legal if null) |
| escort_threshold_*             | When escort/pilot cars are typically required |
| curfew_restrictions            | Time, weekend, or holiday movement restrictions |
| special_notes                  | Detailed operator guidance and gotchas |
| notes                          | Short summary for UI |
| source                         | Data origin (critical for trust) |
| updated_at / last_updated      | Audit trail |

## Data Quality Standards (Phase II)

- All major national trucking corridors have realistic, non-generic values.
- High-traffic states (PA, CA, TX, IL, OH, VA, TN, etc.) have rich `special_notes` and `curfew_restrictions`.
- Every record has a `source` field for traceability.
- Escort thresholds are populated for key states.
- Values reflect real carrier experience, not just federal minimums.

## How the Agent Uses the Data

For every state in `routeCorridor`:
```ts
needsPermit = width  > (permit_threshold_width_ft  ?? legal_width_ft) ||
              height > (permit_threshold_height_ft ?? legal_height_ft) ||
              ...
```

## Running the Improved Seed

After applying migration `003_enhance_state_permit_rules.sql`:

```bash
npx tsx supabase/seed-state-permit-rules.ts
```

The script uses `upsert` on `state_code`, so it is safe to re-run.

## Maintenance Philosophy

This database is **foundational**. Every improvement here directly increases the accuracy and trustworthiness of the Permit Agent. Future work should prioritize:
- Official DOT sources
- Real carrier feedback on problem routes
- Seasonal / holiday restrictions
- Bridge/tunnel specific clearances (future enhancement)

Last Updated: 2026-05 (Phase II Expansion)
