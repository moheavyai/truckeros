-- supabase/migrations/022_profile_change_requests.sql
--
-- Pending profile field changes submitted by drivers for admin review.

CREATE TABLE IF NOT EXISTS profile_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requester_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_key text NOT NULL
    CHECK (field_key IN ('driver_full_name', 'cdl_number', 'cdl_state', 'date_of_birth')),
  current_value text,
  requested_value text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_change_requests_org_status
  ON profile_change_requests(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_profile_change_requests_target
  ON profile_change_requests(target_user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_change_requests_pending_dedupe
  ON profile_change_requests(organization_id, target_user_id, field_key)
  WHERE status = 'pending';

ALTER TABLE profile_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile change requests" ON profile_change_requests;
DROP POLICY IF EXISTS "Users can insert own profile change requests" ON profile_change_requests;
DROP POLICY IF EXISTS "Primary owners can view org profile change requests" ON profile_change_requests;
DROP POLICY IF EXISTS "Primary owners can update org profile change requests" ON profile_change_requests;

CREATE POLICY "Users can view own profile change requests"
ON profile_change_requests
FOR SELECT
USING (auth.uid() = requester_user_id OR auth.uid() = target_user_id);

CREATE POLICY "Users can insert own profile change requests"
ON profile_change_requests
FOR INSERT
WITH CHECK (auth.uid() = requester_user_id AND auth.uid() = target_user_id);

CREATE POLICY "Primary owners can view org profile change requests"
ON profile_change_requests
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM member_profiles mp
    WHERE mp.user_id = auth.uid()
      AND mp.organization_id = profile_change_requests.organization_id
      AND mp.is_primary_owner = true
  )
);

CREATE POLICY "Primary owners can update org profile change requests"
ON profile_change_requests
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM member_profiles mp
    WHERE mp.user_id = auth.uid()
      AND mp.organization_id = profile_change_requests.organization_id
      AND mp.is_primary_owner = true
  )
);

DROP TRIGGER IF EXISTS update_profile_change_requests_updated_at ON profile_change_requests;
CREATE TRIGGER update_profile_change_requests_updated_at
  BEFORE UPDATE ON profile_change_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE profile_change_requests IS
'Driver-submitted profile field changes awaiting primary owner / admin approval.';

NOTIFY pgrst, 'reload schema';