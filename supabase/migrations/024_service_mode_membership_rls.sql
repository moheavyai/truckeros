-- Service mode: permit clerks with organization_memberships can read carrier org data.

-- member_profiles: membership-based org read
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
    AND organization_id IN (SELECT auth_user_membership_org_ids())
  )
);

-- team_member_profiles: membership-based org read
DROP POLICY IF EXISTS "Org members can view team roster in their organization" ON team_member_profiles;

CREATE POLICY "Org members can view team roster in their organization"
ON team_member_profiles
FOR SELECT
USING (
  organization_id IS NOT NULL
  AND (
    organization_id = auth_user_organization_id()
    OR organization_id IN (SELECT auth_user_membership_org_ids())
  )
);

-- equipment_profiles: read carrier equipment via membership (writes remain user-owned)
DROP POLICY IF EXISTS "Members can view org equipment profiles" ON equipment_profiles;

CREATE POLICY "Members can view org equipment profiles"
ON equipment_profiles
FOR SELECT
USING (
  organization_id IS NOT NULL
  AND organization_id IN (SELECT auth_user_membership_org_ids())
);

-- rig_configurations: read primary owner rigs when clerk has membership on owner's org
DROP POLICY IF EXISTS "Members can view carrier primary owner rig configs" ON rig_configurations;

CREATE POLICY "Members can view carrier primary owner rig configs"
ON rig_configurations
FOR SELECT
USING (
  user_id IN (
    SELECT mp.user_id
    FROM member_profiles mp
    WHERE mp.is_primary_owner = true
      AND mp.organization_id IN (SELECT auth_user_membership_org_ids())
  )
);

NOTIFY pgrst, 'reload schema';