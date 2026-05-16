-- supabase/migrations/002_add_cost_and_route_to_permit_requests.sql
--
-- Adds support for richer Phase I data from the Permit Agent

ALTER TABLE IF EXISTS permit_requests
  ADD COLUMN IF NOT EXISTS cost_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS distance_miles NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS duration_hours NUMERIC(6,2);

COMMENT ON COLUMN permit_requests.cost_breakdown IS 
  'Full cost breakdown object from the cost engine (base fee, surcharges per dimension, etc.)';

COMMENT ON COLUMN permit_requests.distance_miles IS 
  'Total route distance in miles from intelligent corridor routing';

COMMENT ON COLUMN permit_requests.duration_hours IS 
  'Estimated driving duration in hours from OSRM routing';
