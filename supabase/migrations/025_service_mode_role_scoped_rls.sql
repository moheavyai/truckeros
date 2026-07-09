-- Restrict cross-carrier service-mode reads to Permit Clerk and Owner / Admin roles.

CREATE OR REPLACE FUNCTION auth_user_service_mode_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM organization_memberships
  WHERE user_id = auth.uid()
    AND role IN ('Permit Clerk', 'Owner / Admin');
$$;

COMMENT ON FUNCTION auth_user_service_mode_org_ids() IS
'Organization ids the current user may scope in Service Mode (Permit Clerk or Owner / Admin memberships only).';

-- member_profiles: role-filtered cross-org read (own org + own row unchanged)
DROP POLICY IF EXISTS "Org members can view profiles in their organization" ON member_profiles;

CREATE POLICY "Org members can view profiles in their organization"
ON member_profiles
FOR SELECT
USING (
  auth.uid() = user_id
  OR (
    organization_id IS NOT NULL
    AND organization_id = auth_user_organization_id()
  )
  OR (
    organization_id IS NOT NULL
    AND organization_id IN (SELECT auth_user_service_mode_org_ids())
  )
);

-- team_member_profiles: role-filtered cross-org read
DROP POLICY IF EXISTS "Org members can view team roster in their organization" ON team_member_profiles;

CREATE POLICY "Org members can view team roster in their organization"
ON team_member_profiles
FOR SELECT
USING (
  organization_id IS NOT NULL
  AND (
    organization_id = auth_user_organization_id()
    OR organization_id IN (SELECT auth_user_service_mode_org_ids())
  )
);

-- equipment_profiles: role-filtered cross-org read
DROP POLICY IF EXISTS "Members can view org equipment profiles" ON equipment_profiles;

CREATE POLICY "Members can view org equipment profiles"
ON equipment_profiles
FOR SELECT
USING (
  organization_id IS NOT NULL
  AND organization_id IN (SELECT auth_user_service_mode_org_ids())
);

-- rig_configurations: role-filtered cross-org read of primary owner rigs
DROP POLICY IF EXISTS "Members can view carrier primary owner rig configs" ON rig_configurations;

CREATE POLICY "Members can view carrier primary owner rig configs"
ON rig_configurations
FOR SELECT
USING (
  user_id IN (
    SELECT mp.user_id
    FROM member_profiles mp
    WHERE mp.is_primary_owner = true
      AND mp.organization_id IN (SELECT auth_user_service_mode_org_ids())
  )
);

NOTIFY pgrst, 'reload schema';