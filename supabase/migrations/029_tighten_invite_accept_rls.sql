-- Tighten invite accept RLS: remove broad invitee policies; accept via SECURITY DEFINER RPC only.

-- ---------------------------------------------------------------------------
-- Drop permissive invite accept / invitee read policies from migration 028
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can insert own membership on invite accept" ON organization_memberships;
DROP POLICY IF EXISTS "Invitees can view matching pending invites" ON team_invites;
DROP POLICY IF EXISTS "Invitees can accept matching pending invites" ON team_invites;

-- ---------------------------------------------------------------------------
-- preview_team_invite(token) — token-scoped preview for authenticated users
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION preview_team_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_invite team_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NULLIF(trim(p_token), '') IS NULL THEN
    RAISE EXCEPTION 'Missing invite token';
  END IF;

  SELECT * INTO v_invite
  FROM team_invites
  WHERE invite_token = trim(p_token)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF v_invite.status = 'accepted' THEN
    RAISE EXCEPTION 'This invite has already been accepted';
  END IF;

  IF v_invite.status = 'revoked' THEN
    RAISE EXCEPTION 'This invite has been revoked';
  END IF;

  IF v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'This invite has expired';
  END IF;

  IF NULLIF(trim(v_invite.invite_email), '') IS NOT NULL THEN
    IF v_email = '' OR lower(trim(v_invite.invite_email)) <> v_email THEN
      RAISE EXCEPTION 'Sign in with the email address that received this invite';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_invite.id,
    'role', v_invite.role,
    'invite_email', v_invite.invite_email,
    'organization_id', v_invite.organization_id,
    'expires_at', v_invite.expires_at
  );
END;
$$;

COMMENT ON FUNCTION preview_team_invite(text) IS
'Token-scoped invite preview for the authenticated acceptor. No client-side team_invites SELECT required.';

-- ---------------------------------------------------------------------------
-- accept_team_invite(token) — full accept flow (membership upsert + profile merge)
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
  v_invite team_invites%ROWTYPE;
  v_roles text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NULLIF(trim(p_token), '') IS NULL THEN
    RAISE EXCEPTION 'Missing invite token';
  END IF;

  SELECT * INTO v_invite
  FROM team_invites
  WHERE invite_token = trim(p_token)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF v_invite.status = 'accepted' THEN
    RAISE EXCEPTION 'This invite has already been accepted';
  END IF;

  IF v_invite.status = 'revoked' THEN
    RAISE EXCEPTION 'This invite has been revoked';
  END IF;

  IF v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'This invite has expired';
  END IF;

  IF v_invite.role = 'Owner' THEN
    RAISE EXCEPTION 'Owner role cannot be assigned via invite';
  END IF;

  IF NULLIF(trim(v_invite.invite_email), '') IS NOT NULL THEN
    IF v_email = '' OR lower(trim(v_invite.invite_email)) <> v_email THEN
      RAISE EXCEPTION 'Sign in with the email address that received this invite';
    END IF;
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
    role = EXCLUDED.role,
    is_primary_owner = false;

  INSERT INTO member_profiles (user_id, organization_id, is_primary_owner, user_roles)
  VALUES (v_uid, v_invite.organization_id, false, v_roles)
  ON CONFLICT (user_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    is_primary_owner = false,
    user_roles = EXCLUDED.user_roles;

  UPDATE team_invites
  SET
    status = 'accepted',
    accepted_by_user_id = v_uid,
    accepted_at = now()
  WHERE id = v_invite.id;

  SELECT * INTO v_invite FROM team_invites WHERE id = v_invite.id;

  RETURN to_jsonb(v_invite);
END;
$$;

COMMENT ON FUNCTION accept_team_invite(text) IS
'Accepts a team invite server-side: upserts membership (insert or re-invite update), merges member profile fields, marks invite accepted.';

GRANT EXECUTE ON FUNCTION preview_team_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_team_invite(text) TO authenticated;

NOTIFY pgrst, 'reload schema';