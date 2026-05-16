-- supabase/migrations/003_enhance_state_permit_rules.sql
--
-- Phase II Enhancement: Strengthen the State Permit Rules Database
-- Adds richer columns for better data quality, escort requirements,
-- restrictions, and traceability. Safe to run multiple times.
--
-- Run this before re-seeding with the improved data set.

-- Add source / traceability
ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS source TEXT;

-- Add more detailed notes (separate from the simple 'notes' field)
ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS special_notes TEXT;

-- Curfew / time restrictions (very common in real permitting)
ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS curfew_restrictions TEXT;

-- Escort vehicle thresholds (critical for high-traffic corridors)
ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS escort_threshold_width_ft   NUMERIC(4,2);
ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS escort_threshold_height_ft  NUMERIC(4,2);
ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS escort_threshold_length_ft  NUMERIC(5,2);
ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS escort_threshold_weight_lbs INTEGER;

-- More precise last updated tracking (in addition to updated_at)
ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ DEFAULT NOW();

-- Update comments for clarity
COMMENT ON COLUMN state_permit_rules.source IS
  'Origin of the data (e.g. "Phase II Expansion - Research", "State DOT Manual", "Federal Default"). Used for auditability.';

COMMENT ON COLUMN state_permit_rules.special_notes IS
  'Detailed operator notes, route-specific warnings, or state-specific quirks.';

COMMENT ON COLUMN state_permit_rules.curfew_restrictions IS
  'Time-of-day, weekend, or holiday travel restrictions common in this state.';

COMMENT ON COLUMN state_permit_rules.escort_threshold_width_ft IS
  'Width at which one or more escort vehicles are typically required.';

-- Helpful index for future admin queries
CREATE INDEX IF NOT EXISTS idx_state_permit_rules_last_updated
  ON state_permit_rules (last_updated DESC);

-- Note: After running this migration, re-run the improved seed script
-- to populate the new columns with high-quality data for major corridors.