-- supabase/migrations/004_add_seasonal_restrictions.sql
--
-- Phase III Enhancement: Add support for seasonal weight restrictions
-- (frost laws, spring thaw restrictions, winter weight limits, axle-specific rules).
--
-- This is critical for northern US states and Canadian provinces.

ALTER TABLE state_permit_rules
  ADD COLUMN IF NOT EXISTS seasonal_weight_restrictions TEXT;

COMMENT ON COLUMN state_permit_rules.seasonal_weight_restrictions IS
  'Detailed notes on frost laws, spring thaw restrictions, winter weight increases, or seasonal axle/weight limits. Especially important for northern jurisdictions (MI, MN, WI, ND, ON, QC, AB, etc.).';

-- Optional index if we ever want to query for jurisdictions with seasonal rules
CREATE INDEX IF NOT EXISTS idx_state_permit_rules_has_seasonal
  ON state_permit_rules ((seasonal_weight_restrictions IS NOT NULL));