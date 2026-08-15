-- 049_add_driver_id.sql
-- Carrier-facing Driver ID (unit/employee number) on member + roster profiles.

ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS driver_id text;

ALTER TABLE team_member_profiles
  ADD COLUMN IF NOT EXISTS driver_id text;

COMMENT ON COLUMN member_profiles.driver_id IS 'Carrier-assigned Driver ID / unit number for identification on permits and roster';
COMMENT ON COLUMN team_member_profiles.driver_id IS 'Carrier-assigned Driver ID / unit number for identification on permits and roster';
