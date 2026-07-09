-- Phase 1 Fix Round 1: durable PE closes + accept inviter Clerk-only.
--
-- 1) Block self-promotion of organization_memberships.role to Permit Clerk
--    (UPDATE only; stay-as-Clerk allowed). Service-role (auth.uid() null) allowed.
-- 2) Block team_invites self-invite as Permit Clerk (email or matching phone).
-- 3) accept_carrier_connection_invite + auth_user_can_manage_carrier_connection
--    require inviter membership role = Permit Clerk only.
--
-- Idempotent. Does not add service_seat (Phase 3).

-- ---------------------------------------------------------------------------
-- (1) Membership: no self-promotion to Permit Clerk
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_no_self_promote_to_permit_clerk()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service-role / no JWT: allow (connection-invite shell Clerk mint, ops).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only care about setting own membership to Permit Clerk.
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM 'Permit Clerk' THEN
    RETURN NEW;
  END IF;

  -- UPDATE: allow if already Permit Clerk (idempotent stay).
  IF TG_OP = 'UPDATE' THEN
    IF OLD.role IS NOT DISTINCT FROM 'Permit Clerk' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Cannot reassign your own membership role to Permit Clerk'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_no_self_promote_to_permit_clerk() IS
'Phase 1 PE: forbid JWT user updating own organization_memberships.role to Permit Clerk unless already Clerk.';

DROP TRIGGER IF EXISTS trg_no_self_promote_to_permit_clerk ON organization_memberships;
DROP TRIGGER IF EXISTS trg_no_self_promote_to_permit_clerk_row ON organization_memberships;

CREATE TRIGGER trg_no_self_promote_to_permit_clerk
  BEFORE UPDATE ON organization_memberships
  FOR EACH ROW
  WHEN (NEW.role IS DISTINCT FROM OLD.role)
  EXECUTE FUNCTION enforce_no_self_promote_to_permit_clerk();

-- ---------------------------------------------------------------------------
-- (2) team_invites: no self Permit Clerk invite (email or phone)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION invite_phone_digits(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(coalesce(value, ''), '\D', '', 'g'), '');
$$;

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
'Phase 1 PE: forbid team_invites INSERT with role Permit Clerk targeted at inviter email/phone.';

DROP TRIGGER IF EXISTS trg_no_self_permit_clerk_team_invite ON team_invites;

CREATE TRIGGER trg_no_self_permit_clerk_team_invite
  BEFORE INSERT ON team_invites
  FOR EACH ROW
  EXECUTE FUNCTION enforce_no_self_permit_clerk_team_invite();

-- ---------------------------------------------------------------------------
-- (3) Carrier connection: inviter must be Permit Clerk membership
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth_user_can_manage_carrier_connection(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_memberships om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = org_id
      AND om.role = 'Permit Clerk'
  );
$$;

COMMENT ON FUNCTION auth_user_can_manage_carrier_connection(uuid) IS
'Phase 1: true when current user has Permit Clerk membership on the org (connection invite client path).';

-- accept_carrier_connection_invite: same as 035 with inviter check narrowed to Permit Clerk.
CREATE OR REPLACE FUNCTION accept_carrier_connection_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_pending carrier_connection_invites%ROWTYPE;
  v_invite carrier_connection_invites%ROWTYPE;
  v_org_id uuid;
  v_existing_org uuid;
  v_existing_primary boolean;
  v_rewrite_home boolean;
  v_invite_email text;
  v_other_primary uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NULLIF(trim(p_token), '') IS NULL THEN
    RAISE EXCEPTION 'Missing invite token';
  END IF;

  -- Transaction-local bypass for column-protect trigger so claim can set
  -- status=accepted + accepted_* while acceptor JWT (auth.uid()) is present.
  PERFORM set_config('truckeros.carrier_invite_accept', '1', true);

  SELECT * INTO v_pending
  FROM carrier_connection_invites
  WHERE invite_token = trim(p_token)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF v_pending.status = 'accepted' THEN
    RAISE EXCEPTION 'This invite has already been accepted';
  END IF;

  IF v_pending.status = 'revoked' THEN
    RAISE EXCEPTION 'This invite has been revoked';
  END IF;

  IF v_pending.status = 'expired' OR v_pending.expires_at <= now() THEN
    RAISE EXCEPTION 'This invite has expired';
  END IF;

  v_invite_email := lower(trim(coalesce(v_pending.invite_email, '')));
  IF v_invite_email = '' THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;
  IF v_email = '' OR v_email <> v_invite_email THEN
    RAISE EXCEPTION 'Sign in with the email address that received this invite';
  END IF;

  IF v_pending.organization_id IS NULL THEN
    RAISE EXCEPTION 'Invite is missing organization';
  END IF;

  v_org_id := v_pending.organization_id;

  -- Phase 1 Fix Round 1: inviter must hold Permit Clerk membership on the shell org.
  IF NOT EXISTS (
    SELECT 1
    FROM organization_memberships om
    WHERE om.user_id = v_pending.invited_by_user_id
      AND om.organization_id = v_org_id
      AND om.role = 'Permit Clerk'
  ) THEN
    RAISE EXCEPTION 'Invite not found or no longer valid';
  END IF;

  SELECT user_id INTO v_other_primary
  FROM organization_memberships
  WHERE organization_id = v_org_id
    AND is_primary_owner = true
    AND user_id IS DISTINCT FROM v_uid
  LIMIT 1;

  IF v_other_primary IS NOT NULL THEN
    RAISE EXCEPTION 'This carrier already has a primary owner';
  END IF;

  UPDATE carrier_connection_invites
  SET
    status = 'accepted',
    accepted_by_user_id = v_uid,
    accepted_at = now()
  WHERE id = v_pending.id
    AND status = 'pending'
    AND expires_at > now()
  RETURNING * INTO v_invite;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This invite has already been accepted';
  END IF;

  INSERT INTO organization_memberships (
    organization_id,
    user_id,
    role,
    is_primary_owner,
    permissions
  )
  VALUES (
    v_org_id,
    v_uid,
    'Owner',
    true,
    '{"mode":"global"}'::jsonb
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
  SET
    role = CASE
      WHEN organization_memberships.is_primary_owner THEN organization_memberships.role
      ELSE 'Owner'
    END,
    is_primary_owner = true,
    permissions = COALESCE(organization_memberships.permissions, EXCLUDED.permissions);

  SELECT organization_id, is_primary_owner
  INTO v_existing_org, v_existing_primary
  FROM member_profiles
  WHERE user_id = v_uid
  LIMIT 1;

  v_rewrite_home := (
    v_existing_org IS NULL
    OR (
      v_existing_org = v_org_id
      AND NOT COALESCE(v_existing_primary, false)
    )
  );

  IF v_rewrite_home THEN
    INSERT INTO member_profiles (
      user_id,
      organization_id,
      is_primary_owner,
      user_roles,
      company_name,
      usdot_number,
      mc_number,
      ein,
      carrier_address,
      carrier_phone,
      carrier_email,
      insurance_contact,
      driver_full_name,
      driver_email,
      driver_phone
    )
    VALUES (
      v_uid,
      v_org_id,
      true,
      ARRAY['Owner']::text[],
      v_invite.company_name,
      v_invite.usdot_number,
      v_invite.mc_number,
      v_invite.ein,
      v_invite.carrier_address,
      v_invite.carrier_phone,
      COALESCE(NULLIF(trim(v_invite.carrier_email), ''), NULLIF(v_invite_email, '')),
      v_invite.insurance_contact,
      v_invite.invite_contact_name,
      NULLIF(v_invite_email, ''),
      v_invite.invite_phone
    )
    ON CONFLICT (user_id) DO UPDATE
    SET
      organization_id = EXCLUDED.organization_id,
      is_primary_owner = true,
      user_roles = ARRAY['Owner']::text[],
      company_name = COALESCE(NULLIF(trim(member_profiles.company_name), ''), EXCLUDED.company_name),
      usdot_number = COALESCE(NULLIF(trim(member_profiles.usdot_number), ''), EXCLUDED.usdot_number),
      mc_number = COALESCE(NULLIF(trim(member_profiles.mc_number), ''), EXCLUDED.mc_number),
      ein = COALESCE(NULLIF(trim(member_profiles.ein), ''), EXCLUDED.ein),
      carrier_address = COALESCE(NULLIF(trim(member_profiles.carrier_address), ''), EXCLUDED.carrier_address),
      carrier_phone = COALESCE(NULLIF(trim(member_profiles.carrier_phone), ''), EXCLUDED.carrier_phone),
      carrier_email = COALESCE(NULLIF(trim(member_profiles.carrier_email), ''), EXCLUDED.carrier_email),
      insurance_contact = COALESCE(NULLIF(trim(member_profiles.insurance_contact), ''), EXCLUDED.insurance_contact),
      driver_full_name = COALESCE(NULLIF(trim(member_profiles.driver_full_name), ''), EXCLUDED.driver_full_name),
      driver_email = COALESCE(NULLIF(trim(member_profiles.driver_email), ''), EXCLUDED.driver_email),
      driver_phone = COALESCE(NULLIF(trim(member_profiles.driver_phone), ''), EXCLUDED.driver_phone),
      updated_at = now();
  END IF;

  RETURN to_jsonb(v_invite);
END;
$$;

COMMENT ON FUNCTION accept_carrier_connection_invite(text) IS
'Accept carrier connection invite; inviter must have Permit Clerk membership on shell (Phase 1 Fix Round 1).';

REVOKE ALL ON FUNCTION accept_carrier_connection_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_carrier_connection_invite(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
