-- supabase/migrations/020_member_profiles_privileged_columns.sql
--
-- Prevent users from arbitrarily setting organization_id or is_primary_owner on
-- self-service INSERT/UPDATE. Bootstrap (new org + primary owner) is allowed once
-- when no organization is assigned yet.

CREATE OR REPLACE FUNCTION member_profile_org_already_exists(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM member_profiles
    WHERE organization_id = org_id
  );
$$;

CREATE OR REPLACE FUNCTION enforce_member_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Primary owners editing other org members bypass self-service restrictions.
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.organization_id IS NULL THEN
      IF NEW.is_primary_owner = true THEN
        RAISE EXCEPTION 'Cannot set is_primary_owner without organization_id';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.is_primary_owner = true AND NOT member_profile_org_already_exists(NEW.organization_id) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Cannot set organization_id without primary owner bootstrap';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.organization_id IS NULL AND NEW.organization_id IS NOT NULL THEN
      IF NEW.is_primary_owner = true AND NOT member_profile_org_already_exists(NEW.organization_id) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Organization bootstrap requires a new organization_id and is_primary_owner';
    END IF;

    IF OLD.organization_id IS NOT NULL AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'Cannot change organization_id on self-update';
    END IF;

    IF OLD.is_primary_owner IS DISTINCT FROM NEW.is_primary_owner THEN
      RAISE EXCEPTION 'Cannot change is_primary_owner on self-update';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_member_profile_privileged_columns ON member_profiles;
CREATE TRIGGER enforce_member_profile_privileged_columns
  BEFORE INSERT OR UPDATE ON member_profiles
  FOR EACH ROW
  EXECUTE FUNCTION enforce_member_profile_privileged_columns();

COMMENT ON FUNCTION enforce_member_profile_privileged_columns() IS
'Blocks self-service changes to organization_id and is_primary_owner except one-time org bootstrap.';

NOTIFY pgrst, 'reload schema';