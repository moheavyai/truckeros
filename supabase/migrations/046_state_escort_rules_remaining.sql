-- 046_state_escort_rules_remaining.sql
--
-- Seed structured escort_rules for the remaining states
-- (all except MO/TX/OK/KS/NE/IA already seeded in 045).
--
-- Values are operational heuristics aligned with common DOT practice.
-- Always confirm with the issuing authority. Source tags mark provenance.
-- Idempotent: only fills rows where escort_rules IS NULL.

-- ---------------------------------------------------------------------------
-- Template A — Midwest / Great Lakes remaining (IL IN MI MN OH WI)
-- ---------------------------------------------------------------------------
UPDATE state_permit_rules
SET
  escort_rules = '{
    "source": "MoHeavy AI national seed 2026-08 — Midwest/Great Lakes — verify against current DOT manuals",
    "lastVerified": "2026-08-14",
    "defaultNote": "Confirm final escort requirements on the issued permit. Local/city roads may require LE or additional pilots.",
    "bands": [
      {
        "when": { "minWidthFt": 12.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["chase"],
        "types": ["civilian"],
        "roadClasses": ["state_highway", "local"],
        "notes": "Often required on state highways at ≥12′ width; interstates may differ."
      },
      {
        "when": { "minWidthFt": 14.0 },
        "requirement": "required",
        "count": 2,
        "positions": ["lead", "chase"],
        "types": ["civilian"],
        "notes": "Two pilots (lead + chase) typical at ≥14′ width."
      },
      {
        "when": { "minLengthFt": 110.0 },
        "requirement": "required",
        "count": 2,
        "positions": ["lead", "chase"],
        "types": ["civilian"]
      },
      {
        "when": { "minHeightFt": 14.5 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["lead"],
        "types": ["civilian"],
        "heightPole": "recommended"
      },
      {
        "when": { "minHeightFt": 15.5 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["lead"],
        "types": ["civilian"],
        "heightPole": "required"
      }
    ]
  }'::jsonb,
  last_updated = NOW()
WHERE state_code IN ('IL', 'IN', 'MI', 'MN', 'OH', 'WI')
  AND escort_rules IS NULL;

-- ---------------------------------------------------------------------------
-- Template B — Southeast (AL AR FL GA KY LA MS NC SC TN VA WV)
-- ---------------------------------------------------------------------------
UPDATE state_permit_rules
SET
  escort_rules = '{
    "source": "MoHeavy AI national seed 2026-08 — Southeast — verify against current DOT manuals",
    "lastVerified": "2026-08-14",
    "defaultNote": "Confirm final escort requirements on the issued permit. Urban/city segments may require LE escorts.",
    "bands": [
      {
        "when": { "minWidthFt": 12.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["chase"],
        "types": ["civilian"],
        "roadClasses": ["state_highway", "local"],
        "notes": "Common pilot threshold on state routes at ≥12′."
      },
      {
        "when": { "minWidthFt": 14.0 },
        "requirement": "required",
        "count": 2,
        "positions": ["lead", "chase"],
        "types": ["civilian"],
        "notes": "Two civilian pilots typical at ≥14′; some metros require LE at lower widths."
      },
      {
        "when": { "minLengthFt": 100.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["chase"],
        "types": ["civilian"],
        "notes": "Long loads (≥100′) often need at least one pilot on two-lane routes."
      },
      {
        "when": { "minLengthFt": 120.0 },
        "requirement": "required",
        "count": 2,
        "positions": ["lead", "chase"],
        "types": ["civilian"]
      },
      {
        "when": { "minHeightFt": 14.5 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["lead"],
        "types": ["civilian"],
        "heightPole": "recommended"
      },
      {
        "when": { "minHeightFt": 15.5 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["lead"],
        "types": ["civilian"],
        "heightPole": "required"
      }
    ]
  }'::jsonb,
  last_updated = NOW()
WHERE state_code IN ('AL', 'AR', 'FL', 'GA', 'KY', 'LA', 'MS', 'NC', 'SC', 'TN', 'VA', 'WV')
  AND escort_rules IS NULL;

-- ---------------------------------------------------------------------------
-- Template C — Northeast corridor (CT DE MA MD ME NH NJ NY PA RI VT)
-- ---------------------------------------------------------------------------
UPDATE state_permit_rules
SET
  escort_rules = '{
    "source": "MoHeavy AI national seed 2026-08 — Northeast — verify against current DOT manuals",
    "lastVerified": "2026-08-14",
    "defaultNote": "Northeast routes often mix interstate with restricted local roads. LE escorts are common in metro areas — confirm on the permit.",
    "bands": [
      {
        "when": { "minWidthFt": 11.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["chase"],
        "types": ["civilian"],
        "roadClasses": ["local", "state_highway"],
        "notes": "Some northeastern states flag escorts near 11–12′ on secondary roads."
      },
      {
        "when": { "minWidthFt": 12.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["chase"],
        "types": ["civilian"],
        "roadClasses": ["state_highway", "us_highway"]
      },
      {
        "when": { "minWidthFt": 14.0 },
        "requirement": "required",
        "count": 2,
        "positions": ["lead", "chase"],
        "types": ["civilian"],
        "notes": "Two pilots typical at ≥14′. Urban segments may require LE in addition."
      },
      {
        "when": { "minWidthFt": 16.0 },
        "requirement": "required",
        "count": 2,
        "positions": ["lead", "chase"],
        "types": ["civilian", "law_enforcement"],
        "roadClasses": ["local", "state_highway"],
        "notes": "Wide loads on local roads frequently require LE involvement."
      },
      {
        "when": { "minLengthFt": 100.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["chase"],
        "types": ["civilian"]
      },
      {
        "when": { "minLengthFt": 120.0 },
        "requirement": "required",
        "count": 2,
        "positions": ["lead", "chase"],
        "types": ["civilian"]
      },
      {
        "when": { "minHeightFt": 14.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["lead"],
        "types": ["civilian"],
        "heightPole": "recommended",
        "notes": "Older bridges and urban overpasses — height pole strongly recommended."
      },
      {
        "when": { "minHeightFt": 15.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["lead"],
        "types": ["civilian"],
        "heightPole": "required"
      }
    ]
  }'::jsonb,
  last_updated = NOW()
WHERE state_code IN ('CT', 'DE', 'MA', 'MD', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT')
  AND escort_rules IS NULL;

-- ---------------------------------------------------------------------------
-- Template D — Mountain / Plains West (AZ CO ID MT NV NM ND SD UT WY)
-- ---------------------------------------------------------------------------
UPDATE state_permit_rules
SET
  escort_rules = '{
    "source": "MoHeavy AI national seed 2026-08 — Mountain/Plains West — verify against current DOT manuals",
    "lastVerified": "2026-08-14",
    "defaultNote": "Mountain grades, curves, and seasonal restrictions change escort needs. Confirm with the issuing DOT.",
    "bands": [
      {
        "when": { "minWidthFt": 12.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["chase"],
        "types": ["civilian"],
        "roadClasses": ["state_highway", "us_highway"]
      },
      {
        "when": { "minWidthFt": 14.0 },
        "requirement": "required",
        "count": 2,
        "positions": ["lead", "chase"],
        "types": ["civilian"]
      },
      {
        "when": { "minLengthFt": 110.0 },
        "requirement": "required",
        "count": 2,
        "positions": ["lead", "chase"],
        "types": ["civilian"],
        "notes": "Long loads on two-lane mountain routes typically need lead + chase."
      },
      {
        "when": { "minHeightFt": 14.5 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["lead"],
        "types": ["civilian"],
        "heightPole": "recommended"
      },
      {
        "when": { "minHeightFt": 15.5 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["lead"],
        "types": ["civilian"],
        "heightPole": "required"
      },
      {
        "when": { "minWeightLbs": 150000 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["chase"],
        "types": ["civilian"],
        "notes": "Heavy loads may trigger additional pilots or LE on restricted structures."
      }
    ]
  }'::jsonb,
  last_updated = NOW()
WHERE state_code IN ('AZ', 'CO', 'ID', 'MT', 'NV', 'NM', 'ND', 'SD', 'UT', 'WY')
  AND escort_rules IS NULL;

-- ---------------------------------------------------------------------------
-- Template E — Pacific (CA OR WA)
-- ---------------------------------------------------------------------------
UPDATE state_permit_rules
SET
  escort_rules = '{
    "source": "MoHeavy AI national seed 2026-08 — Pacific — verify against current DOT manuals",
    "lastVerified": "2026-08-14",
    "defaultNote": "Pacific states (especially CA) publish detailed escort matrices. Confirm exact counts and LE requirements on the permit.",
    "bands": [
      {
        "when": { "minWidthFt": 12.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["chase"],
        "types": ["civilian"],
        "roadClasses": ["state_highway", "local"]
      },
      {
        "when": { "minWidthFt": 13.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["lead"],
        "types": ["civilian"],
        "notes": "CA often requires a pilot near 12–13′ depending on route class."
      },
      {
        "when": { "minWidthFt": 15.0 },
        "requirement": "required",
        "count": 2,
        "positions": ["lead", "chase"],
        "types": ["civilian"]
      },
      {
        "when": { "minLengthFt": 105.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["chase"],
        "types": ["civilian"]
      },
      {
        "when": { "minLengthFt": 120.0 },
        "requirement": "required",
        "count": 2,
        "positions": ["lead", "chase"],
        "types": ["civilian"]
      },
      {
        "when": { "minHeightFt": 14.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["lead"],
        "types": ["civilian"],
        "heightPole": "recommended"
      },
      {
        "when": { "minHeightFt": 15.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["lead"],
        "types": ["civilian"],
        "heightPole": "required",
        "notes": "Height pole commonly required approaching 15′."
      }
    ]
  }'::jsonb,
  last_updated = NOW()
WHERE state_code IN ('CA', 'OR', 'WA')
  AND escort_rules IS NULL;

-- ---------------------------------------------------------------------------
-- Template F — Alaska & Hawaii (special cases)
-- ---------------------------------------------------------------------------
UPDATE state_permit_rules
SET
  escort_rules = '{
    "source": "MoHeavy AI national seed 2026-08 — AK/HI special — verify against current DOT manuals",
    "lastVerified": "2026-08-14",
    "defaultNote": "AK and HI have unique routing and escort practices. Always follow the state permit package.",
    "bands": [
      {
        "when": { "minWidthFt": 12.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["chase"],
        "types": ["civilian"],
        "notes": "Island/remote routes may require pilots at lower thresholds than mainland norms."
      },
      {
        "when": { "minWidthFt": 14.0 },
        "requirement": "required",
        "count": 2,
        "positions": ["lead", "chase"],
        "types": ["civilian"]
      },
      {
        "when": { "minHeightFt": 14.5 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["lead"],
        "types": ["civilian"],
        "heightPole": "recommended"
      },
      {
        "when": { "minHeightFt": 15.5 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["lead"],
        "types": ["civilian"],
        "heightPole": "required"
      }
    ]
  }'::jsonb,
  last_updated = NOW()
WHERE state_code IN ('AK', 'HI')
  AND escort_rules IS NULL;

NOTIFY pgrst, 'reload schema';

-- Optional verification (run after apply):
-- SELECT state_code, escort_rules IS NOT NULL AS has_rules
-- FROM state_permit_rules
-- ORDER BY state_code;
