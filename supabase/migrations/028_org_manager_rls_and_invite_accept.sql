-- Owner + Admin org managers: write access for team roster, memberships, and invite accept.

-- ---------------------------------------------------------------------------
-- auth_user_is_org_manager(org_id)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth_user_is_org_manager(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_memberships om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = org_id
      AND om.role IN ('Owner', 'Admin')
  )
  OR auth_user_is_primary_owner_of_org(org_id);
$$;

COMMENT ON FUNCTION auth_user_is_org_manager(uuid) IS
'True when the current user is an Owner or Admin (or primary owner) of the organization.';

-- ---------------------------------------------------------------------------
-- organization_memberships: Owner + Admin writes
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Primary owner can insert memberships" ON organization_memberships;
DROP POLICY IF EXISTS "Primary owner can update memberships" ON organization_memberships;
DROP POLICY IF EXISTS "Primary owner can delete non-owner memberships" ON organization_memberships;
DROP POLICY IF EXISTS "Org managers can insert memberships" ON organization_memberships;
DROP POLICY IF EXISTS "Org managers can update memberships" ON organization_memberships;
DROP POLICY IF EXISTS "Org managers can delete non-owner memberships" ON organization_memberships;
DROP POLICY IF EXISTS "Users can insert own membership on invite accept" ON organization_memberships;

CREATE POLICY "Org managers can insert memberships"
ON organization_memberships
FOR INSERT
WITH CHECK (auth_user_is_org_manager(organization_id));

CREATE POLICY "Users can insert own membership on invite accept"
ON organization_memberships
FOR INSERT
WITH CHECK (user_id = auth.uid() AND is_primary_owner = false);

CREATE POLICY "Org managers can update memberships"
ON organization_memberships
FOR UPDATE
USING (auth_user_is_org_manager(organization_id))
WITH CHECK (auth_user_is_org_manager(organization_id));

CREATE POLICY "Org managers can delete non-owner memberships"
ON organization_memberships
FOR DELETE
USING (
  auth_user_is_org_manager(organization_id)
  AND is_primary_owner = false
);

-- ---------------------------------------------------------------------------
-- team_member_profiles: Owner + Admin writes
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Primary owner can insert team roster entries" ON team_member_profiles;
DROP POLICY IF EXISTS "Primary owner can update team roster entries" ON team_member_profiles;
DROP POLICY IF EXISTS "Primary owner can delete team roster entries" ON team_member_profiles;
DROP POLICY IF EXISTS "Org managers can insert team roster entries" ON team_member_profiles;
DROP POLICY IF EXISTS "Org managers can update team roster entries" ON team_member_profiles;
DROP POLICY IF EXISTS "Org managers can delete team roster entries" ON team_member_profiles;

CREATE POLICY "Org managers can insert team roster entries"
ON team_member_profiles
FOR INSERT
WITH CHECK (
  auth_user_is_org_manager(organization_id)
  AND created_by_user_id = auth.uid()
);

CREATE POLICY "Org managers can update team roster entries"
ON team_member_profiles
FOR UPDATE
USING (auth_user_is_org_manager(organization_id))
WITH CHECK (auth_user_is_org_manager(organization_id));

CREATE POLICY "Org managers can delete team roster entries"
ON team_member_profiles
FOR DELETE
USING (auth_user_is_org_manager(organization_id));

-- ---------------------------------------------------------------------------
-- member_profiles: org managers may update/delete other members in org
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can update own profile or primary owner updates org" ON member_profiles;
DROP POLICY IF EXISTS "Primary owner can delete other org member profiles" ON member_profiles;
DROP POLICY IF EXISTS "Users can update own profile or org manager updates org" ON member_profiles;
DROP POLICY IF EXISTS "Org managers can delete other org member profiles" ON member_profiles;

CREATE POLICY "Users can update own profile or org manager updates org"
ON member_profiles
FOR UPDATE
USING (
  auth.uid() = user_id
  OR (
    organization_id IS NOT NULL
    AND auth_user_is_org_manager(organization_id)
    AND organization_id = auth_user_organization_id()
  )
)
WITH CHECK (
  auth.uid() = user_id
  OR (
    organization_id IS NOT NULL
    AND auth_user_is_org_manager(organization_id)
    AND organization_id = auth_user_organization_id()
  )
);

CREATE POLICY "Org managers can delete other org member profiles"
ON member_profiles
FOR DELETE
USING (
  auth_user_is_org_manager(organization_id)
  AND organization_id IS NOT NULL
  AND organization_id = auth_user_organization_id()
  AND user_id <> auth.uid()
  AND is_primary_owner = false
);

-- ---------------------------------------------------------------------------
-- team_invites: invitee read + accept
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Invitees can view matching pending invites" ON team_invites;
DROP POLICY IF EXISTS "Invitees can accept matching pending invites" ON team_invites;

CREATE POLICY "Invitees can view matching pending invites"
ON team_invites
FOR SELECT
USING (
  status = 'pending'
  AND expires_at > now()
  AND (
    NULLIF(trim(invite_email), '') IS NULL
    OR lower(trim(invite_email)) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

CREATE POLICY "Invitees can accept matching pending invites"
ON team_invites
FOR UPDATE
USING (
  status = 'pending'
  AND expires_at > now()
  AND (
    NULLIF(trim(invite_email), '') IS NULL
    OR lower(trim(invite_email)) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
)
WITH CHECK (
  status = 'accepted'
  AND accepted_by_user_id = auth.uid()
);

NOTIFY pgrst, 'reload schema';