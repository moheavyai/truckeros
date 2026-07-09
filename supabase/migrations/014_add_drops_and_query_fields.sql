-- supabase/migrations/014_add_drops_and_query_fields.sql
--
-- Persist multi-stop load data and natural-language query text on permit_requests.
-- Matches SavePermitRequestInput fields sent from permit-test save flow.
--
-- After applying: PostgREST schema cache reloads automatically via NOTIFY below.
-- If save still fails with "schema cache" errors, run in SQL Editor:
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE IF EXISTS permit_requests
  ADD COLUMN IF NOT EXISTS origin_query text,
  ADD COLUMN IF NOT EXISTS destination_query text,
  ADD COLUMN IF NOT EXISTS drops jsonb;

COMMENT ON COLUMN permit_requests.origin_query IS 'Natural-language pickup query captured at save time (address, business name, or zip).';
COMMENT ON COLUMN permit_requests.destination_query IS 'Natural-language destination query captured at save time.';
COMMENT ON COLUMN permit_requests.drops IS 'Ordered delivery stops (JSON array) with query, structured address fields, and lat/lon.';

-- Reload PostgREST schema cache so Supabase API sees new columns immediately.
NOTIFY pgrst, 'reload schema';