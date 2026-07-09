-- Team invites (email/SMS) and deletion approval requests for Permit Clerks.

-- ---------------------------------------------------------------------------
-- team_member_profiles.permissions (granular overrides)
-- ---------------------------------------------------------------------------

ALTER TABLE team_member_profiles
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{"mode":"global"}'::jsonb;

COMMENT ON COLUMN team_member_profiles.permissions IS
'Per-member permission overrides: { mode: global|custom, custom: { equipment, profiles, account_settings } }.';

-- Normalize organization_memberships.permissions default to object shape
ALTER TABLE organization_memberships
  ALTER COLUMN permissions SET DEFAULT '{"mode":"global"}'::jsonb;

UPDATE organization_memberships
SET permissions = '{"mode":"global"}'::jsonb
WHERE permissions = '[]'::jsonb OR permissions IS NULL;

-- ---------------------------------------------------------------------------
-- team_invites
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL
    CHECK (
      role = ANY(ARRAY[
        'Owner',
        'Admin',
        'Driver',
        'Permit Clerk',
        'Viewer'
      ]::text[])
    ),
  invite_email text,
  invite_phone text,
  invite_token text NOT NULL UNIQUE,
  invite_link text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  accepted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz DEFAULT now(),
  CHECK (
    NULLIF(trim(invite_email), '') IS NOT NULL
    OR NULLIF(trim(invite_phone), '') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_team_invites_organization_id
  ON team_invites(organization_id);

CREATE INDEX IF NOT EXISTS idx_team_invites_token
  ON team_invites(invite_token);

CREATE INDEX IF NOT EXISTS idx_team_invites_status
  ON team_invites(status);

ALTER TABLE team_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org managers can view team invites" ON team_invites;
DROP POLICY IF EXISTS "Org managers can create team invites" ON team_invites;
DROP POLICY IF EXISTS "Org managers can update team invites" ON team_invites;

CREATE POLICY "Org managers can view team invites"
ON team_invites
FOR SELECT
USING (
  organization_id IN (SELECT auth_user_membership_org_ids())
  AND EXISTS (
    SELECT 1
    FROM organization_memberships om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = team_invites.organization_id
      AND om.role IN ('Owner', 'Admin')
  )
);

CREATE POLICY "Org managers can create team invites"
ON team_invites
FOR INSERT
WITH CHECK (
  invited_by_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM organization_memberships om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = team_invites.organization_id
      AND om.role IN ('Owner', 'Admin')
  )
);

CREATE POLICY "Org managers can update team invites"
ON team_invites
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM organization_memberships om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = team_invites.organization_id
      AND om.role IN ('Owner', 'Admin')
  )
);

-- ---------------------------------------------------------------------------
-- deletion_requests (Permit Clerk initiated deletes pending Owner/Admin approval)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requester_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_type text NOT NULL
    CHECK (resource_type IN ('carrier', 'equipment', 'driver', 'team_member', 'roster_member')),
  resource_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_org_status
  ON deletion_requests(organization_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deletion_requests_pending_dedupe
  ON deletion_requests(organization_id, resource_type, resource_id)
  WHERE status = 'pending';

ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Requesters can view own deletion requests" ON deletion_requests;
DROP POLICY IF EXISTS "Permit clerks can insert deletion requests" ON deletion_requests;
DROP POLICY IF EXISTS "Owners and admins can view org deletion requests" ON deletion_requests;
DROP POLICY IF EXISTS "Owners and admins can update org deletion requests" ON deletion_requests;

CREATE POLICY "Requesters can view own deletion requests"
ON deletion_requests
FOR SELECT
USING (auth.uid() = requester_user_id);

CREATE POLICY "Permit clerks can insert deletion requests"
ON deletion_requests
FOR INSERT
WITH CHECK (
  auth.uid() = requester_user_id
  AND EXISTS (
    SELECT 1
    FROM organization_memberships om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = deletion_requests.organization_id
      AND om.role = 'Permit Clerk'
  )
);

CREATE POLICY "Owners and admins can view org deletion requests"
ON deletion_requests
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM organization_memberships om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = deletion_requests.organization_id
      AND om.role IN ('Owner', 'Admin')
  )
);

CREATE POLICY "Owners and admins can update org deletion requests"
ON deletion_requests
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM organization_memberships om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = deletion_requests.organization_id
      AND om.role IN ('Owner', 'Admin')
  )
);

DROP TRIGGER IF EXISTS update_deletion_requests_updated_at ON deletion_requests;
CREATE TRIGGER update_deletion_requests_updated_at
  BEFORE UPDATE ON deletion_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE team_invites IS
'Organization invites via email or SMS. Bi-directional carrier/permit-clerk linking extends this model.';

COMMENT ON TABLE deletion_requests IS
'Pending deletion approvals when Permit Clerks initiate destructive actions.';

NOTIFY pgrst, 'reload schema';