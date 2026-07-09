-- Phase 1 Fix Round 2: block JWT self-INSERT of organization_memberships as Permit Clerk.
-- Service role (auth.uid() null) exempt. Team invite accept RPC sets GUC bypass.
-- Stay-as-Clerk UPDATE still allowed via 038 logic.

CREATE OR REPLACE FUNCTION enforce_no_self_promote_to_permit_clerk()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service-role / no JWT: allow (connection-invite shell Clerk mint, ops, admin accept).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Invite accept RPCs set transaction-local GUCs before membership writes.
  IF coalesce(current_setting('truckeros.team_invite_accept', true), '') = '1'
     OR coalesce(current_setting('truckeros.carrier_invite_accept', true), '') = '1' THEN
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

  -- INSERT: block JWT self-insert as Permit Clerk (PE via invite-accept policy).
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Cannot reassign your own membership role to Permit Clerk'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_no_self_promote_to_permit_clerk() IS
'Phase 1 PE: forbid JWT user INSERT/UPDATE of own membership to Permit Clerk unless already Clerk (UPDATE) or invite-accept GUC set. Service-role exempt.';

DROP TRIGGER IF EXISTS trg_no_self_promote_to_permit_clerk ON organization_memberships;
DROP TRIGGER IF EXISTS trg_no_self_promote_to_permit_clerk_insert ON organization_memberships;

CREATE TRIGGER trg_no_self_promote_to_permit_clerk
  BEFORE UPDATE ON organization_memberships
  FOR EACH ROW
  WHEN (NEW.role IS DISTINCT FROM OLD.role)
  EXECUTE FUNCTION enforce_no_self_promote_to_permit_clerk();

CREATE TRIGGER trg_no_self_promote_to_permit_clerk_insert
  BEFORE INSERT ON organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION enforce_no_self_promote_to_permit_clerk();

-- accept_team_invite: set GUC so Permit Clerk membership INSERT for acceptor is allowed.
CREATE OR REPLACE FUNCTION accept_team_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_pending team_invites%ROWTYPE;
  v_invite team_invites%ROWTYPE;
  v_roles text[];
  v_existing_org uuid;
  v_existing_primary boolean;
  v_rewrite_home boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NULLIF(trim(p_token), '') IS NULL THEN
    RAISE EXCEPTION 'Missing invite token';
  END IF;

  -- Allow self membership INSERT as invite role (incl. Permit Clerk) under PE trigger.
  PERFORM set_config('truckeros.team_invite_accept', '1', true);

  SELECT * INTO v_pending
  FROM team_invites
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

  IF v_pending.expires_at <= now() OR v_pending.status = 'expired' THEN
    RAISE EXCEPTION 'This invite has expired';
  END IF;

  IF v_pending.role = 'Owner' THEN
    RAISE EXCEPTION 'Owner role cannot be assigned via invite';
  END IF;

  IF v_pending.role NOT IN ('Admin', 'Driver', 'Permit Clerk', 'Viewer') THEN
    RAISE EXCEPTION 'Invalid invite role';
  END IF;

  IF NULLIF(trim(v_pending.invite_email), '') IS NOT NULL THEN
    IF v_email = '' OR lower(trim(v_pending.invite_email)) <> v_email THEN
      RAISE EXCEPTION 'Sign in with the email address that received this invite';
    END IF;
  END IF;

  UPDATE team_invites
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

  v_roles := ARRAY[v_invite.role]::text[];

  INSERT INTO organization_memberships (
    organization_id,
    user_id,
    role,
    is_primary_owner,
    permissions
  )
  VALUES (
    v_invite.organization_id,
    v_uid,
    v_invite.role,
    false,
    '{"mode":"global"}'::jsonb
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE SET
    role = CASE
      WHEN organization_memberships.is_primary_owner THEN organization_memberships.role
      ELSE EXCLUDED.role
    END,
    is_primary_owner = organization_memberships.is_primary_owner,
    permissions = COALESCE(organization_memberships.permissions, EXCLUDED.permissions);

  SELECT organization_id, is_primary_owner
  INTO v_existing_org, v_existing_primary
  FROM member_profiles
  WHERE user_id = v_uid
  LIMIT 1;

  v_rewrite_home :=
    (v_existing_org IS NULL)
    OR (
      v_existing_org = v_invite.organization_id
      AND NOT COALESCE(v_existing_primary, false)
    );

  IF v_rewrite_home THEN
    INSERT INTO member_profiles (user_id, organization_id, is_primary_owner, user_roles)
    VALUES (v_uid, v_invite.organization_id, false, v_roles)
    ON CONFLICT (user_id) DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      is_primary_owner = member_profiles.is_primary_owner,
      user_roles = CASE
        WHEN member_profiles.is_primary_owner THEN member_profiles.user_roles
        ELSE EXCLUDED.user_roles
      END;
  END IF;

  IF v_email <> '' THEN
    UPDATE team_member_profiles
    SET linked_user_id = v_uid
    WHERE organization_id = v_invite.organization_id
      AND lower(trim(driver_email)) = v_email
      AND linked_user_id IS NULL;
  END IF;

  RETURN to_jsonb(v_invite);
END;
$$;

COMMENT ON FUNCTION accept_team_invite(text) IS
'Claim-first invite accept; sets truckeros.team_invite_accept GUC so self Clerk membership INSERT is allowed under Phase 1 PE trigger.';

GRANT EXECUTE ON FUNCTION accept_team_invite(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
