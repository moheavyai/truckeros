-- Phase 1 Fix Round 4: team_invites self-Clerk PE matches session user (auth.uid()),
-- not only when invited_by_user_id = auth.uid().
--
-- Closes: org manager UPDATEs another inviter's invite to role=Permit Clerk + own email
-- while leaving invited_by as the other user → PE was skipped.
--
-- When NEW.role = Permit Clerk, compare invite_email/phone to JWT user's email/phone
-- and member_profiles contact fields for auth.uid(). Status-only UPDATE short-circuit
-- retained. Service-role (auth.uid() null) exempt.

CREATE OR REPLACE FUNCTION enforce_no_self_permit_clerk_team_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_email text;
  v_auth_phone text;
  v_invite_email text;
  v_invite_digits text;
  v_driver_email text;
  v_carrier_email text;
  v_driver_phone text;
  v_carrier_phone text;
BEGIN
  IF NEW.role IS DISTINCT FROM 'Permit Clerk' THEN
    RETURN NEW;
  END IF;

  -- Service-role: allow.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- UPDATE: skip PE when role/email/phone unchanged (status revoke/expiry ok).
  -- Note: invited_by rebinding alone is rare; re-check if email/phone/role change.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.role IS NOT DISTINCT FROM OLD.role
       AND NEW.invite_email IS NOT DISTINCT FROM OLD.invite_email
       AND NEW.invite_phone IS NOT DISTINCT FROM OLD.invite_phone THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Always match against **session user** contacts (independent of invited_by_user_id).
  SELECT lower(nullif(trim(u.email), '')), nullif(trim(u.phone), '')
  INTO v_auth_email, v_auth_phone
  FROM auth.users u
  WHERE u.id = auth.uid();

  v_invite_email := lower(nullif(trim(NEW.invite_email), ''));

  IF v_invite_email IS NOT NULL THEN
    IF v_auth_email IS NOT NULL AND v_invite_email = v_auth_email THEN
      RAISE EXCEPTION 'Cannot invite yourself as Permit Clerk'
        USING ERRCODE = '42501';
    END IF;

    SELECT
      lower(nullif(trim(mp.driver_email), '')),
      lower(nullif(trim(mp.carrier_email), ''))
    INTO v_driver_email, v_carrier_email
    FROM member_profiles mp
    WHERE mp.user_id = auth.uid()
    LIMIT 1;

    IF v_driver_email IS NOT NULL AND v_invite_email = v_driver_email THEN
      RAISE EXCEPTION 'Cannot invite yourself as Permit Clerk'
        USING ERRCODE = '42501';
    END IF;
    IF v_carrier_email IS NOT NULL AND v_invite_email = v_carrier_email THEN
      RAISE EXCEPTION 'Cannot invite yourself as Permit Clerk'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  -- Phone-only self match; if session phones unknown, allow (matches app).
  v_invite_digits := invite_phone_digits(NEW.invite_phone);
  IF v_invite_digits IS NULL THEN
    RETURN NEW;
  END IF;

  IF invite_phone_digits(v_auth_phone) IS NOT NULL
     AND invite_phone_digits(v_auth_phone) = v_invite_digits THEN
    RAISE EXCEPTION 'Cannot invite yourself as Permit Clerk'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    invite_phone_digits(mp.driver_phone),
    invite_phone_digits(mp.carrier_phone)
  INTO v_driver_phone, v_carrier_phone
  FROM member_profiles mp
  WHERE mp.user_id = auth.uid()
  LIMIT 1;

  IF v_driver_phone IS NOT NULL AND v_driver_phone = v_invite_digits THEN
    RAISE EXCEPTION 'Cannot invite yourself as Permit Clerk'
      USING ERRCODE = '42501';
  END IF;
  IF v_carrier_phone IS NOT NULL AND v_carrier_phone = v_invite_digits THEN
    RAISE EXCEPTION 'Cannot invite yourself as Permit Clerk'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_no_self_permit_clerk_team_invite() IS
'Phase 1 PE Fix Round 4: when role is Permit Clerk, block if invite email/phone matches session user (auth.uid()) contacts — independent of invited_by_user_id. Status-only UPDATE allowed. Service-role exempt.';

-- Triggers already exist from 040; recreate to ensure attachment after function replace.
DROP TRIGGER IF EXISTS trg_no_self_permit_clerk_team_invite ON team_invites;
DROP TRIGGER IF EXISTS trg_no_self_permit_clerk_team_invite_update ON team_invites;

CREATE TRIGGER trg_no_self_permit_clerk_team_invite
  BEFORE INSERT ON team_invites
  FOR EACH ROW
  EXECUTE FUNCTION enforce_no_self_permit_clerk_team_invite();

CREATE TRIGGER trg_no_self_permit_clerk_team_invite_update
  BEFORE UPDATE ON team_invites
  FOR EACH ROW
  EXECUTE FUNCTION enforce_no_self_permit_clerk_team_invite();

NOTIFY pgrst, 'reload schema';
