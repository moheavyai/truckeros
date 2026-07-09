-- Allow org creators to insert their own primary-owner membership on first bootstrap.
-- Without this policy, organization_memberships INSERT requires an existing org manager row.

DROP POLICY IF EXISTS "Org creators can insert primary owner membership" ON organization_memberships;

CREATE POLICY "Org creators can insert primary owner membership"
ON organization_memberships
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND is_primary_owner = true
  AND EXISTS (
    SELECT 1
    FROM organizations o
    WHERE o.id = organization_id
      AND o.created_by_user_id = auth.uid()
  )
  AND NOT EXISTS (
    SELECT 1
    FROM organization_memberships om
    WHERE om.organization_id = organization_id
      AND om.is_primary_owner = true
  )
);

NOTIFY pgrst, 'reload schema';