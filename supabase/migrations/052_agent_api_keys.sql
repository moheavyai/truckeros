-- 052_agent_api_keys.sql
--
-- Foundation for external Agent / Grok-bot access.
--
-- Adds:
--   • api_keys          – org-scoped API keys (hashed)
--   • agent_api_usage   – minimal usage log for metering + audit
--
-- Design notes:
--   - Keys are never stored in plaintext. Application generates the key,
--     stores only prefix + hash. Verification happens in Node.
--   - Scopes start narrow: 'analyze_permit'. More tools can be added later.
--   - RLS: only Owner / Admin of the organization can manage keys.
--   - Fully additive. No existing tables or policies are changed.
--
-- Apply after 051. Next number if needed: 053.

-- ---------------------------------------------------------------------------
-- api_keys
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Human-readable label (e.g. "Grok Bot – Midwest Fleet")
  name text NOT NULL,

  -- First characters of the key for identification in UI / logs (e.g. "mh_live_a1b2")
  key_prefix text NOT NULL,

  -- SHA-256 hash of the full key (hex). Never store the raw key.
  key_hash text NOT NULL,

  -- Allowed tool scopes. Start narrow.
  scopes text[] NOT NULL DEFAULT ARRAY['analyze_permit']::text[],

  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_used_at timestamptz,
  expires_at timestamptz,          -- NULL = no expiry
  revoked_at timestamptz,          -- NULL = active

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT api_keys_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT api_keys_prefix_not_blank CHECK (btrim(key_prefix) <> ''),
  CONSTRAINT api_keys_hash_not_blank CHECK (btrim(key_hash) <> '')
);

-- Fast lookup by prefix (the common path for auth)
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key_prefix
  ON public.api_keys (key_prefix);

-- Defense in depth: full hash must also be unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key_hash
  ON public.api_keys (key_hash);

CREATE INDEX IF NOT EXISTS idx_api_keys_organization_id
  ON public.api_keys (organization_id);

CREATE INDEX IF NOT EXISTS idx_api_keys_active
  ON public.api_keys (organization_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.api_keys IS
  'Org-scoped API keys for external agents (Grok bots, partners). Raw key is never stored; only prefix + hash.';

COMMENT ON COLUMN public.api_keys.scopes IS
  'Allowed tool names. Current values: analyze_permit. Expand as new tools are added.';

-- ---------------------------------------------------------------------------
-- agent_api_usage (minimal audit / metering)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,

  tool text NOT NULL,                 -- e.g. 'analyze_permit'
  status_code int,
  latency_ms int,
  request_id text,                    -- optional correlation id from client

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_api_usage_org_created
  ON public.agent_api_usage (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_api_usage_key_created
  ON public.agent_api_usage (api_key_id, created_at DESC)
  WHERE api_key_id IS NOT NULL;

COMMENT ON TABLE public.agent_api_usage IS
  'Lightweight usage log for agent API calls. Used for metering, rate limits, and audit.';

-- ---------------------------------------------------------------------------
-- RLS: api_keys
-- ---------------------------------------------------------------------------

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Members of the org can see keys that belong to their organizations
DROP POLICY IF EXISTS "Members can view org api keys" ON public.api_keys;
CREATE POLICY "Members can view org api keys"
ON public.api_keys
FOR SELECT
USING (
  organization_id IN (SELECT public.auth_user_membership_org_ids())
);

-- Only Owner or Admin can create keys
DROP POLICY IF EXISTS "Owners and Admins can insert api keys" ON public.api_keys;
CREATE POLICY "Owners and Admins can insert api keys"
ON public.api_keys
FOR INSERT
WITH CHECK (
  organization_id IN (
    SELECT organization_id
    FROM public.organization_memberships
    WHERE user_id = auth.uid()
      AND role IN ('Owner', 'Admin')
  )
);

-- Only Owner or Admin can update (revoke, rename, change scopes, etc.)
DROP POLICY IF EXISTS "Owners and Admins can update api keys" ON public.api_keys;
CREATE POLICY "Owners and Admins can update api keys"
ON public.api_keys
FOR UPDATE
USING (
  organization_id IN (
    SELECT organization_id
    FROM public.organization_memberships
    WHERE user_id = auth.uid()
      AND role IN ('Owner', 'Admin')
  )
)
WITH CHECK (
  organization_id IN (
    SELECT organization_id
    FROM public.organization_memberships
    WHERE user_id = auth.uid()
      AND role IN ('Owner', 'Admin')
  )
);

-- Only Owner or Admin can delete
DROP POLICY IF EXISTS "Owners and Admins can delete api keys" ON public.api_keys;
CREATE POLICY "Owners and Admins can delete api keys"
ON public.api_keys
FOR DELETE
USING (
  organization_id IN (
    SELECT organization_id
    FROM public.organization_memberships
    WHERE user_id = auth.uid()
      AND role IN ('Owner', 'Admin')
  )
);

-- ---------------------------------------------------------------------------
-- RLS: agent_api_usage
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_api_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view org agent usage" ON public.agent_api_usage;
CREATE POLICY "Members can view org agent usage"
ON public.agent_api_usage
FOR SELECT
USING (
  organization_id IN (SELECT public.auth_user_membership_org_ids())
);

-- Inserts are performed by the service role / server code (bypasses RLS).
-- No INSERT policy for authenticated users is required for the first slice.

-- ---------------------------------------------------------------------------
-- updated_at trigger (simple)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_api_keys_updated_at ON public.api_keys;
CREATE TRIGGER trg_api_keys_updated_at
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

NOTIFY pgrst, 'reload schema';
