-- 045_state_escort_rules_jsonb.sql
--
-- Fortify escort modeling without breaking existing threshold columns.
-- Adds optional structured escort_rules (jsonb) for:
--   requirement level (may_require | required)
--   count, positions (lead/chase), vehicle type (civilian/LE)
--   height pole level, road-class scope, notes
--
-- Existing escort_threshold_* columns remain the fallback when escort_rules is null.
-- Idempotent.

ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS escort_rules JSONB;

COMMENT ON COLUMN state_permit_rules.escort_rules IS
  'Optional structured escort bands. Shape: { bands: [{ when: { minWidthFt?, minHeightFt?, minLengthFt?, minWeightLbs? }, requirement: "may_require"|"required", count: number, positions?: ["lead"|"chase"], types?: ["civilian"|"law_enforcement"], heightPole?: "recommended"|"required", roadClasses?: string[], notes?: string }], defaultNote?, source?, lastVerified? }. When null, lib/escort-analysis falls back to escort_threshold_* columns + national baselines.';

-- Seed structured bands for high-traffic corridor states (MO, TX, OK, KS, NE, IA).
-- Values are operational heuristics aligned with common DOT practice; always confirm
-- with the issuing authority. Source tags mark provenance for later audit.

UPDATE state_permit_rules
SET
  escort_rules = '{
    "source": "MoHeavy AI corridor seed 2026-08 — verify against current DOT manuals",
    "lastVerified": "2026-08-13",
    "defaultNote": "Confirm final escort requirements on the issued permit.",
    "bands": [
      {
        "when": { "minWidthFt": 12.0 },
        "requirement": "may_require",
        "count": 1,
        "positions": ["chase"],
        "types": ["civilian"],
        "notes": "Often required on state highways at >=12 width; local roads may differ."
      },
      {
        "when": { "minWidthFt": 14.0 },
        "requirement": "required",
        "count": 2,
        "positions": ["lead", "chase"],
        "types": ["civilian"],
        "notes": "Two pilots (lead + chase) typical at >=14 width on state routes."
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
        "heightPole": "recommended",
        "notes": "Height pole recommended; lead pilot common on restricted corridors."
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
WHERE state_code IN ('MO', 'TX', 'OK', 'KS', 'NE', 'IA')
  AND escort_rules IS NULL;

NOTIFY pgrst, 'reload schema';
