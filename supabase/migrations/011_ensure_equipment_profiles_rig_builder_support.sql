-- supabase/migrations/011_ensure_equipment_profiles_rig_builder_support.sql
--
-- Post-010 evolution of the legacy equipment_profiles table.
--
-- Context:
--   * 009 created the original "kitchen-sink" table for the intake form (axle_spacing as plain text).
--   * 010 introduced proper normalized tables (tractors / trailers / rig_configurations with jsonb axle_spacings)
--     and explicitly stated "old equipment_profiles table remains untouched".
--   * The /equipment Rig Builder (and RigSelector) continued to target the legacy table using
--     RIGBUILDER:v1: JSON-in-notes + a few top-level columns + a 'type' discriminator.
--   * The live DB received manual ALTERs (type NOT NULL, axle_spacing → text[]) that were never captured.
--
-- This migration makes the *current* expected shape explicit so that:
--   - Running the full 001→011 sequence on a fresh Supabase project produces a working DB.
--   - New Tractor / Trailer / Rig saves from the Equipment & Rig Builder succeed.
--   - Legacy rows from the permit-test intake path continue to work.
--
-- Future: Once the dedicated tables from 010 are adopted in the UI, new builder rows can move off
--         equipment_profiles entirely (this table can then be treated as read-only legacy data).

-- 1. Add the discriminator column used by the Rig Builder (tractor / trailer / rig)
ALTER TABLE equipment_profiles
  ADD COLUMN IF NOT EXISTS type text;

-- Lenient CHECK so we do not break existing legacy rows that have no type yet.
-- New rows written by the builder will always have a valid value.
ALTER TABLE equipment_profiles
  DROP CONSTRAINT IF EXISTS equipment_profiles_type_check;

ALTER TABLE equipment_profiles
  ADD CONSTRAINT equipment_profiles_type_check
  CHECK (type IS NULL OR type IN ('tractor', 'trailer', 'rig'));

COMMENT ON COLUMN equipment_profiles.type IS
  'Discriminator for rows written by the Rig Builder (''tractor'', ''trailer'', or ''rig''). '
  'Legacy rows from the original intake may be NULL.';

-- 2. Change axle_spacing from text (single human string) to text[] (array of inch values).
--    Existing string values are wrapped into a single-element array so we do not lose data.
--    New builder saves now send proper PostgreSQL array literals e.g. '{148,48}'.
ALTER TABLE equipment_profiles
  ALTER COLUMN axle_spacing
  TYPE text[]
  USING CASE
          WHEN axle_spacing IS NULL THEN NULL
          ELSE ARRAY[axle_spacing]
        END;

COMMENT ON COLUMN equipment_profiles.axle_spacing IS
  'Axle spacing data. '
  'Legacy intake rows: single-element text[] containing the original human string. '
  'Rig Builder rows: proper multi-value array (e.g. ''{148,48}'') stored as text[]. '
  'See also the rich data inside the notes JSON (RIGBUILDER:v1:...) for the new builder.';

-- 3. Optional backfill for any pre-existing RIGBUILDER rows that lack a top-level type.
--    This is safe and idempotent.
UPDATE equipment_profiles
SET type = COALESCE(
  type,
  CASE
    WHEN notes LIKE 'RIGBUILDER:v1:%' THEN
      COALESCE(
        (regexp_match(notes, '"type":"(tractor|trailer|rig)"'))[1],
        'tractor'   -- conservative default if we cannot parse
      )
    ELSE NULL
  END
)
WHERE type IS NULL
  AND notes LIKE 'RIGBUILDER:v1:%';

-- 4. Ensure the updated_at trigger still exists (defensive – 009 already does this,
--    but some teams run only 008+ on fresh projects).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_equipment_profiles_updated_at'
  ) THEN
    CREATE TRIGGER update_equipment_profiles_updated_at
      BEFORE UPDATE ON equipment_profiles
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Final table comment update
COMMENT ON TABLE equipment_profiles IS
  'Legacy "kitchen sink" table for saved equipment profiles (intake form + current Rig Builder). '
  'Rich tractor/trailer/rig details live primarily in the notes JSON (RIGBUILDER:v1:...). '
  'Top-level columns provide backward compatibility and quick filters. '
  'Future builder data should migrate to the dedicated tractors/trailers/rig_configurations tables introduced in 010.';

-- End of 011 – equipment_profiles is now safe for the current Rig Builder implementation.