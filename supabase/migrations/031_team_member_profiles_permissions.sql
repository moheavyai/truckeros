-- Repair migration: ensure team_member_profiles.permissions exists (idempotent).
-- Primary definition lives in 027_team_invites_and_deletion_requests.sql; use this
-- when 027 was not applied or full consolidated migration cannot run (e.g. 030 failure).

ALTER TABLE team_member_profiles
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{"mode":"global"}'::jsonb;

COMMENT ON COLUMN team_member_profiles.permissions IS
'Per-member permission overrides: { mode: global|custom, custom: { equipment, profiles, account_settings } }.';

NOTIFY pgrst, 'reload schema';