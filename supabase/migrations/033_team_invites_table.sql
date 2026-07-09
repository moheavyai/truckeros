-- Repair migration: ensure team_invites table exists (idempotent).
-- Primary definition lives in 027_team_invites_and_deletion_requests.sql; use this
-- when 027 was not applied or full consolidated migration cannot run.
--
-- NOTE: This repair migration creates the team_invites table and base RLS only.
-- Invite accept/preview RPCs and tightened policies live in
-- 028_org_manager_rls_and_invite_accept.sql and 029_tighten_invite_accept_rls.sql.
-- Apply the full migration manifest (or at least 027–029) via POST /api/admin/migrate
-- or scripts/apply-migrations.mjs for complete invite functionality.

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

COMMENT ON TABLE team_invites IS
'Organization invites via email or SMS. Bi-directional carrier/permit-clerk linking extends this model.';

NOTIFY pgrst, 'reload schema';