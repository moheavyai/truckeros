-- supabase/migrations/021_multi_carrier_foundation.sql
--
-- Multi-carrier foundation: organizations, memberships, carrier link requests.
-- Aligns member_profiles.organization_id with organizations rows (same UUID).
-- Removes Dispatcher role; maps existing Dispatcher assignments to Driver.

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY,
  name text,
  usdot_number text,
  mc_number text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_created_by_user_id
  ON organizations(created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_organizations_usdot_number
  ON organizations(usdot_number);

-- Backfill from primary owners first, then any member with an organization_id
INSERT INTO organizations (id, name, usdot_number, mc_number, created_by_user_id, created_at)
SELECT
  mp.organization_id,
  mp.company_name,
  mp.usdot_number,
  mp.mc_number,
  mp.user_id,
  COALESCE(mp.created_at, now())
FROM member_profiles mp
WHERE mp.organization_id IS NOT NULL
  AND mp.is_primary_owner = true
ON CONFLICT (id) DO NOTHING;

INSERT INTO organizations (id, name, usdot_number, mc_number, created_by_user_id, created_at)
SELECT DISTINCT ON (mp.organization_id)
  mp.organization_id,
  mp.company_name,
  mp.usdot_number,
  mp.mc_number,
  mp.user_id,
  COALESCE(mp.created_at, now())
FROM member_profiles mp
WHERE mp.organization_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = mp.organization_id)
ORDER BY mp.organization_id, mp.is_primary_owner DESC NULLS LAST, mp.created_at ASC
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- organization_memberships
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'Viewer'
    CHECK (
      role = ANY(ARRAY[
        'Owner / Admin',
        'Driver',
        'Permit Clerk',
        'Viewer'
      ]::text[])
    ),
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_primary_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_memberships_user_id
  ON organization_memberships(user_id);

CREATE INDEX IF NOT EXISTS idx_organization_memberships_organization_id
  ON organization_memberships(organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_memberships_one_primary_owner_per_org
  ON organization_memberships(organization_id)
  WHERE is_primary_owner = true;

-- Backfill memberships from member_profiles
INSERT INTO organization_memberships (organization_id, user_id, role, is_primary_owner, created_at)
SELECT
  mp.organization_id,
  mp.user_id,
  CASE
    WHEN 'Owner / Admin' = ANY(mp.user_roles) THEN 'Owner / Admin'
    WHEN 'Permit Clerk' = ANY(mp.user_roles) THEN 'Permit Clerk'
    WHEN 'Driver' = ANY(mp.user_roles) THEN 'Driver'
    WHEN 'Viewer' = ANY(mp.user_roles) THEN 'Viewer'
    WHEN mp.is_primary_owner THEN 'Owner / Admin'
    ELSE 'Viewer'
  END,
  mp.is_primary_owner,
  COALESCE(mp.created_at, now())
FROM member_profiles mp
WHERE mp.organization_id IS NOT NULL
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- carrier_link_requests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS carrier_link_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  target_usdot text,
  target_email text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  message text,
  created_at timestamptz DEFAULT now(),
  responded_at timestamptz,
  responded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (
    to_organization_id IS NOT NULL
    OR NULLIF(trim(target_usdot), '') IS NOT NULL
    OR NULLIF(trim(target_email), '') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_carrier_link_requests_from_user_id
  ON carrier_link_requests(from_user_id);

CREATE INDEX IF NOT EXISTS idx_carrier_link_requests_to_organization_id
  ON carrier_link_requests(to_organization_id);

CREATE INDEX IF NOT EXISTS idx_carrier_link_requests_status
  ON carrier_link_requests(status);

-- ---------------------------------------------------------------------------
-- Optional FK from member_profiles.organization_id -> organizations
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'member_profiles_organization_id_fkey'
  ) THEN
    ALTER TABLE member_profiles
      ADD CONSTRAINT member_profiles_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- equipment_profiles: organization scoping (nullable; backfill from member profile)
-- ---------------------------------------------------------------------------

ALTER TABLE equipment_profiles
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_equipment_profiles_organization_id
  ON equipment_profiles(organization_id);

UPDATE equipment_profiles ep
SET organization_id = mp.organization_id
FROM member_profiles mp
WHERE ep.user_id = mp.user_id
  AND mp.organization_id IS NOT NULL
  AND ep.organization_id IS NULL;

-- ---------------------------------------------------------------------------
-- Remove Dispatcher role from existing data
-- ---------------------------------------------------------------------------

UPDATE member_profiles
SET user_roles = array_replace(user_roles, 'Dispatcher', 'Driver')
WHERE 'Dispatcher' = ANY(user_roles);

UPDATE team_member_profiles
SET user_roles = array_replace(user_roles, 'Dispatcher', 'Driver')
WHERE 'Dispatcher' = ANY(user_roles);

-- Drop and recreate user_roles CHECK constraints without Dispatcher
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass::text AS tbl
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN ('member_profiles'::regclass, 'team_member_profiles'::regclass)
      AND pg_get_constraintdef(oid) LIKE '%user_roles%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

ALTER TABLE member_profiles
  ADD CONSTRAINT member_profiles_user_roles_check
  CHECK (
    user_roles <@ ARRAY[
      'Owner / Admin',
      'Driver',
      'Permit Clerk',
      'Viewer'
    ]::text[]
  );

ALTER TABLE team_member_profiles
  ADD CONSTRAINT team_member_profiles_user_roles_check
  CHECK (
    user_roles <@ ARRAY[
      'Owner / Admin',
      'Driver',
      'Permit Clerk',
      'Viewer'
    ]::text[]
  );

-- ---------------------------------------------------------------------------
-- Auth helper functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth_user_membership_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM organization_memberships
  WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION auth_user_is_primary_owner_of_org(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_memberships
    WHERE user_id = auth.uid()
      AND organization_id = org_id
      AND is_primary_owner = true
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS: organizations
-- ---------------------------------------------------------------------------

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view accessible organizations" ON organizations;
DROP POLICY IF EXISTS "Users can create organizations they own" ON organizations;
DROP POLICY IF EXISTS "Primary owner can update their organization" ON organizations;

CREATE POLICY "Members can view accessible organizations"
ON organizations
FOR SELECT
USING (
  id IN (SELECT auth_user_membership_org_ids())
  OR created_by_user_id = auth.uid()
  OR id = auth_user_organization_id()
);

CREATE POLICY "Users can create organizations they own"
ON organizations
FOR INSERT
WITH CHECK (created_by_user_id = auth.uid());

CREATE POLICY "Primary owner can update their organization"
ON organizations
FOR UPDATE
USING (auth_user_is_primary_owner_of_org(id))
WITH CHECK (auth_user_is_primary_owner_of_org(id));

-- ---------------------------------------------------------------------------
-- RLS: organization_memberships
-- ---------------------------------------------------------------------------

ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view memberships in accessible organizations" ON organization_memberships;
DROP POLICY IF EXISTS "Primary owner can insert memberships" ON organization_memberships;
DROP POLICY IF EXISTS "Primary owner can update memberships" ON organization_memberships;
DROP POLICY IF EXISTS "Primary owner can delete non-owner memberships" ON organization_memberships;

CREATE POLICY "Users can view memberships in accessible organizations"
ON organization_memberships
FOR SELECT
USING (
  user_id = auth.uid()
  OR organization_id IN (SELECT auth_user_membership_org_ids())
  OR organization_id = auth_user_organization_id()
);

CREATE POLICY "Primary owner can insert memberships"
ON organization_memberships
FOR INSERT
WITH CHECK (auth_user_is_primary_owner_of_org(organization_id));

CREATE POLICY "Primary owner can update memberships"
ON organization_memberships
FOR UPDATE
USING (auth_user_is_primary_owner_of_org(organization_id))
WITH CHECK (auth_user_is_primary_owner_of_org(organization_id));

CREATE POLICY "Primary owner can delete non-owner memberships"
ON organization_memberships
FOR DELETE
USING (
  auth_user_is_primary_owner_of_org(organization_id)
  AND is_primary_owner = false
);

-- ---------------------------------------------------------------------------
-- RLS: carrier_link_requests
-- ---------------------------------------------------------------------------

ALTER TABLE carrier_link_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their outgoing link requests" ON carrier_link_requests;
DROP POLICY IF EXISTS "Primary owners can view incoming link requests" ON carrier_link_requests;
DROP POLICY IF EXISTS "Users can create link requests" ON carrier_link_requests;
DROP POLICY IF EXISTS "Primary owners can respond to link requests" ON carrier_link_requests;

CREATE POLICY "Users can view their outgoing link requests"
ON carrier_link_requests
FOR SELECT
USING (from_user_id = auth.uid());

CREATE POLICY "Primary owners can view incoming link requests"
ON carrier_link_requests
FOR SELECT
USING (
  to_organization_id IS NOT NULL
  AND auth_user_is_primary_owner_of_org(to_organization_id)
);

CREATE POLICY "Users can create link requests"
ON carrier_link_requests
FOR INSERT
WITH CHECK (from_user_id = auth.uid());

CREATE POLICY "Primary owners can respond to link requests"
ON carrier_link_requests
FOR UPDATE
USING (
  to_organization_id IS NOT NULL
  AND auth_user_is_primary_owner_of_org(to_organization_id)
  AND status = 'pending'
)
WITH CHECK (
  to_organization_id IS NOT NULL
  AND auth_user_is_primary_owner_of_org(to_organization_id)
);

COMMENT ON TABLE organizations IS
'Carrier companies. id aligns with member_profiles.organization_id for existing orgs.';

COMMENT ON TABLE organization_memberships IS
'Links users to carrier organizations with role and permissions.';

COMMENT ON TABLE carrier_link_requests IS
'Permit clerks / service users request access to a carrier organization.';

COMMENT ON COLUMN equipment_profiles.organization_id IS
'Optional org scope for equipment; backfilled from member profile. Full query scoping is phase 2.';

NOTIFY pgrst, 'reload schema';