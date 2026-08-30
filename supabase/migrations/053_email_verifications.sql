-- User-level inbox proof. Lives off auth.users so it works before member_profiles exists.

CREATE TABLE IF NOT EXISTS public.email_verifications (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL,
  verified_at timestamptz,
  token_hash text,
  token_expires_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_token_hash
  ON public.email_verifications (token_hash)
  WHERE token_hash IS NOT NULL;

ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_verifications_select_own
  ON public.email_verifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY email_verifications_insert_own
  ON public.email_verifications
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY email_verifications_update_own
  ON public.email_verifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Token click may open in another browser (no session). Hash-only consume, no SELECT of secrets.
CREATE OR REPLACE FUNCTION public.consume_email_verification_token(p_token_hash text)
RETURNS TABLE (ok boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  IF p_token_hash IS NULL OR length(trim(p_token_hash)) = 0 THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  UPDATE public.email_verifications
  SET
    verified_at = now(),
    token_hash = NULL,
    token_expires_at = NULL,
    updated_at = now()
  WHERE token_hash = p_token_hash
    AND token_expires_at > now()
    AND verified_at IS NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN QUERY SELECT updated_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_email_verification_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_email_verification_token(text) TO anon, authenticated;

-- Grandfather everyone who already has a profile. New signups stay unverified.
INSERT INTO public.email_verifications (user_id, email, verified_at)
SELECT
  mp.user_id,
  COALESCE(
    NULLIF(trim(au.email), ''),
    NULLIF(trim(mp.driver_email), ''),
    NULLIF(trim(mp.carrier_email), ''),
    'unknown@invalid'
  ),
  now()
FROM public.member_profiles mp
LEFT JOIN auth.users au ON au.id = mp.user_id
ON CONFLICT (user_id) DO NOTHING;

COMMENT ON TABLE public.email_verifications IS
  'MoHeavy inbox proof for Portal Assist. verified_at set when the user clicks the confirmation link.';

NOTIFY pgrst, 'reload schema';
