-- supabase/migrations/001_create_state_permit_rules.sql
--
-- Phase I: State Permit Rules table
-- This table drives the data-driven permit flagging logic in the Permit Agent.
-- The agent queries this table for every state in the computed corridor.

CREATE TABLE IF NOT EXISTS state_permit_rules (
  state_code CHAR(2) PRIMARY KEY,
  state_name TEXT NOT NULL,

  -- Legal (non-permit) limits
  legal_width_ft        NUMERIC(4,2) NOT NULL DEFAULT 8.50,
  legal_height_ft       NUMERIC(4,2) NOT NULL DEFAULT 13.50,
  legal_length_ft       NUMERIC(5,2) NOT NULL DEFAULT 53.00,
  legal_weight_lbs      INTEGER      NOT NULL DEFAULT 80000,

  -- Threshold at which a permit is required (NULL = use legal_* value)
  -- This allows states that tolerate a small amount over legal before requiring a permit.
  permit_threshold_width_ft    NUMERIC(4,2),
  permit_threshold_height_ft   NUMERIC(4,2),
  permit_threshold_length_ft   NUMERIC(5,2),
  permit_threshold_weight_lbs  INTEGER,

  -- Human-readable notes for operators / future UI
  notes TEXT,

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Helpful index for the agent's .in('state_code', [...]) queries
CREATE INDEX IF NOT EXISTS idx_state_permit_rules_state_code
  ON state_permit_rules (state_code);

-- Optional: Row Level Security (enable later when you have service role usage)
-- ALTER TABLE state_permit_rules ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE state_permit_rules IS 
  'Per-state legal limits and permit thresholds for OS/OW loads. Used by the Permit Agent to decide which states require permits.';

COMMENT ON COLUMN state_permit_rules.permit_threshold_width_ft IS 
  'If load width exceeds this value, a permit is required for this state. Falls back to legal_width_ft when NULL.';
