-- supabase/migrations/017_consolidate_rig_builder_schema.sql
--
-- Idempotent consolidation for Rig Builder schema gaps when 015/016 were not
-- applied on a remote database. Safe to run multiple times.

-- rig_configurations: default rig flag (015)
ALTER TABLE rig_configurations
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN rig_configurations.is_default IS
  'When true, this rig is auto-selected in Permit Agent on load. At most one per user.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_rig_configurations_one_default_per_user
  ON rig_configurations (user_id)
  WHERE is_default = true;

-- Dedicated tractors table (016)
ALTER TABLE tractors
  ADD COLUMN IF NOT EXISTS license_plate text,
  ADD COLUMN IF NOT EXISTS license_plate_state text;

ALTER TABLE tractors
  DROP CONSTRAINT IF EXISTS tractors_license_plate_state_check;

ALTER TABLE tractors
  ADD CONSTRAINT tractors_license_plate_state_check
  CHECK (license_plate_state IS NULL OR license_plate_state ~ '^[A-Z]{2}$');

COMMENT ON COLUMN tractors.license_plate IS 'Tractor license plate number (as registered).';
COMMENT ON COLUMN tractors.license_plate_state IS '2-letter US state code for tractor plate (e.g. TX).';

-- Dedicated trailers table (016)
ALTER TABLE trailers
  ADD COLUMN IF NOT EXISTS license_plate text,
  ADD COLUMN IF NOT EXISTS license_plate_state text;

ALTER TABLE trailers
  DROP CONSTRAINT IF EXISTS trailers_license_plate_state_check;

ALTER TABLE trailers
  ADD CONSTRAINT trailers_license_plate_state_check
  CHECK (license_plate_state IS NULL OR license_plate_state ~ '^[A-Z]{2}$');

COMMENT ON COLUMN trailers.license_plate IS 'Trailer license plate number (as registered).';
COMMENT ON COLUMN trailers.license_plate_state IS '2-letter US state code for trailer plate (e.g. TX).';

-- Legacy equipment_profiles (active Rig Builder storage path)
ALTER TABLE equipment_profiles
  ADD COLUMN IF NOT EXISTS license_plate text,
  ADD COLUMN IF NOT EXISTS license_plate_state text;

ALTER TABLE equipment_profiles
  DROP CONSTRAINT IF EXISTS equipment_profiles_license_plate_state_check;

ALTER TABLE equipment_profiles
  ADD CONSTRAINT equipment_profiles_license_plate_state_check
  CHECK (license_plate_state IS NULL OR license_plate_state ~ '^[A-Z]{2}$');

COMMENT ON COLUMN equipment_profiles.license_plate IS 'License plate for this tractor or trailer profile row.';
COMMENT ON COLUMN equipment_profiles.license_plate_state IS '2-letter US state code for license_plate on this profile row.';

NOTIFY pgrst, 'reload schema';