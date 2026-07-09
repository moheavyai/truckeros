-- Phase 1 Fix Round 3: team_invites self-Clerk PE on UPDATE as well as INSERT.
-- Closes: create self-invite as Viewer then UPDATE role → Permit Clerk.
-- Service-role (auth.uid() null) exempt.
-- Status-only updates (e.g. revoke) do not re-check when role/email/phone unchanged.

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

  -- Only when inviter is the current JWT user.
  IF NEW.invited_by_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;

  -- UPDATE: skip PE when role/email/phone/inviter unchanged (status revoke/expiry ok).
  IF TG_OP = 'UPDATE' THEN
    IF NEW.role IS NOT DISTINCT FROM OLD.role
       AND NEW.invite_email IS NOT DISTINCT FROM OLD.invite_email
       AND NEW.invite_phone IS NOT DISTINCT FROM OLD.invite_phone
       AND NEW.invited_by_user_id IS NOT DISTINCT FROM OLD.invited_by_user_id THEN
      RETURN NEW;
    END IF;
  END IF;

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

  -- Phone-only self match; if inviter phones unknown, allow (matches app).
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
'Phase 1 PE: forbid team_invites INSERT/UPDATE that make role Permit Clerk for inviter self email/phone. Status-only UPDATE allowed. Service-role exempt.';

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
