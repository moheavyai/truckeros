-- supabase/migrations/042_axle_configs.sql
--
-- Spacing-based axle group optimizer configs (federal/state legal groups).
-- Distinct from equipment role groups (steer/drives/jeep/trailer in lib/axle-groups.ts).
-- Owner-operators save axle position + load layouts and state rule overrides.

CREATE TABLE IF NOT EXISTS axle_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,

  name text NOT NULL DEFAULT 'Untitled axle config',

  -- Array of { id, position_inches, type: steer|drive|trailer|lift, tire_count, current_load_lbs }
  axles jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Per-state rule bag (tandem caps, tridem/quad max span, single caps, notes).
  -- Pre-populated defaults for MO/KS/IL/TN/TX/FL/OK/AL/MS when client saves empty.
  state_rules jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: users only CRUD their own rows (match 005 / 010 style)
ALTER TABLE axle_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own axle configs" ON axle_configs;
DROP POLICY IF EXISTS "Users can insert their own axle configs" ON axle_configs;
DROP POLICY IF EXISTS "Users can update their own axle configs" ON axle_configs;
DROP POLICY IF EXISTS "Users can delete their own axle configs" ON axle_configs;
DROP POLICY IF EXISTS "Users manage own axle configs" ON axle_configs;

CREATE POLICY "Users can view their own axle configs"
ON axle_configs
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own axle configs"
ON axle_configs
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own axle configs"
ON axle_configs
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own axle configs"
ON axle_configs
FOR DELETE
USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_axle_configs_user_id ON axle_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_axle_configs_organization_id ON axle_configs(organization_id);
CREATE INDEX IF NOT EXISTS idx_axle_configs_created_at ON axle_configs(created_at DESC);

DROP TRIGGER IF EXISTS update_axle_configs_updated_at ON axle_configs;
CREATE TRIGGER update_axle_configs_updated_at
  BEFORE UPDATE ON axle_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE axle_configs IS
'Saved spacing-based axle layouts for the federal/state axle group optimizer. RLS: owner-only CRUD.';

COMMENT ON COLUMN axle_configs.axles IS
'JSONB array of axles: { id, position_inches, type, tire_count, current_load_lbs }.';

COMMENT ON COLUMN axle_configs.state_rules IS
'JSONB map of state code → { single_cap_lbs, tandem_cap_lbs, tridem_cap_lbs, quad_cap_lbs, tridem_max_span_in, quad_max_span_in, notes }.';
