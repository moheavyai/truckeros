-- supabase/migrations/013_add_missing_rig_computed_columns.sql
--
-- The rig_configurations table may have been created from an older revision of
-- 010_tractors_trailers_rig_configurations.sql or 012_ensure_rig_builder_tables.sql
-- before all the cached computed_* columns were included in the CREATE TABLE.
--
-- The Rig Builder (saveCurrentRig) now always persists these three values
-- so that the Saved Rigs list, Rig Selector in /permit-test, and future
-- permit-request snapshots have fast access without re-computing geometry.
--
-- This migration is idempotent and safe to run on any database.

ALTER TABLE rig_configurations
  ADD COLUMN IF NOT EXISTS computed_total_length_ft numeric(7,2),
  ADD COLUMN IF NOT EXISTS computed_total_axles integer,
  ADD COLUMN IF NOT EXISTS computed_kingpin_to_last_axle_ft numeric(7,2);

COMMENT ON COLUMN rig_configurations.computed_kingpin_to_last_axle_ft IS
  'Distance (ft) from the first kingpin to the rear of the entire rig (approx last axle). '
  'Stored at save time from computeRigDimensions for fast bridge/axle-weight formulas '
  'and for the permit-request equipment snapshot.';

-- No additional indexes or RLS changes are required; these are simple user-owned
-- cache columns populated only by the authenticated Rig Builder.