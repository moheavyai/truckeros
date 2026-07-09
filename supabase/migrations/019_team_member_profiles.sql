-- supabase/migrations/019_team_member_profiles.sql
--
-- Team management: organization scoping on member_profiles and roster entries
-- in team_member_profiles. Primary owner can manage other profiles in the org.

-- ---------------------------------------------------------------------------
-- Extend member_profiles with organization + primary owner flag
-- ---------------------------------------------------------------------------

ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS organization_id uuid,
  ADD COLUMN IF NOT EXISTS is_primary_owner boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_member_profiles_organization_id
  ON member_profiles(organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_profiles_one_primary_owner_per_org
  ON member_profiles(organization_id)
  WHERE is_primary_owner = true AND organization_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Roster table for team members (with or without linked auth accounts)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_member_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  linked_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Carrier Information
  company_name text,
  usdot_number text,
  mc_number text,
  ein text,
  carrier_address text,
  carrier_phone text,
  carrier_email text,
  insurance_contact text,

  -- Driver / User Information
  driver_full_name text,
  cdl_number text,
  cdl_state text CHECK (cdl_state IS NULL OR cdl_state ~ '^[A-Z]{2}$'),
  date_of_birth date,
  driver_phone text,
  driver_email text,
  emergency_contact text,

  -- User Roles
  user_roles text[] NOT NULL DEFAULT '{}'
    CHECK (
      user_roles <@ ARRAY[
        'Owner / Admin',
        'Dispatcher',
        'Driver',
        'Permit Clerk',
        'Viewer'
      ]::text[]
    ),

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_member_profiles_organization_id
  ON team_member_profiles(organization_id);

CREATE INDEX IF NOT EXISTS idx_team_member_profiles_linked_user_id
  ON team_member_profiles(linked_user_id);

ALTER TABLE team_member_profiles ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Auth helper functions for RLS (SECURITY DEFINER reads caller's member row)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth_user_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM member_profiles
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_user_is_primary_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_primary_owner FROM member_profiles WHERE user_id = auth.uid() LIMIT 1),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- member_profiles RLS: org-wide read; primary owner can update/delete others
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view their own member profile" ON member_profiles;
DROP POLICY IF EXISTS "Users can insert their own member profile" ON member_profiles;
DROP POLICY IF EXISTS "Users can update their own member profile" ON member_profiles;
DROP POLICY IF EXISTS "Org members can view profiles in their organization" ON member_profiles;
DROP POLICY IF EXISTS "Users can insert their own member profile row" ON member_profiles;
DROP POLICY IF EXISTS "Users can update own profile or primary owner updates org" ON member_profiles;
DROP POLICY IF EXISTS "Primary owner can delete other org member profiles" ON member_profiles;

CREATE POLICY "Org members can view profiles in their organization"
ON member_profiles
FOR SELECT
USING (
  auth.uid() = user_id
  OR (
    organization_id IS NOT NULL
    AND organization_id = auth_user_organization_id()
  )
);

CREATE POLICY "Users can insert their own member profile row"
ON member_profiles
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile or primary owner updates org"
ON member_profiles
FOR UPDATE
USING (
  auth.uid() = user_id
  OR (
    auth_user_is_primary_owner()
    AND organization_id IS NOT NULL
    AND organization_id = auth_user_organization_id()
  )
)
WITH CHECK (
  auth.uid() = user_id
  OR (
    auth_user_is_primary_owner()
    AND organization_id IS NOT NULL
    AND organization_id = auth_user_organization_id()
  )
);

CREATE POLICY "Primary owner can delete other org member profiles"
ON member_profiles
FOR DELETE
USING (
  auth_user_is_primary_owner()
  AND organization_id IS NOT NULL
  AND organization_id = auth_user_organization_id()
  AND user_id <> auth.uid()
);

-- ---------------------------------------------------------------------------
-- team_member_profiles RLS: org read; primary owner write
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Org members can view team roster in their organization" ON team_member_profiles;
DROP POLICY IF EXISTS "Primary owner can insert team roster entries" ON team_member_profiles;
DROP POLICY IF EXISTS "Primary owner can update team roster entries" ON team_member_profiles;
DROP POLICY IF EXISTS "Primary owner can delete team roster entries" ON team_member_profiles;

CREATE POLICY "Org members can view team roster in their organization"
ON team_member_profiles
FOR SELECT
USING (
  organization_id IS NOT NULL
  AND organization_id = auth_user_organization_id()
);

CREATE POLICY "Primary owner can insert team roster entries"
ON team_member_profiles
FOR INSERT
WITH CHECK (
  auth_user_is_primary_owner()
  AND organization_id = auth_user_organization_id()
  AND created_by_user_id = auth.uid()
);

CREATE POLICY "Primary owner can update team roster entries"
ON team_member_profiles
FOR UPDATE
USING (
  auth_user_is_primary_owner()
  AND organization_id = auth_user_organization_id()
)
WITH CHECK (
  auth_user_is_primary_owner()
  AND organization_id = auth_user_organization_id()
);

CREATE POLICY "Primary owner can delete team roster entries"
ON team_member_profiles
FOR DELETE
USING (
  auth_user_is_primary_owner()
  AND organization_id = auth_user_organization_id()
);

DROP TRIGGER IF EXISTS update_team_member_profiles_updated_at ON team_member_profiles;
CREATE TRIGGER update_team_member_profiles_updated_at
  BEFORE UPDATE ON team_member_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE team_member_profiles IS
'Roster entries for team members within an organization. May link to an auth user via linked_user_id.';

COMMENT ON COLUMN member_profiles.organization_id IS
'Shared organization identifier for team member profiles.';

COMMENT ON COLUMN member_profiles.is_primary_owner IS
'True for the primary Admin/Owner who created the organization team.';

NOTIFY pgrst, 'reload schema';