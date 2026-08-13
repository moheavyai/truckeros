-- 044_fix_org_memberships_bootstrap_rls_recursion.sql
--
-- Fixes: infinite recursion detected in policy for relation "organization_memberships"
-- Root cause: migration 032 INSERT policy queried organization_memberships directly
-- inside a policy on the same table (NOT EXISTS primary-owner check).
--
-- Fix: move the existence check into a SECURITY DEFINER helper that bypasses RLS,
-- then rewrite the policy to call the helper.
--
-- Idempotent: CREATE OR REPLACE + DROP POLICY IF EXISTS.

-- ---------------------------------------------------------------------------
-- Helper: does this org already have a primary owner?
-- Runs as the function owner → bypasses RLS on organization_memberships.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.org_has_primary_owner(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships
    WHERE organization_id = p_organization_id
      AND is_primary_owner = true
  );
$$;

COMMENT ON FUNCTION public.org_has_primary_owner(uuid) IS
'Returns true if the organization already has a primary-owner membership row. SECURITY DEFINER so it can be called from RLS policies without recursion.';

-- Lock down: only authenticated (and service role via owner) should call this.
REVOKE ALL ON FUNCTION public.org_has_primary_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_has_primary_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_has_primary_owner(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Rewrite the bootstrap INSERT policy to use the helper
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Org creators can insert primary owner membership" ON public.organization_memberships;

CREATE POLICY "Org creators can insert primary owner membership"
ON public.organization_memberships
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND is_primary_owner = true
  AND EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = organization_id
      AND o.created_by_user_id = auth.uid()
  )
  AND NOT public.org_has_primary_owner(organization_id)
);

NOTIFY pgrst, 'reload schema';
