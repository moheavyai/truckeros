-- 050_add_cdl_expiration.sql
-- CDL expiration date for roster/driver profiles; used by Permit Agent badges.

ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS cdl_expiration date;

ALTER TABLE team_member_profiles
  ADD COLUMN IF NOT EXISTS cdl_expiration date;

COMMENT ON COLUMN member_profiles.cdl_expiration IS 'CDL expiration date (YYYY-MM-DD); used for missing/expired/expiring-soon flags in Permit Agent';
COMMENT ON COLUMN team_member_profiles.cdl_expiration IS 'CDL expiration date (YYYY-MM-DD); used for missing/expired/expiring-soon flags in Permit Agent';

-- Keep self-service field guard in sync: drivers cannot self-write cdl_expiration
-- without going through profile change request / admin path.
CREATE OR REPLACE FUNCTION enforce_member_profile_self_service_restricted_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_primary_owner, false) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_roles IS DISTINCT FROM OLD.user_roles THEN
      NEW.user_roles := OLD.user_roles;
    END IF;

    IF NEW.company_name IS DISTINCT FROM OLD.company_name THEN
      NEW.company_name := OLD.company_name;
    END IF;
    IF NEW.usdot_number IS DISTINCT FROM OLD.usdot_number THEN
      NEW.usdot_number := OLD.usdot_number;
    END IF;
    IF NEW.mc_number IS DISTINCT FROM OLD.mc_number THEN
      NEW.mc_number := OLD.mc_number;
    END IF;
    IF NEW.ein IS DISTINCT FROM OLD.ein THEN
      NEW.ein := OLD.ein;
    END IF;
    IF NEW.carrier_address IS DISTINCT FROM OLD.carrier_address THEN
      NEW.carrier_address := OLD.carrier_address;
    END IF;
    IF NEW.carrier_phone IS DISTINCT FROM OLD.carrier_phone THEN
      NEW.carrier_phone := OLD.carrier_phone;
    END IF;
    IF NEW.carrier_email IS DISTINCT FROM OLD.carrier_email THEN
      NEW.carrier_email := OLD.carrier_email;
    END IF;
    IF NEW.insurance_contact IS DISTINCT FROM OLD.insurance_contact THEN
      NEW.insurance_contact := OLD.insurance_contact;
    END IF;

    IF NEW.driver_full_name IS DISTINCT FROM OLD.driver_full_name THEN
      NEW.driver_full_name := OLD.driver_full_name;
    END IF;
    IF NEW.cdl_number IS DISTINCT FROM OLD.cdl_number THEN
      NEW.cdl_number := OLD.cdl_number;
    END IF;
    IF NEW.cdl_state IS DISTINCT FROM OLD.cdl_state THEN
      NEW.cdl_state := OLD.cdl_state;
    END IF;
    IF NEW.cdl_expiration IS DISTINCT FROM OLD.cdl_expiration THEN
      NEW.cdl_expiration := OLD.cdl_expiration;
    END IF;
    IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth THEN
      NEW.date_of_birth := OLD.date_of_birth;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_member_profile_self_service_restricted_fields() IS
'Freezes user_roles, carrier columns, and restricted driver identity fields (including cdl_expiration) on non-primary-owner self-updates.';
