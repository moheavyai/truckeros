-- supabase/migrations/006_add_permit_pricing_to_state_rules.sql
--
-- Adds columns to support more realistic, state-specific permit cost estimates.
-- These values are seeded from publicly available state DOT fee schedules where possible.
--
-- This moves us away from the generic flat-fee model toward data-driven pricing.

ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS base_permit_fee_usd NUMERIC(8,2) DEFAULT 45.00;

ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS oversize_surcharge_width_usd NUMERIC(6,2) DEFAULT 25.00;

ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS oversize_surcharge_height_usd NUMERIC(6,2) DEFAULT 35.00;

ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS oversize_surcharge_length_usd NUMERIC(6,2) DEFAULT 20.00;

ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS overweight_surcharge_usd NUMERIC(6,2) DEFAULT 50.00;

-- Optional: per-mile or flat fees some states charge
ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS additional_notes_pricing TEXT;

COMMENT ON COLUMN state_permit_rules.base_permit_fee_usd IS 
'Base fee charged by the state for a standard oversize/overweight permit. Sourced from official state DOT fee schedules where available.';

COMMENT ON COLUMN state_permit_rules.overweight_surcharge_usd IS 
'Additional fee typically charged when the load exceeds legal weight limits.';

-- Index for future admin queries
CREATE INDEX IF NOT EXISTS idx_state_permit_rules_pricing 
ON state_permit_rules (base_permit_fee_usd);