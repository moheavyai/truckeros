-- Carrier connection invites: Permit Clerk / Owner / Admin invite a Carrier Owner
-- (or Owner Operator) to accept a clerk↔carrier relationship.
--
-- Idempotent apply path: scripts/apply-migration-035.mjs, admin migrate 035 fallback,
-- and apply-migrations.mjs when the table is missing after a partial full migrate.
--
-- On create (service role): organization shell is pre-created; inviter gets Permit Clerk membership.
-- On accept: acceptor becomes primary Owner after defense-in-depth checks (inviter membership,
-- no other primary, email binding).

-- ---------------------------------------------------------------------------
-- Unique USDOT (non-empty) to prevent concurrent duplicate carriers.
-- Non-fatal: duplicate existing usdot values must not block table/RPC create
-- during force-apply (035 recovery). Logs WARNING and continues.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_usdot_number_unique
    ON organizations (usdot_number)
    WHERE usdot_number IS NOT NULL AND NULLIF(trim(usdot_number), '') IS NOT NULL;
EXCEPTION
  WHEN unique_violation THEN
    RAISE WARNING
      'idx_organizations_usdot_number_unique not created: duplicate non-empty usdot_number values exist on organizations';
  WHEN OTHERS THEN
    RAISE WARNING 'idx_organizations_usdot_number_unique not created: %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- carrier_connection_invites
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS carrier_connection_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invited_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  company_name text NOT NULL,
  usdot_number text,
  mc_number text,
  ein text,
  carrier_address text,
  carrier_phone text,
  carrier_email text,
  insurance_contact text,
  invite_contact_name text,
  -- Email is required for Owner-granting invites (token alone is insufficient).
  invite_email text NOT NULL,
  invite_phone text,
  invite_token text NOT NULL UNIQUE,
  invite_link text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  accepted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  message text,
  created_at timestamptz DEFAULT now(),
  CHECK (NULLIF(trim(invite_email), '') IS NOT NULL),
  CHECK (NULLIF(trim(company_name), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_carrier_connection_invites_invited_by
  ON carrier_connection_invites(invited_by_user_id);

CREATE INDEX IF NOT EXISTS idx_carrier_connection_invites_token
  ON carrier_connection_invites(invite_token);

CREATE INDEX IF NOT EXISTS idx_carrier_connection_invites_status
  ON carrier_connection_invites(status);

CREATE INDEX IF NOT EXISTS idx_carrier_connection_invites_organization_id
  ON carrier_connection_invites(organization_id);

ALTER TABLE carrier_connection_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Inviters can view own carrier connection invites"
  ON carrier_connection_invites;
DROP POLICY IF EXISTS "Inviters can insert carrier connection invites"
  ON carrier_connection_invites;
DROP POLICY IF EXISTS "Inviters can update own pending carrier connection invites"
  ON carrier_connection_invites;

-- Eligible inviter membership on the invite's organization (Owner/Admin/Permit Clerk/primary).
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
      AND (
        om.is_primary_owner = true
        OR om.role IN ('Owner', 'Admin', 'Permit Clerk')
      )
  );
$$;

-- Inviter can list their own invites (pending + historical).
CREATE POLICY "Inviters can view own carrier connection invites"
ON carrier_connection_invites
FOR SELECT
USING (invited_by_user_id = auth.uid());

-- Client INSERT requires inviter identity AND eligible membership on organization_id.
-- Primary write path uses service role (bypasses RLS); this gates any client inserts.
CREATE POLICY "Inviters can insert carrier connection invites"
ON carrier_connection_invites
FOR INSERT
WITH CHECK (
  invited_by_user_id = auth.uid()
  AND organization_id IS NOT NULL
  AND auth_user_can_manage_carrier_connection(organization_id)
);

-- Client UPDATE only for inviter's pending rows where they still manage the org.
-- Column protection trigger further limits mutable fields to status/audit only.
CREATE POLICY "Inviters can update own pending carrier connection invites"
ON carrier_connection_invites
FOR UPDATE
USING (
  invited_by_user_id = auth.uid()
  AND status = 'pending'
  AND (
    organization_id IS NULL
    OR auth_user_can_manage_carrier_connection(organization_id)
  )
)
WITH CHECK (
  invited_by_user_id = auth.uid()
  AND (
    organization_id IS NULL
    OR auth_user_can_manage_carrier_connection(organization_id)
  )
);

-- Prevent client rebinding of org/token/email and other privileged columns.
-- Clients may only move pending → revoked|expired (not accepted / burn-as-accepted).
-- Accept RPC sets transaction-local GUC truckeros.carrier_invite_accept=1 so claim
-- updates (pending→accepted + accepted_*) succeed while JWT auth.uid() is still set.
CREATE OR REPLACE FUNCTION protect_carrier_connection_invite_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role writers (auth.uid() null) may update freely.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Accept path: accept_carrier_connection_invite sets this GUC with is_local=true
  -- before claim. Clients without the GUC cannot mark invites accepted.
  IF coalesce(current_setting('truckeros.carrier_invite_accept', true), '') = '1' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.invite_token IS DISTINCT FROM OLD.invite_token
       OR NEW.invite_link IS DISTINCT FROM OLD.invite_link
       OR NEW.invited_by_user_id IS DISTINCT FROM OLD.invited_by_user_id
       OR NEW.invite_email IS DISTINCT FROM OLD.invite_email
       OR NEW.company_name IS DISTINCT FROM OLD.company_name
       OR NEW.usdot_number IS DISTINCT FROM OLD.usdot_number
       OR NEW.mc_number IS DISTINCT FROM OLD.mc_number
       OR NEW.ein IS DISTINCT FROM OLD.ein
       OR NEW.carrier_address IS DISTINCT FROM OLD.carrier_address
       OR NEW.carrier_phone IS DISTINCT FROM OLD.carrier_phone
       OR NEW.carrier_email IS DISTINCT FROM OLD.carrier_email
       OR NEW.insurance_contact IS DISTINCT FROM OLD.insurance_contact
       OR NEW.invite_contact_name IS DISTINCT FROM OLD.invite_contact_name
       OR NEW.invite_phone IS DISTINCT FROM OLD.invite_phone
       OR NEW.message IS DISTINCT FROM OLD.message
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Cannot modify protected carrier connection invite fields';
    END IF;

    -- Block clients from marking accepted or setting accept audit fields.
    IF NEW.accepted_by_user_id IS DISTINCT FROM OLD.accepted_by_user_id
       OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
    THEN
      RAISE EXCEPTION 'Cannot set accept fields on carrier connection invites';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
        OLD.status = 'pending'
        AND NEW.status IN ('revoked', 'expired')
      ) THEN
        RAISE EXCEPTION 'Clients may only revoke or expire pending carrier connection invites';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_carrier_connection_invite_columns
  ON carrier_connection_invites;
CREATE TRIGGER trg_protect_carrier_connection_invite_columns
  BEFORE UPDATE ON carrier_connection_invites
  FOR EACH ROW
  EXECUTE FUNCTION protect_carrier_connection_invite_columns();

COMMENT ON TABLE carrier_connection_invites IS
'Service-mode Add Carrier invites. Email-bound connection invites; create/accept via service role or constrained RLS. Accept grants primary Owner only when inviter membership is valid and no other primary exists.';

-- ---------------------------------------------------------------------------
-- Privileged columns: allow primary-owner home assignment when membership
-- already marks the user as primary owner of that org (carrier connection accept).
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

    -- Carrier connection / invite accept: membership already marks user primary owner.
    IF NEW.is_primary_owner = true
       AND EXISTS (
         SELECT 1
         FROM organization_memberships om
         WHERE om.user_id = NEW.user_id
           AND om.organization_id = NEW.organization_id
           AND om.is_primary_owner = true
       ) THEN
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
      -- Carrier connection accept: primary owner membership already present.
      IF NEW.is_primary_owner = true
         AND EXISTS (
           SELECT 1
           FROM organization_memberships om
           WHERE om.user_id = NEW.user_id
             AND om.organization_id = NEW.organization_id
             AND om.is_primary_owner = true
         ) THEN
        NULL;
      -- Invite accept: allow attaching home org when membership already exists.
      ELSIF COALESCE(NEW.is_primary_owner, false) = false
         AND EXISTS (
           SELECT 1
           FROM organization_memberships om
           WHERE om.user_id = NEW.user_id
             AND om.organization_id = NEW.organization_id
         ) THEN
        NULL;
      ELSE
        RAISE EXCEPTION 'Organization bootstrap requires a new organization_id and is_primary_owner';
      END IF;
    END IF;

    IF OLD.organization_id IS NOT NULL AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'Cannot change organization_id on self-update';
    END IF;

    IF OLD.is_primary_owner IS DISTINCT FROM NEW.is_primary_owner THEN
      -- Allow promoting to primary owner when membership already says so.
      IF NEW.is_primary_owner = true
         AND COALESCE(OLD.is_primary_owner, false) = false
         AND EXISTS (
           SELECT 1
           FROM organization_memberships om
           WHERE om.user_id = NEW.user_id
             AND om.organization_id = COALESCE(NEW.organization_id, OLD.organization_id)
             AND om.is_primary_owner = true
         ) THEN
        NULL;
      ELSE
        RAISE EXCEPTION 'Cannot change is_primary_owner on self-update';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Accept RPC: claim invite, defense-in-depth, grant Owner, rewrite home when needed
-- ---------------------------------------------------------------------------

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
  -- is_local=true scopes to this transaction only.
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

  -- Email is always required for Owner-granting connection invites.
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

  -- Defense-in-depth: inviter must still hold eligible membership on the shell org.
  IF NOT EXISTS (
    SELECT 1
    FROM organization_memberships om
    WHERE om.user_id = v_pending.invited_by_user_id
      AND om.organization_id = v_org_id
      AND (
        om.is_primary_owner = true
        OR om.role IN ('Owner', 'Admin', 'Permit Clerk')
      )
  ) THEN
    RAISE EXCEPTION 'Invite not found or no longer valid';
  END IF;

  -- Do not steal primary ownership if another primary already exists.
  SELECT user_id INTO v_other_primary
  FROM organization_memberships
  WHERE organization_id = v_org_id
    AND is_primary_owner = true
    AND user_id IS DISTINCT FROM v_uid
  LIMIT 1;

  IF v_other_primary IS NOT NULL THEN
    RAISE EXCEPTION 'This carrier already has a primary owner';
  END IF;

  -- Claim first (atomic)
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

  -- Acceptor becomes primary Owner of the carrier org (preserve if already primary).
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

  -- Rewrite home when no home org, or same org and not primary (should not demote elsewhere).
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

REVOKE ALL ON FUNCTION accept_carrier_connection_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_carrier_connection_invite(text) TO authenticated;

-- Preview: returns non-sensitive invite details when pending + unexpired + email matches.
-- Does not expose invite_token.
CREATE OR REPLACE FUNCTION preview_carrier_connection_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_invite carrier_connection_invites%ROWTYPE;
  v_invite_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NULLIF(trim(p_token), '') IS NULL THEN
    RAISE EXCEPTION 'Missing invite token';
  END IF;

  SELECT * INTO v_invite
  FROM carrier_connection_invites
  WHERE invite_token = trim(p_token)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_invite.status <> 'pending' OR v_invite.expires_at <= now() THEN
    RETURN NULL;
  END IF;

  v_invite_email := lower(trim(coalesce(v_invite.invite_email, '')));
  IF v_invite_email = '' OR v_email = '' OR v_email <> v_invite_email THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_invite.id,
    'company_name', v_invite.company_name,
    'usdot_number', v_invite.usdot_number,
    'invite_email', v_invite.invite_email,
    'invite_contact_name', v_invite.invite_contact_name,
    'organization_id', v_invite.organization_id,
    'expires_at', v_invite.expires_at,
    'status', v_invite.status
  );
END;
$$;

REVOKE ALL ON FUNCTION preview_carrier_connection_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_carrier_connection_invite(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
