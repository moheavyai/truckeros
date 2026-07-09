-- supabase/migrations/018_member_profiles.sql
--
-- Member Profiles: carrier + driver information and user roles per account.
-- One row per user (user_id unique). Secured with RLS.

CREATE TABLE IF NOT EXISTS member_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Carrier Information
  company_name text,
  usdot_number text,
  mc_number text,
  ein text,
  carrier_address text,
  carrier_phone text,
  carrier_email text,
  insurance_contact text,

  -- Driver / User Information
  driver_full_name text,
  cdl_number text,
  cdl_state text CHECK (cdl_state IS NULL OR cdl_state ~ '^[A-Z]{2}$'),
  date_of_birth date,
  driver_phone text,
  driver_email text,
  emergency_contact text,

  -- User Roles (multi-select; subset of allowed values enforced at DB level)
  user_roles text[] NOT NULL DEFAULT '{}'
    CHECK (
      user_roles <@ ARRAY[
        'Owner / Admin',
        'Dispatcher',
        'Driver',
        'Permit Clerk',
        'Viewer'
      ]::text[]
    ),

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE member_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own member profile" ON member_profiles;
DROP POLICY IF EXISTS "Users can insert their own member profile" ON member_profiles;
DROP POLICY IF EXISTS "Users can update their own member profile" ON member_profiles;

CREATE POLICY "Users can view their own member profile"
ON member_profiles
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own member profile"
ON member_profiles
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own member profile"
ON member_profiles
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_member_profiles_user_id
ON member_profiles(user_id);

DROP TRIGGER IF EXISTS update_member_profiles_updated_at ON member_profiles;
CREATE TRIGGER update_member_profiles_updated_at
  BEFORE UPDATE ON member_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE member_profiles IS
'Stores carrier and driver profile information for each member. One profile per user.';

NOTIFY pgrst, 'reload schema';