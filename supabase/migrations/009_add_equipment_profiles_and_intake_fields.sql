-- supabase/migrations/009_add_equipment_profiles_and_intake_fields.sql
--
-- Intake Form Workflow improvement (equipment profiles + richer load capture).
-- - New table: equipment_profiles (user-owned saved tractor+trailer configs)
-- - Extends permit_requests with JSONB columns for equipment snapshot + cargo details
--   so every saved request records exactly what rig + load was analyzed.
--
-- All patterns match prior migrations (007/008): RLS, user_id FK, updated_at trigger, indexes.

CREATE TABLE IF NOT EXISTS equipment_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  profile_name text NOT NULL,                 -- e.g. "Pete 389 #4721 + 53' flatbed"

  -- Tractor / Power Unit
  unit_number text,
  vin text,
  year integer,
  make text,
  model text,
  axles integer,
  axle_spacing text,                          -- carrier-friendly string, e.g. "6 ft, 4 ft 10 in, ..."
  tire_width_in numeric(4,2),
  registered_gvw_lbs integer,
  kingpin_setting_in numeric(5,2),

  -- Trailer (MVP keeps simple; can expand to array of trailers later)
  trailer_make text,
  trailer_model text,
  trailer_year integer,
  trailer_length_ft numeric(5,2),

  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE equipment_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own equipment profiles" ON equipment_profiles;
CREATE POLICY "Users can manage their own equipment profiles"
ON equipment_profiles
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_equipment_profiles_user_id ON equipment_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_profiles_created_at ON equipment_profiles(created_at DESC);

-- updated_at trigger (reuses the plpgsql function created in prior migrations)
DROP TRIGGER IF EXISTS update_equipment_profiles_updated_at ON equipment_profiles;
CREATE TRIGGER update_equipment_profiles_updated_at
  BEFORE UPDATE ON equipment_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE equipment_profiles IS 'Saved equipment (tractor + trailer) profiles owned by carriers. Selectable in the intake form to pre-fill rig configuration.';
COMMENT ON COLUMN equipment_profiles.axle_spacing IS 'Human-readable axle spacing string for the rig (used for bridge/axle weight calcs in future).';

-- Extend permit_requests so saved analyses remember the exact equipment + cargo the carrier entered.
-- Using JSONB keeps the table flexible and avoids dozens of nullable columns.
ALTER TABLE IF EXISTS permit_requests
  ADD COLUMN IF NOT EXISTS equipment JSONB,
  ADD COLUMN IF NOT EXISTS cargo JSONB;

COMMENT ON COLUMN permit_requests.equipment IS 'Snapshot of the equipment profile / rig configuration used for this permit request (unit #, VIN, axles, GVW, spacing, etc.).';
COMMENT ON COLUMN permit_requests.cargo IS 'Load/cargo details captured in the enhanced intake form (description, manufacturer, axle weight distribution, etc.).';
