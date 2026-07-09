-- Invite accept: preserve multi-org home profiles; never demote primary owners;
-- claim-first; narrow membership-based trigger allowances (no session GUC bypass);
-- link roster by email.

-- ---------------------------------------------------------------------------
-- Privileged columns: allow org assignment when membership already exists
-- (invite accept inserts membership first, then profile). No GUC bypass.
-- ---------------------------------------------------------------------------

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

    -- Invite accept path: membership row already exists for this org (non-primary).
    IF COALESCE(NEW.is_primary_owner, false) = false
       AND EXISTS (
         SELECT 1
         FROM organization_memberships om
         WHERE om.user_id = NEW.user_id
           AND om.organization_id = NEW.organization_id
       ) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Cannot set organization_id without primary owner bootstrap';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.organization_id IS NULL AND NEW.organization_id IS NOT NULL THEN
      IF NEW.is_primary_owner = true AND NOT member_profile_org_already_exists(NEW.organization_id) THEN
        RETURN NEW;
      END IF;
      -- Invite accept: allow attaching home org when membership already exists.
      IF COALESCE(NEW.is_primary_owner, false) = false
         AND EXISTS (
           SELECT 1
           FROM organization_memberships om
           WHERE om.user_id = NEW.user_id
             AND om.organization_id = NEW.organization_id
         ) THEN
        -- fall through to is_primary_owner immutability checks below
        NULL;
      ELSE
        RAISE EXCEPTION 'Organization bootstrap requires a new organization_id and is_primary_owner';
      END IF;
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

-- ---------------------------------------------------------------------------
-- Self-service field guard: allow user_roles update only when it exactly
-- matches the membership role for this org (invite re-accept sync).
-- ---------------------------------------------------------------------------

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
      -- Invite accept may sync roles to the single membership role only.
      IF EXISTS (
        SELECT 1
        FROM organization_memberships om
        WHERE om.user_id = NEW.user_id
          AND om.organization_id = COALESCE(NEW.organization_id, OLD.organization_id)
          AND NEW.user_roles = ARRAY[om.role]::text[]
      ) THEN
        NULL; -- keep NEW.user_roles
      ELSE
        NEW.user_roles := OLD.user_roles;
      END IF;
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

-- ---------------------------------------------------------------------------
-- accept_team_invite: claim-first, membership preserve primary, conditional home rewrite
-- ---------------------------------------------------------------------------

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

  -- Claim first (atomic): only one acceptor wins for pending invites.
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

  -- Membership upsert: never demote primary owner; preserve custom permissions.
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

  -- Rewrite home only when unset, or same org and not already primary owner.
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

  -- Link matching roster row by invite email when still unlinked.
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
'Claim-first invite accept: membership always (preserve primary owner + permissions); home profile rewrite when unset/same non-primary org; roster email link. Triggers use membership-based allowances (no session GUC).';

GRANT EXECUTE ON FUNCTION accept_team_invite(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
