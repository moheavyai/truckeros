-- Repair: role CHECKs for organization_memberships + member/team profile user_roles,
-- and service-mode helper — so 035 accept (Owner membership + user_roles=['Owner']) works
-- even when 026 failed mid-flight under the legacy allowlists.
--
-- Migration 021 memberships CHECK: Owner / Admin, Driver, Permit Clerk, Viewer.
-- 026 intended split Owner + Admin but rewrote values before DROP (fixed in-repo);
-- stuck envs keep the legacy CHECK and block 'Owner' / 'Admin' inserts.
--
-- Idempotent: named drops first, narrow defensive drops, normalize, validate, recreate.
-- Owner Operator is Owner+Driver on member_profiles.user_roles, not membership.role.

-- ---------------------------------------------------------------------------
-- Drop known CHECKs first (named)
-- ---------------------------------------------------------------------------

ALTER TABLE organization_memberships
  DROP CONSTRAINT IF EXISTS organization_memberships_role_check;

ALTER TABLE member_profiles
  DROP CONSTRAINT IF EXISTS member_profiles_user_roles_check;

ALTER TABLE team_member_profiles
  DROP CONSTRAINT IF EXISTS team_member_profiles_user_roles_check;

-- Defensive: drop alternate CHECK names that still encode role allowlists
-- (narrow: only defs that mention Owner / Admin or role = ANY / user_roles).
-- Guard with to_regclass so partial DBs without these tables do not abort here.
DO $$
DECLARE
  r RECORD;
  memberships_reg regclass := to_regclass('public.organization_memberships');
  member_profiles_reg regclass := to_regclass('public.member_profiles');
  team_profiles_reg regclass := to_regclass('public.team_member_profiles');
BEGIN
  IF memberships_reg IS NOT NULL THEN
    FOR r IN
      SELECT c.conname, c.conrelid::regclass AS tbl
      FROM pg_constraint c
      WHERE c.contype = 'c'
        AND c.conrelid = memberships_reg
        AND c.conname <> 'organization_memberships_role_check'
        AND (
          pg_get_constraintdef(c.oid) LIKE '%Owner / Admin%'
          OR pg_get_constraintdef(c.oid) LIKE '%role = ANY%'
        )
    LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
    END LOOP;
  END IF;

  IF member_profiles_reg IS NOT NULL OR team_profiles_reg IS NOT NULL THEN
    FOR r IN
      SELECT c.conname, c.conrelid::regclass AS tbl
      FROM pg_constraint c
      WHERE c.contype = 'c'
        AND c.conrelid IN (
          SELECT x FROM unnest(ARRAY[member_profiles_reg, team_profiles_reg]) AS x
          WHERE x IS NOT NULL
        )
        AND c.conname NOT IN (
          'member_profiles_user_roles_check',
          'team_member_profiles_user_roles_check'
        )
        AND pg_get_constraintdef(c.oid) LIKE '%user_roles%'
    LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
    END LOOP;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Normalize legacy roles (trim + convert "Owner / Admin" variants)
-- ---------------------------------------------------------------------------
-- App / migration 035 insert split roles: Owner, Admin, Permit Clerk, …
-- Legacy rows still store combined "Owner / Admin" (and spacing variants).
-- Convert those values BEFORE recreating CHECKs so ADD CONSTRAINT / inserts succeed.

-- Memberships: trim + normalize slash spacing ("Owner/Admin", "Owner  /  Admin")
UPDATE organization_memberships
SET role = btrim(role)
WHERE role IS NOT NULL
  AND role IS DISTINCT FROM btrim(role);

UPDATE organization_memberships
SET role = regexp_replace(btrim(role), '\s*/\s*', ' / ', 'g')
WHERE role IS NOT NULL
  AND role ~ '/';

-- Combined role → Owner (primary) or Admin (everyone else)
UPDATE organization_memberships
SET role = 'Owner'
WHERE is_primary_owner = true
  AND role ~* '^Owner\s*/\s*Admin$';

UPDATE organization_memberships
SET role = 'Admin'
WHERE (is_primary_owner = false OR is_primary_owner IS NULL)
  AND role ~* '^Owner\s*/\s*Admin$';

-- Catch any leftover combined-role spellings (skip if already split)
UPDATE organization_memberships
SET role = CASE
  WHEN is_primary_owner = true THEN 'Owner'
  ELSE 'Admin'
END
WHERE role IS NOT NULL
  AND role NOT IN ('Owner', 'Admin', 'Driver', 'Permit Clerk', 'Viewer')
  AND (
    role ILIKE '%Owner%Admin%'
    OR role ILIKE 'Owner / Admin%'
    OR btrim(role) = 'Owner / Admin'
  );

-- Profiles: map each array element Owner / Admin → Owner|Admin, then clamp
UPDATE member_profiles
SET user_roles = (
  SELECT COALESCE(
    array_agg(
      CASE
        WHEN elem ~* '^Owner\s*/\s*Admin$' AND COALESCE(is_primary_owner, false) THEN 'Owner'
        WHEN elem ~* '^Owner\s*/\s*Admin$' THEN 'Admin'
        WHEN btrim(elem) = 'Owner / Admin' AND COALESCE(is_primary_owner, false) THEN 'Owner'
        WHEN btrim(elem) = 'Owner / Admin' THEN 'Admin'
        ELSE btrim(elem)
      END
      ORDER BY ord
    ),
    ARRAY[]::text[]
  )
  FROM unnest(user_roles) WITH ORDINALITY AS u(elem, ord)
)
WHERE user_roles IS NOT NULL
  AND cardinality(user_roles) > 0
  AND EXISTS (
    SELECT 1
    FROM unnest(user_roles) AS e
    WHERE e ~* 'Owner\s*/\s*Admin'
       OR btrim(e) = 'Owner / Admin'
  );

UPDATE team_member_profiles
SET user_roles = (
  SELECT COALESCE(
    array_agg(
      CASE
        WHEN elem ~* '^Owner\s*/\s*Admin$' OR btrim(elem) = 'Owner / Admin' THEN 'Admin'
        ELSE btrim(elem)
      END
      ORDER BY ord
    ),
    ARRAY[]::text[]
  )
  FROM unnest(user_roles) WITH ORDINALITY AS u(elem, ord)
)
WHERE user_roles IS NOT NULL
  AND cardinality(user_roles) > 0
  AND EXISTS (
    SELECT 1
    FROM unnest(user_roles) AS e
    WHERE e ~* 'Owner\s*/\s*Admin'
       OR btrim(e) = 'Owner / Admin'
  );

-- 030-style clamp: after token rewrite, Owner may only pair with Driver
-- (Owner Operator). Drops invalid combos like Owner+Permit Clerk that would
-- fail member_profile_user_roles_valid on ADD CONSTRAINT.
UPDATE member_profiles
SET user_roles = (
  CASE
    WHEN 'Driver' = ANY(user_roles) THEN ARRAY['Owner', 'Driver']::text[]
    ELSE ARRAY['Owner']::text[]
  END
)
WHERE is_primary_owner = true
   OR 'Owner' = ANY(COALESCE(user_roles, ARRAY[]::text[]));

-- Fail clearly if any membership role remains outside the app allowlist
-- (typos / unexpected variants — do not silently coerce free-form junk).
DO $$
DECLARE
  bad text;
BEGIN
  IF to_regclass('public.organization_memberships') IS NULL THEN
    RAISE EXCEPTION 'organization_memberships table is missing; apply full migrations first';
  END IF;

  SELECT string_agg(DISTINCT role, ', ' ORDER BY role) INTO bad
  FROM organization_memberships
  WHERE role IS NOT NULL
    AND role <> ALL (ARRAY[
      'Owner',
      'Admin',
      'Driver',
      'Permit Clerk',
      'Viewer'
    ]::text[]);

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'organization_memberships has role values outside allowlist after normalize: %. Expected Owner, Admin, Driver, Permit Clerk, Viewer (legacy Owner / Admin is mapped to Owner or Admin).',
      bad;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Recreate organization_memberships.role CHECK
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organization_memberships_role_check'
      AND conrelid = 'organization_memberships'::regclass
  ) THEN
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
  END IF;
END $$;

COMMENT ON CONSTRAINT organization_memberships_role_check ON organization_memberships IS
'Allowed membership roles: Owner, Admin, Driver, Permit Clerk, Viewer (Owner Operator uses membership role Owner).';

-- ---------------------------------------------------------------------------
-- member_profiles / team_member_profiles user_roles (align with 030; no legacy combined role)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION member_profile_user_roles_valid(roles text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    roles IS NULL
    OR cardinality(roles) = 0
    OR (
      roles <@ ARRAY[
        'Owner',
        'Admin',
        'Driver',
        'Permit Clerk',
        'Viewer'
      ]::text[]
      AND (
        NOT ('Owner' = ANY(roles))
        OR roles <@ ARRAY['Owner', 'Driver']::text[]
      )
    );
$$;

COMMENT ON FUNCTION member_profile_user_roles_valid(text[]) IS
'Validates member_profiles.user_roles: subset of allowed roles; Owner Operator = Owner+Driver only. Legacy Owner / Admin is converted before CHECK recreate.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'member_profiles_user_roles_check'
      AND conrelid = 'member_profiles'::regclass
  ) THEN
    ALTER TABLE member_profiles
      ADD CONSTRAINT member_profiles_user_roles_check
      CHECK (member_profile_user_roles_valid(user_roles));
  END IF;

  IF to_regclass('public.team_member_profiles') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'team_member_profiles_user_roles_check'
         AND conrelid = 'team_member_profiles'::regclass
     ) THEN
    ALTER TABLE team_member_profiles
      ADD CONSTRAINT team_member_profiles_user_roles_check
      CHECK (
        user_roles IS NULL
        OR user_roles <@ ARRAY[
          'Owner',
          'Admin',
          'Driver',
          'Permit Clerk',
          'Viewer'
        ]::text[]
      );
  END IF;
END $$;

COMMENT ON CONSTRAINT member_profiles_user_roles_check ON member_profiles IS
'Allows Owner Operator (Owner+Driver) and single roles Owner/Admin/Driver/Permit Clerk/Viewer.';

-- ---------------------------------------------------------------------------
-- Service mode helper: Owner and Admin (replaces Owner / Admin from 025/failed 026)
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
