-- Phase 1b: restore membership-based SELECT on four tables, then narrow
-- auth_user_service_mode_org_ids() to Permit Clerk only.
--
-- Order is mandatory (see docs/plans/user-accounts-roles-flows.md §5.5):
--   1) Restore membership SELECT paths (profiles/roster any membership;
--      equipment/rigs role-filtered Owner/Admin/Permit Clerk)
--   2) Then narrow SM helper so Owner/Admin no longer get foreign-org access
--      via the service-mode helper alone.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE OR REPLACE FUNCTION.

-- ---------------------------------------------------------------------------
-- Equipment/rig membership helper (role-constrained — not Driver/Viewer)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth_user_equipment_membership_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM organization_memberships
  WHERE user_id = auth.uid()
    AND role IN ('Owner', 'Admin', 'Permit Clerk');
$$;

COMMENT ON FUNCTION auth_user_equipment_membership_org_ids() IS
'Organization ids where the current user has Owner, Admin, or Permit Clerk membership — used for org-scoped equipment/rig SELECT independent of Service Mode.';

-- ---------------------------------------------------------------------------
-- (c) member_profiles — restore any-membership multi-org SELECT + SM OR
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Org members can view profiles in their organization" ON member_profiles;

CREATE POLICY "Org members can view profiles in their organization"
ON member_profiles
FOR SELECT
USING (
  auth.uid() = user_id
  OR (
    organization_id IS NOT NULL
    AND organization_id = auth_user_organization_id()
  )
  OR (
    organization_id IS NOT NULL
    AND organization_id IN (SELECT auth_user_membership_org_ids())
  )
  OR (
    organization_id IS NOT NULL
    AND organization_id IN (SELECT auth_user_service_mode_org_ids())
  )
);

-- ---------------------------------------------------------------------------
-- (d) team_member_profiles — restore any-membership multi-org SELECT + SM OR
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Org members can view team roster in their organization" ON team_member_profiles;

CREATE POLICY "Org members can view team roster in their organization"
ON team_member_profiles
FOR SELECT
USING (
  organization_id IS NOT NULL
  AND (
    organization_id = auth_user_organization_id()
    OR organization_id IN (SELECT auth_user_membership_org_ids())
    OR organization_id IN (SELECT auth_user_service_mode_org_ids())
  )
);

-- ---------------------------------------------------------------------------
-- (a) equipment_profiles — membership Owner/Admin/Clerk path + SM helper
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Members can view org equipment profiles" ON equipment_profiles;

CREATE POLICY "Members can view org equipment profiles"
ON equipment_profiles
FOR SELECT
USING (
  organization_id IS NOT NULL
  AND (
    organization_id IN (SELECT auth_user_equipment_membership_org_ids())
    OR organization_id IN (SELECT auth_user_service_mode_org_ids())
  )
);

-- ---------------------------------------------------------------------------
-- (b) rig_configurations — primary-owner rigs for equipment-capable members + SM
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Members can view carrier primary owner rig configs" ON rig_configurations;

CREATE POLICY "Members can view carrier primary owner rig configs"
ON rig_configurations
FOR SELECT
USING (
  user_id IN (
    SELECT mp.user_id
    FROM member_profiles mp
    WHERE mp.is_primary_owner = true
      AND (
        mp.organization_id IN (SELECT auth_user_equipment_membership_org_ids())
        OR mp.organization_id IN (SELECT auth_user_service_mode_org_ids())
      )
  )
);

-- ---------------------------------------------------------------------------
-- (e) AFTER (a)–(d): narrow Service Mode helper to Permit Clerk only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth_user_service_mode_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM organization_memberships
  WHERE user_id = auth.uid()
    AND role = 'Permit Clerk';
$$;

COMMENT ON FUNCTION auth_user_service_mode_org_ids() IS
'Organization ids the current user may scope in Service Mode (Permit Clerk memberships only; Phase 1b). Phase 3 will require service_seat as well.';

NOTIFY pgrst, 'reload schema';
