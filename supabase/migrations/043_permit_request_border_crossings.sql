-- supabase/migrations/043_permit_request_border_crossings.sql
--
-- Persist geometry-aligned corridor border crossings + major highways on permit_requests
-- so History → Portal Assist can load real entry/exit coords for non-demo requests.
-- Additive only (IF NOT EXISTS); does not rewrite history.
--
-- After applying: PostgREST schema cache reloads automatically via NOTIFY below.
-- If save still fails with "schema cache" errors, run in SQL Editor:
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE IF EXISTS permit_requests
  ADD COLUMN IF NOT EXISTS border_crossings jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS highways jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN permit_requests.border_crossings IS
  'Geometry-aligned state border entry/exit points from corridor builder (array of BorderCrossing).';

COMMENT ON COLUMN permit_requests.highways IS
  'Major highways from corridor builder for portal/history display.';

-- Reload PostgREST schema cache so Supabase API sees new columns immediately.
NOTIFY pgrst, 'reload schema';
