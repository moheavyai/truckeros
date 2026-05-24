-- supabase/migrations/008_portal_submissions.sql
--
-- Adds persistence for Agent-Assisted Portal Submissions (Week 2 priority gap).
-- Stores the full record of what was sent to each state portal and what came back.

CREATE TABLE IF NOT EXISTS portal_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_request_id uuid NOT NULL REFERENCES permit_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  state_code text NOT NULL CHECK (char_length(state_code) = 2),
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN (
    'initiated', 'prefilled', 'submitted', 'approved', 'rejected', 'needs_correction'
  )),

  our_recommended_corridor jsonb,
  portal_returned_corridor jsonb,
  route_comparison jsonb,

  permit_number text,
  portal_fees numeric(10,2),
  portal_restrictions jsonb DEFAULT '[]'::jsonb,

  user_notes text,
  human_approved boolean DEFAULT false,

  pdf_reference text,                    -- link or filename to final permit PDF (future)
  raw_portal_output text,                -- full text pasted from portal for audit

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE (permit_request_id, state_code)  -- one primary record per request+state (can relax later)
);

-- Enable RLS
ALTER TABLE portal_submissions ENABLE ROW LEVEL SECURITY;

-- Policies: users can only see/manage submissions tied to their permit requests
DROP POLICY IF EXISTS "Users can manage their own portal submissions" ON portal_submissions;

CREATE POLICY "Users can manage their own portal submissions"
ON portal_submissions
FOR ALL
USING (
  user_id = auth.uid() 
  OR 
  EXISTS (
    SELECT 1 FROM permit_requests pr 
    WHERE pr.id = portal_submissions.permit_request_id 
      AND pr.user_id = auth.uid()
  )
)
WITH CHECK (
  user_id = auth.uid() 
  OR 
  EXISTS (
    SELECT 1 FROM permit_requests pr 
    WHERE pr.id = portal_submissions.permit_request_id 
      AND pr.user_id = auth.uid()
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_portal_submissions_permit_request_id ON portal_submissions(permit_request_id);
CREATE INDEX IF NOT EXISTS idx_portal_submissions_user_id ON portal_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_portal_submissions_state_code ON portal_submissions(state_code);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_portal_submissions_updated_at ON portal_submissions;
CREATE TRIGGER update_portal_submissions_updated_at
  BEFORE UPDATE ON portal_submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE portal_submissions IS 'Stores the full history of assisted submissions to state OSOW portals, including prefill data, portal responses, and human approval decisions.';
COMMENT ON COLUMN portal_submissions.pdf_reference IS 'Reference to the final approved permit PDF (URL, storage path, or document ID).';