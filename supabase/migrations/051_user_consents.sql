-- Phase A/B legal: versioned Terms + Privacy acceptance per auth user.
-- Additive only; existing users remain NULL until they re-accept or we backfill.

CREATE TABLE IF NOT EXISTS public.user_consents (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  terms_version text NOT NULL,
  terms_accepted_at timestamptz NOT NULL,
  privacy_version text NOT NULL,
  privacy_accepted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_consents IS
  'Records acceptance of MoHeavy AI Terms of Service and Privacy Policy (versioned).';

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

-- Users can read and upsert only their own consent row.
CREATE POLICY user_consents_select_own
  ON public.user_consents
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY user_consents_insert_own
  ON public.user_consents
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_consents_update_own
  ON public.user_consents
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Keep updated_at fresh on change.
CREATE OR REPLACE FUNCTION public.set_user_consents_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_consents_updated_at ON public.user_consents;
CREATE TRIGGER trg_user_consents_updated_at
  BEFORE UPDATE ON public.user_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.set_user_consents_updated_at();
