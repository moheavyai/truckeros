-- Add is_default flag to rig_configurations (one default rig per user for Permit Agent auto-select)
ALTER TABLE rig_configurations
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN rig_configurations.is_default IS
  'When true, this rig is auto-selected in Permit Agent on load. At most one per user.';

-- Enforce at most one default rig per user (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_rig_configurations_one_default_per_user
  ON rig_configurations (user_id)
  WHERE is_default = true;

NOTIFY pgrst, 'reload schema';