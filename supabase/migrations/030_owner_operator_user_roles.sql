-- Allow Owner Operator (Owner + Driver) on member_profiles.user_roles.
-- Drop legacy CHECK first so data can migrate from Owner / Admin → Owner.

-- ---------------------------------------------------------------------------
-- Drop existing user_roles CHECK constraints (legacy allowlist blocks Owner)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Data migration: legacy Owner / Admin → Owner (primary) or Admin (others)
-- ---------------------------------------------------------------------------

UPDATE member_profiles
SET user_roles = array_replace(user_roles, 'Owner / Admin', 'Owner')
WHERE is_primary_owner = true
  AND 'Owner / Admin' = ANY(user_roles);

UPDATE member_profiles
SET user_roles = array_replace(user_roles, 'Owner / Admin', 'Admin')
WHERE (is_primary_owner = false OR is_primary_owner IS NULL)
  AND 'Owner / Admin' = ANY(user_roles);

UPDATE team_member_profiles
SET user_roles = array_replace(user_roles, 'Owner / Admin', 'Admin')
WHERE 'Owner / Admin' = ANY(user_roles);

-- ---------------------------------------------------------------------------
-- Clamp primary owners to Owner-only or Owner Operator (Owner + Driver)
-- ---------------------------------------------------------------------------

UPDATE member_profiles
SET user_roles = (
  CASE
    WHEN 'Driver' = ANY(user_roles) THEN ARRAY['Owner', 'Driver']::text[]
    ELSE ARRAY['Owner']::text[]
  END
)
WHERE is_primary_owner = true
   OR 'Owner' = ANY(user_roles);

-- Remaining legacy Owner / Admin rows: Owner / Admin or Owner / Admin + Driver only
UPDATE member_profiles
SET user_roles = (
  CASE
    WHEN 'Driver' = ANY(user_roles) THEN ARRAY['Owner / Admin', 'Driver']::text[]
    ELSE ARRAY['Owner / Admin']::text[]
  END
)
WHERE 'Owner / Admin' = ANY(user_roles);

-- ---------------------------------------------------------------------------
-- Validation helper: every role allowed; Owner may only pair with Driver.
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
        'Viewer',
        'Owner / Admin'
      ]::text[]
      AND (
        NOT ('Owner' = ANY(roles))
        OR roles <@ ARRAY['Owner', 'Driver']::text[]
      )
      AND (
        NOT ('Owner / Admin' = ANY(roles))
        OR cardinality(roles) = 1
        OR roles <@ ARRAY['Owner / Admin', 'Driver']::text[]
      )
    );
$$;

COMMENT ON FUNCTION member_profile_user_roles_valid(text[]) IS
'Validates member_profiles.user_roles: subset of allowed roles; Owner Operator = Owner+Driver only.';

-- ---------------------------------------------------------------------------
-- Recreate CHECK constraints
-- ---------------------------------------------------------------------------

ALTER TABLE member_profiles
  ADD CONSTRAINT member_profiles_user_roles_check
  CHECK (member_profile_user_roles_valid(user_roles));

ALTER TABLE team_member_profiles
  ADD CONSTRAINT team_member_profiles_user_roles_check
  CHECK (
    user_roles <@ ARRAY[
      'Owner',
      'Admin',
      'Driver',
      'Permit Clerk',
      'Viewer',
      'Owner / Admin'
    ]::text[]
  );

COMMENT ON CONSTRAINT member_profiles_user_roles_check ON member_profiles IS
'Allows Owner Operator (Owner+Driver), single roles, and legacy Owner / Admin during transition.';

NOTIFY pgrst, 'reload schema';