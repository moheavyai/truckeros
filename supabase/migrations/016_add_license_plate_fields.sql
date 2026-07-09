-- supabase/migrations/016_add_license_plate_fields.sql
--
-- License plate + issuing state for tractors and trailers (Rig Builder / permit snapshots).
-- Primary runtime storage remains RIGBUILDER:v1: JSON in equipment_profiles.notes;
-- these columns support dedicated tables and optional top-level equipment_profiles fields.

-- Dedicated tractors table (010)
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

-- Dedicated trailers table (010)
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