-- supabase/migrations/007_user_portal_credentials.sql
--
-- Week 2 Item 1: Secure credential storage for state OSOW permit portals.
-- This enables the Agent-Assisted Portal Submission feature.
--
-- Security notes:
-- - All rows are protected by RLS (users can only see their own).
-- - Passwords should be encrypted before insertion (see lib/portal-assistant.ts + API route).
-- - In production, prefer Supabase Vault or pgcrypto with a per-user or service key.
-- - Never expose raw credentials to the browser.

CREATE TABLE IF NOT EXISTS user_portal_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state_code text NOT NULL CHECK (length(state_code) = 2),
  username text NOT NULL,
  password_encrypted text NOT NULL,  -- Store encrypted value (AES-256 or pgcrypto)
  portal_url text,
  notes text,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(user_id, state_code)
);

-- Enable RLS
ALTER TABLE user_portal_credentials ENABLE ROW LEVEL SECURITY;

-- Drop policies if re-running
DROP POLICY IF EXISTS "Users can manage their own portal credentials" ON user_portal_credentials;

-- Users can do everything on their own rows
CREATE POLICY "Users can manage their own portal credentials"
ON user_portal_credentials
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Index for fast lookup by user + state
CREATE INDEX IF NOT EXISTS idx_user_portal_credentials_user_state 
ON user_portal_credentials(user_id, state_code);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_user_portal_credentials_updated_at ON user_portal_credentials;
CREATE TRIGGER update_user_portal_credentials_updated_at
  BEFORE UPDATE ON user_portal_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE user_portal_credentials IS 'Stores encrypted credentials for state DOT OSOW permit portals. Used by the Agent-Assisted Portal framework.';
COMMENT ON COLUMN user_portal_credentials.password_encrypted IS 'Encrypted using AES-256-GCM (key from PORTAL_CREDENTIALS_ENCRYPTION_KEY env var). Never store in plain text.';