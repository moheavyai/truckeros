-- 047_state_permit_rules_all_50.sql
--
-- 1) INSERT any missing state_permit_rules rows (national legal defaults)
-- 2) Ensure escort_rules populated for all 50 states
-- Idempotent. Does not overwrite existing non-null escort_rules or legal limits.

-- ---------------------------------------------------------------------------
-- Step 1: ensure a row exists for every state
-- ---------------------------------------------------------------------------
INSERT INTO state_permit_rules (
  state_code, state_name,
  legal_width_ft, legal_height_ft, legal_length_ft, legal_weight_lbs,
  source, notes, last_updated
) VALUES
  ('AL', 'Alabama', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('AK', 'Alaska', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('AZ', 'Arizona', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('AR', 'Arkansas', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('CA', 'California', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('CO', 'Colorado', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('CT', 'Connecticut', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('DE', 'Delaware', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('FL', 'Florida', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('GA', 'Georgia', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('HI', 'Hawaii', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('ID', 'Idaho', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('IL', 'Illinois', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('IN', 'Indiana', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('IA', 'Iowa', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('KS', 'Kansas', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('KY', 'Kentucky', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('LA', 'Louisiana', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('ME', 'Maine', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('MD', 'Maryland', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('MA', 'Massachusetts', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('MI', 'Michigan', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('MN', 'Minnesota', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('MS', 'Mississippi', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('MO', 'Missouri', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('MT', 'Montana', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('NE', 'Nebraska', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('NV', 'Nevada', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('NH', 'New Hampshire', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('NJ', 'New Jersey', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('NM', 'New Mexico', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('NY', 'New York', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('NC', 'North Carolina', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('ND', 'North Dakota', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('OH', 'Ohio', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('OK', 'Oklahoma', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('OR', 'Oregon', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('PA', 'Pennsylvania', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('RI', 'Rhode Island', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('SC', 'South Carolina', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('SD', 'South Dakota', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('TN', 'Tennessee', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('TX', 'Texas', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('UT', 'Utah', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('VT', 'Vermont', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('VA', 'Virginia', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('WA', 'Washington', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('WV', 'West Virginia', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('WI', 'Wisconsin', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW()),
  ('WY', 'Wyoming', 8.50, 13.50, 53.00, 80000,
   'MoHeavy AI national seed 2026-08 — defaults; refine per DOT manual',
   'National default legal limits. Refine thresholds from state DOT manuals.',
   NOW())
ON CONFLICT (state_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Step 2: fill escort_rules where still NULL (regional templates)
-- ---------------------------------------------------------------------------
-- midwest: 'IL', 'IN', 'MI', 'MN', 'OH', 'WI'
UPDATE state_permit_rules
SET
  escort_rules = '{
    "source": "MoHeavy AI national seed 2026-08 — Midwest/Great Lakes — verify against current DOT manuals",
    "lastVerified": "2026-08-14",
    "defaultNote": "Confirm final escort requirements on the issued permit. Local/city roads may require LE or additional pilots.",
    "bands": [
      {"when": {"minWidthFt": 12.0}, "requirement": "may_require", "count": 1, "positions": ["chase"], "types": ["civilian"], "roadClasses": ["state_highway", "local"], "notes": "Often required on state highways at ≥12′ width; interstates may differ."},
      {"when": {"minWidthFt": 14.0}, "requirement": "required", "count": 2, "positions": ["lead", "chase"], "types": ["civilian"], "notes": "Two pilots (lead + chase) typical at ≥14′ width."},
      {"when": {"minLengthFt": 110.0}, "requirement": "required", "count": 2, "positions": ["lead", "chase"], "types": ["civilian"]},
      {"when": {"minHeightFt": 14.5}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "heightPole": "recommended"},
      {"when": {"minHeightFt": 15.5}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "heightPole": "required"}
    ]
  }'::jsonb,
  last_updated = NOW()
WHERE state_code IN ('IL', 'IN', 'MI', 'MN', 'OH', 'WI')
  AND escort_rules IS NULL;

-- southeast: 'AL', 'AR', 'FL', 'GA', 'KY', 'LA', 'MS', 'NC', 'SC', 'TN', 'VA', 'WV'
UPDATE state_permit_rules
SET
  escort_rules = '{
    "source": "MoHeavy AI national seed 2026-08 — Southeast — verify against current DOT manuals",
    "lastVerified": "2026-08-14",
    "defaultNote": "Confirm final escort requirements on the issued permit. Urban/city segments may require LE escorts.",
    "bands": [
      {"when": {"minWidthFt": 12.0}, "requirement": "may_require", "count": 1, "positions": ["chase"], "types": ["civilian"], "roadClasses": ["state_highway", "local"], "notes": "Common pilot threshold on state routes at ≥12′."},
      {"when": {"minWidthFt": 14.0}, "requirement": "required", "count": 2, "positions": ["lead", "chase"], "types": ["civilian"], "notes": "Two civilian pilots typical at ≥14′; some metros require LE at lower widths."},
      {"when": {"minLengthFt": 100.0}, "requirement": "may_require", "count": 1, "positions": ["chase"], "types": ["civilian"], "notes": "Long loads (≥100′) often need at least one pilot on two-lane routes."},
      {"when": {"minLengthFt": 120.0}, "requirement": "required", "count": 2, "positions": ["lead", "chase"], "types": ["civilian"]},
      {"when": {"minHeightFt": 14.5}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "heightPole": "recommended"},
      {"when": {"minHeightFt": 15.5}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "heightPole": "required"}
    ]
  }'::jsonb,
  last_updated = NOW()
WHERE state_code IN ('AL', 'AR', 'FL', 'GA', 'KY', 'LA', 'MS', 'NC', 'SC', 'TN', 'VA', 'WV')
  AND escort_rules IS NULL;

-- northeast: 'CT', 'DE', 'MA', 'MD', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT'
UPDATE state_permit_rules
SET
  escort_rules = '{
    "source": "MoHeavy AI national seed 2026-08 — Northeast — verify against current DOT manuals",
    "lastVerified": "2026-08-14",
    "defaultNote": "Northeast routes often mix interstate with restricted local roads. LE escorts are common in metro areas — confirm on the permit.",
    "bands": [
      {"when": {"minWidthFt": 11.0}, "requirement": "may_require", "count": 1, "positions": ["chase"], "types": ["civilian"], "roadClasses": ["local", "state_highway"], "notes": "Some northeastern states flag escorts near 11–12′ on secondary roads."},
      {"when": {"minWidthFt": 12.0}, "requirement": "may_require", "count": 1, "positions": ["chase"], "types": ["civilian"], "roadClasses": ["state_highway", "us_highway"]},
      {"when": {"minWidthFt": 14.0}, "requirement": "required", "count": 2, "positions": ["lead", "chase"], "types": ["civilian"], "notes": "Two pilots typical at ≥14′. Urban segments may require LE in addition."},
      {"when": {"minWidthFt": 16.0}, "requirement": "required", "count": 2, "positions": ["lead", "chase"], "types": ["civilian", "law_enforcement"], "roadClasses": ["local", "state_highway"], "notes": "Wide loads on local roads frequently require LE involvement."},
      {"when": {"minLengthFt": 100.0}, "requirement": "may_require", "count": 1, "positions": ["chase"], "types": ["civilian"]},
      {"when": {"minLengthFt": 120.0}, "requirement": "required", "count": 2, "positions": ["lead", "chase"], "types": ["civilian"]},
      {"when": {"minHeightFt": 14.0}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "heightPole": "recommended", "notes": "Older bridges and urban overpasses — height pole strongly recommended."},
      {"when": {"minHeightFt": 15.0}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "heightPole": "required"}
    ]
  }'::jsonb,
  last_updated = NOW()
WHERE state_code IN ('CT', 'DE', 'MA', 'MD', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT')
  AND escort_rules IS NULL;

-- mountain: 'AZ', 'CO', 'ID', 'MT', 'NV', 'NM', 'ND', 'SD', 'UT', 'WY'
UPDATE state_permit_rules
SET
  escort_rules = '{
    "source": "MoHeavy AI national seed 2026-08 — Mountain/Plains West — verify against current DOT manuals",
    "lastVerified": "2026-08-14",
    "defaultNote": "Mountain grades, curves, and seasonal restrictions change escort needs. Confirm with the issuing DOT.",
    "bands": [
      {"when": {"minWidthFt": 12.0}, "requirement": "may_require", "count": 1, "positions": ["chase"], "types": ["civilian"], "roadClasses": ["state_highway", "us_highway"]},
      {"when": {"minWidthFt": 14.0}, "requirement": "required", "count": 2, "positions": ["lead", "chase"], "types": ["civilian"]},
      {"when": {"minLengthFt": 110.0}, "requirement": "required", "count": 2, "positions": ["lead", "chase"], "types": ["civilian"], "notes": "Long loads on two-lane mountain routes typically need lead + chase."},
      {"when": {"minHeightFt": 14.5}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "heightPole": "recommended"},
      {"when": {"minHeightFt": 15.5}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "heightPole": "required"},
      {"when": {"minWeightLbs": 150000}, "requirement": "may_require", "count": 1, "positions": ["chase"], "types": ["civilian"], "notes": "Heavy loads may trigger additional pilots or LE on restricted structures."}
    ]
  }'::jsonb,
  last_updated = NOW()
WHERE state_code IN ('AZ', 'CO', 'ID', 'MT', 'NV', 'NM', 'ND', 'SD', 'UT', 'WY')
  AND escort_rules IS NULL;

-- pacific: 'CA', 'OR', 'WA'
UPDATE state_permit_rules
SET
  escort_rules = '{
    "source": "MoHeavy AI national seed 2026-08 — Pacific — verify against current DOT manuals",
    "lastVerified": "2026-08-14",
    "defaultNote": "Pacific states (especially CA) publish detailed escort matrices. Confirm exact counts and LE requirements on the permit.",
    "bands": [
      {"when": {"minWidthFt": 12.0}, "requirement": "may_require", "count": 1, "positions": ["chase"], "types": ["civilian"], "roadClasses": ["state_highway", "local"]},
      {"when": {"minWidthFt": 13.0}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "notes": "CA often requires a pilot near 12–13′ depending on route class."},
      {"when": {"minWidthFt": 15.0}, "requirement": "required", "count": 2, "positions": ["lead", "chase"], "types": ["civilian"]},
      {"when": {"minLengthFt": 105.0}, "requirement": "may_require", "count": 1, "positions": ["chase"], "types": ["civilian"]},
      {"when": {"minLengthFt": 120.0}, "requirement": "required", "count": 2, "positions": ["lead", "chase"], "types": ["civilian"]},
      {"when": {"minHeightFt": 14.0}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "heightPole": "recommended"},
      {"when": {"minHeightFt": 15.0}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "heightPole": "required", "notes": "Height pole commonly required approaching 15′."}
    ]
  }'::jsonb,
  last_updated = NOW()
WHERE state_code IN ('CA', 'OR', 'WA')
  AND escort_rules IS NULL;

-- akhi: 'AK', 'HI'
UPDATE state_permit_rules
SET
  escort_rules = '{
    "source": "MoHeavy AI national seed 2026-08 — AK/HI special — verify against current DOT manuals",
    "lastVerified": "2026-08-14",
    "defaultNote": "AK and HI have unique routing and escort practices. Always follow the state permit package.",
    "bands": [
      {"when": {"minWidthFt": 12.0}, "requirement": "may_require", "count": 1, "positions": ["chase"], "types": ["civilian"], "notes": "Island/remote routes may require pilots at lower thresholds than mainland norms."},
      {"when": {"minWidthFt": 14.0}, "requirement": "required", "count": 2, "positions": ["lead", "chase"], "types": ["civilian"]},
      {"when": {"minHeightFt": 14.5}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "heightPole": "recommended"},
      {"when": {"minHeightFt": 15.5}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "heightPole": "required"}
    ]
  }'::jsonb,
  last_updated = NOW()
WHERE state_code IN ('AK', 'HI')
  AND escort_rules IS NULL;

-- corridor: 'MO', 'TX', 'OK', 'KS', 'NE', 'IA'
UPDATE state_permit_rules
SET
  escort_rules = '{
    "source": "MoHeavy AI corridor seed 2026-08 — verify against current DOT manuals",
    "lastVerified": "2026-08-13",
    "defaultNote": "Confirm final escort requirements on the issued permit.",
    "bands": [
      {"when": {"minWidthFt": 12.0}, "requirement": "may_require", "count": 1, "positions": ["chase"], "types": ["civilian"], "notes": "Often required on state highways at ≥12′ width; local roads may differ."},
      {"when": {"minWidthFt": 14.0}, "requirement": "required", "count": 2, "positions": ["lead", "chase"], "types": ["civilian"], "notes": "Two pilots (lead + chase) typical at ≥14′ width on state routes."},
      {"when": {"minLengthFt": 110.0}, "requirement": "required", "count": 2, "positions": ["lead", "chase"], "types": ["civilian"]},
      {"when": {"minHeightFt": 14.5}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "heightPole": "recommended", "notes": "Height pole recommended; lead pilot common on restricted corridors."},
      {"when": {"minHeightFt": 15.5}, "requirement": "may_require", "count": 1, "positions": ["lead"], "types": ["civilian"], "heightPole": "required"}
    ]
  }'::jsonb,
  last_updated = NOW()
WHERE state_code IN ('MO', 'TX', 'OK', 'KS', 'NE', 'IA')
  AND escort_rules IS NULL;

NOTIFY pgrst, 'reload schema';
