-- supabase/migrations/023_member_profiles_self_service_field_guard.sql
--
-- Block non-primary-owner self-service writes to privileged member_profiles columns
-- (user_roles, carrier fields, restricted driver identity fields). Drivers may still
-- update contact fields (driver_phone, driver_email, emergency_contact) directly.
-- Primary owners editing other members and service-role writes bypass this guard.

CREATE OR REPLACE FUNCTION enforce_member_profile_self_service_restricted_fields()
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

  -- Service-role / backend writes bypass (no authenticated end-user context).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Primary owners may self-update all fields.
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
    IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth THEN
      NEW.date_of_birth := OLD.date_of_birth;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_member_profile_self_service_restricted_fields ON member_profiles;
CREATE TRIGGER enforce_member_profile_self_service_restricted_fields
  BEFORE UPDATE ON member_profiles
  FOR EACH ROW
  EXECUTE FUNCTION enforce_member_profile_self_service_restricted_fields();

COMMENT ON FUNCTION enforce_member_profile_self_service_restricted_fields() IS
'Freezes user_roles, carrier columns, and restricted driver identity fields on non-primary-owner self-updates.';

-- Drivers may withdraw their own pending profile change requests.
DROP POLICY IF EXISTS "Users can delete own pending profile change requests" ON profile_change_requests;
CREATE POLICY "Users can delete own pending profile change requests"
ON profile_change_requests
FOR DELETE
USING (
  auth.uid() = requester_user_id
  AND auth.uid() = target_user_id
  AND status = 'pending'
);

-- Document primary-owner UPDATE intent with explicit WITH CHECK (matches USING).
DROP POLICY IF EXISTS "Primary owners can update org profile change requests" ON profile_change_requests;
CREATE POLICY "Primary owners can update org profile change requests"
ON profile_change_requests
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM member_profiles mp
    WHERE mp.user_id = auth.uid()
      AND mp.organization_id = profile_change_requests.organization_id
      AND mp.is_primary_owner = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM member_profiles mp
    WHERE mp.user_id = auth.uid()
      AND mp.organization_id = profile_change_requests.organization_id
      AND mp.is_primary_owner = true
  )
);

NOTIFY pgrst, 'reload schema';