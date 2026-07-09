-- Split combined Owner / Admin into separate Owner and Admin roles.
-- Primary owners become Owner; other former Owner / Admin memberships become Admin.
--
-- IMPORTANT: Drop legacy CHECKs before rewriting role values. The old allowlists
-- only include 'Owner / Admin'; writing 'Owner'/'Admin' while they are still
-- attached fails (e.g. organization_memberships_role_check).

-- ---------------------------------------------------------------------------
-- Drop role CHECKs first (safe even when tables/constraints are missing)
-- ---------------------------------------------------------------------------

ALTER TABLE organization_memberships
  DROP CONSTRAINT IF EXISTS organization_memberships_role_check;

ALTER TABLE member_profiles
  DROP CONSTRAINT IF EXISTS member_profiles_user_roles_check;

ALTER TABLE team_member_profiles
  DROP CONSTRAINT IF EXISTS team_member_profiles_user_roles_check;

-- Defensive: drop alternate names that still encode user_roles allowlists
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass::text AS tbl
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN ('member_profiles'::regclass, 'team_member_profiles'::regclass)
      AND conname NOT IN (
        'member_profiles_user_roles_check',
        'team_member_profiles_user_roles_check'
      )
      AND pg_get_constraintdef(oid) LIKE '%user_roles%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Data migration: convert legacy "Owner / Admin" (and spacing variants)
-- ---------------------------------------------------------------------------

UPDATE organization_memberships
SET role = btrim(role)
WHERE role IS NOT NULL
  AND role IS DISTINCT FROM btrim(role);

UPDATE organization_memberships
SET role = regexp_replace(btrim(role), '\s*/\s*', ' / ', 'g')
WHERE role IS NOT NULL
  AND role ~ '/';

UPDATE organization_memberships
SET role = 'Owner'
WHERE is_primary_owner = true
  AND role ~* '^Owner\s*/\s*Admin$';

UPDATE organization_memberships
SET role = 'Admin'
WHERE (is_primary_owner = false OR is_primary_owner IS NULL)
  AND role ~* '^Owner\s*/\s*Admin$';

UPDATE member_profiles
SET user_roles = (
  SELECT COALESCE(
    array_agg(
      CASE
        WHEN elem ~* '^Owner\s*/\s*Admin$' AND COALESCE(is_primary_owner, false) THEN 'Owner'
        WHEN elem ~* '^Owner\s*/\s*Admin$' THEN 'Admin'
        ELSE btrim(elem)
      END
      ORDER BY ord
    ),
    ARRAY[]::text[]
  )
  FROM unnest(user_roles) WITH ORDINALITY AS u(elem, ord)
)
WHERE user_roles IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(user_roles) AS e WHERE e ~* 'Owner\s*/\s*Admin'
  );

UPDATE team_member_profiles
SET user_roles = (
  SELECT COALESCE(
    array_agg(
      CASE
        WHEN elem ~* '^Owner\s*/\s*Admin$' THEN 'Admin'
        ELSE btrim(elem)
      END
      ORDER BY ord
    ),
    ARRAY[]::text[]
  )
  FROM unnest(user_roles) WITH ORDINALITY AS u(elem, ord)
)
WHERE user_roles IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(user_roles) AS e WHERE e ~* 'Owner\s*/\s*Admin'
  );

-- ---------------------------------------------------------------------------
-- Recreate CHECKs with Owner + Admin
-- ---------------------------------------------------------------------------

ALTER TABLE organization_memberships
  ADD CONSTRAINT organization_memberships_role_check
  CHECK (
    role = ANY(ARRAY[
      'Owner',
      'Admin',
      'Driver',
      'Permit Clerk',
      'Viewer'
    ]::text[])
  );

ALTER TABLE member_profiles
  ADD CONSTRAINT member_profiles_user_roles_check
  CHECK (
    user_roles <@ ARRAY[
      'Owner',
      'Admin',
      'Driver',
      'Permit Clerk',
      'Viewer'
    ]::text[]
  );

ALTER TABLE team_member_profiles
  ADD CONSTRAINT team_member_profiles_user_roles_check
  CHECK (
    user_roles <@ ARRAY[
      'Owner',
      'Admin',
      'Driver',
      'Permit Clerk',
      'Viewer'
    ]::text[]
  );

-- ---------------------------------------------------------------------------
-- Service mode helper: Owner and Admin (replaces Owner / Admin)
-- ---------------------------------------------------------------------------

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
    AND role IN ('Permit Clerk', 'Owner', 'Admin');
$$;

COMMENT ON FUNCTION auth_user_service_mode_org_ids() IS
'Organization ids the current user may scope in Service Mode (Permit Clerk, Owner, or Admin memberships).';

NOTIFY pgrst, 'reload schema';
