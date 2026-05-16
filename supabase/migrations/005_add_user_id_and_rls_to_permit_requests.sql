-- supabase/migrations/005_add_user_id_and_rls_to_permit_requests.sql
--
-- Ensures the permit_requests table has a user_id column and proper Row Level Security.
-- This allows users to only access their own permit request history.
--
-- Run this migration to make data ownership and security explicit and reproducible.

-- 1. Add user_id column if it doesn't exist
ALTER TABLE permit_requests
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add index for performance on user lookups
CREATE INDEX IF NOT EXISTS idx_permit_requests_user_id 
ON permit_requests(user_id);

-- 2. Enable Row Level Security
ALTER TABLE permit_requests ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing policies if they exist (to make this migration re-runnable)
DROP POLICY IF EXISTS "Users can view their own permit requests" ON permit_requests;
DROP POLICY IF EXISTS "Users can insert their own permit requests" ON permit_requests;
DROP POLICY IF EXISTS "Users can update their own permit requests" ON permit_requests;
DROP POLICY IF EXISTS "Users can delete their own permit requests" ON permit_requests;

-- 4. Create RLS Policies

-- Users can only SELECT their own rows
CREATE POLICY "Users can view their own permit requests"
ON permit_requests
FOR SELECT
USING (auth.uid() = user_id);

-- Users can only INSERT rows where user_id matches their auth user
CREATE POLICY "Users can insert their own permit requests"
ON permit_requests
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can only UPDATE their own rows
CREATE POLICY "Users can update their own permit requests"
ON permit_requests
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Users can only DELETE their own rows
CREATE POLICY "Users can delete their own permit requests"
ON permit_requests
FOR DELETE
USING (auth.uid() = user_id);

-- Optional: Allow service role (for admin tools / background jobs) to bypass RLS
-- This is already the default behavior for service_role key.

COMMENT ON COLUMN permit_requests.user_id IS 
'User who owns this permit request. Enforced via RLS policies.';

COMMENT ON TABLE permit_requests IS 
'Stores user-submitted permit analysis results. Secured with Row Level Security so users can only access their own data.';