-- supabase/migrations/010_tractors_trailers_rig_configurations.sql
--
-- Smart Rig Builder: separate Tractor and Trailer profiles + saved Rig combinations.
-- Supports real-world carrier workflows: 5th wheel/kingpin alignment, multi-trailer (doubles/triples),
-- lift/ extendable trailers, auto-calc of overall dimensions.
--
-- Backward compatible: old equipment_profiles table remains untouched (used by prior intake).
-- New tables power the dedicated /equipment management area and Rig Selector in /permit-test.

-- ===================== TRACTORS (Power Units) =====================
CREATE TABLE IF NOT EXISTS tractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  profile_name text NOT NULL,                 -- e.g. "Kenworth T680 #4821"

  -- Core measurement fields (per requirements)
  overall_length_ft numeric(6,2),             -- bumper to end of frame / 5th wheel area
  num_axles integer DEFAULT 3 CHECK (num_axles BETWEEN 2 AND 6),
  steer_axle_setback_in numeric(6,2),         -- distance from front of tractor to steer axle center
  wheelbase_in numeric(7,2),                  -- steer axle to drive axle (or rear drive group start)
  axle_spacings jsonb,                        -- array of center-to-center inches e.g. [40, 48, 48] for 4-axle
  fifth_wheel_from_rear_in numeric(6,2),      -- 5th wheel position measured from rear of tractor frame

  -- Descriptive / future VIN decoder etc.
  unit_number text,
  vin text,
  year integer,
  make text,
  model text,
  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE tractors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own tractors" ON tractors;
CREATE POLICY "Users manage own tractors"
ON tractors FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Indexes + trigger
CREATE INDEX IF NOT EXISTS idx_tractors_user_id ON tractors(user_id);
CREATE INDEX IF NOT EXISTS idx_tractors_created_at ON tractors(created_at DESC);

DROP TRIGGER IF EXISTS update_tractors_updated_at ON tractors;
CREATE TRIGGER update_tractors_updated_at
  BEFORE UPDATE ON tractors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE tractors IS 'Saved tractor / power unit profiles with precise 5th wheel and axle geometry for OSOW calculations.';

-- ===================== TRAILERS =====================
CREATE TABLE IF NOT EXISTS trailers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  profile_name text NOT NULL,                 -- e.g. "53 ft Flatbed #T-92"

  -- Core measurement fields (per requirements)
  overall_length_ft numeric(6,2),
  kingpin_distance_from_front_in numeric(6,2),-- kingpin setback from nose of trailer
  num_axles integer DEFAULT 2 CHECK (num_axles BETWEEN 1 AND 8),
  axle_spacings jsonb,                        -- inches between axle centers, e.g. [49, 49] for tandem
  kingpin_to_first_axle_in numeric(7,2),

  has_lift_axle boolean DEFAULT false,
  is_extendable boolean DEFAULT false,
  extendable_extra_ft numeric(5,2),           -- additional length when extended (user enters custom)

  -- Descriptive
  trailer_type text,                          -- flatbed, lowboy, reefer, stepdeck, etc. (free text for MVP)
  make text,
  model text,
  year integer,
  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE trailers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own trailers" ON trailers;
CREATE POLICY "Users manage own trailers"
ON trailers FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_trailers_user_id ON trailers(user_id);
CREATE INDEX IF NOT EXISTS idx_trailers_created_at ON trailers(created_at DESC);

DROP TRIGGER IF EXISTS update_trailers_updated_at ON trailers;
CREATE TRIGGER update_trailers_updated_at
  BEFORE UPDATE ON trailers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE trailers IS 'Saved trailer profiles with kingpin geometry, lift/ extendable flags for accurate overall length + axle group calcs.';

-- ===================== RIG CONFIGURATIONS (saved combinations) =====================
CREATE TABLE IF NOT EXISTS rig_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  rig_name text NOT NULL,                     -- e.g. "T680 + 53 flat + 28 pup"

  tractor_id uuid NOT NULL REFERENCES tractors(id) ON DELETE CASCADE,
  trailer_ids jsonb NOT NULL,                 -- ordered array: ["uuid-trailer1", "uuid-trailer2"] (supports 1+)

  -- Auto-computed / cached for quick display in selectors & diagrams (updated on save)
  computed_total_length_ft numeric(7,2),
  computed_total_axles integer,
  computed_kingpin_to_last_axle_ft numeric(7,2), -- useful for bridge/axle weight later

  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE rig_configurations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own rig configs" ON rig_configurations;
CREATE POLICY "Users manage own rig configs"
ON rig_configurations FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_rig_configurations_user_id ON rig_configurations(user_id);
CREATE INDEX IF NOT EXISTS idx_rig_configurations_tractor ON rig_configurations(tractor_id);
CREATE INDEX IF NOT EXISTS idx_rig_configurations_created_at ON rig_configurations(created_at DESC);

DROP TRIGGER IF EXISTS update_rig_configurations_updated_at ON rig_configurations;
CREATE TRIGGER update_rig_configurations_updated_at
  BEFORE UPDATE ON rig_configurations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE rig_configurations IS 'Saved tractor + N-trailer combinations. trailer_ids preserves order. Computed dims enable fast Rig Selector + graphical preview without re-joining every time.';

-- Optional: extend permit_requests snapshots (already has equipment/cargo JSONB from 009)
-- We will store richer structure { rigId, tractor: {...}, trailers: [...] , overallLengthFt, ... } inside equipment JSONB.
-- No ALTER needed here — JSONB is flexible.

-- Helpful view (optional, for future analytics)
-- CREATE OR REPLACE VIEW v_user_rigs AS ... (omitted for MVP simplicity)
