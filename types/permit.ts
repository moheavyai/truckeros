/**
 * types/permit.ts
 *
 * Phase I shared types for the OSOW Permit Agent.
 */

export interface StatePermitRule {
  state_code: string
  state_name: string

  legal_width_ft: number
  legal_height_ft: number
  legal_length_ft: number
  legal_weight_lbs: number

  permit_threshold_width_ft: number | null
  permit_threshold_height_ft: number | null
  permit_threshold_length_ft: number | null
  permit_threshold_weight_lbs: number | null

  // New richer fields (added in migration 003)
  escort_threshold_width_ft?: number | null
  escort_threshold_height_ft?: number | null
  escort_threshold_length_ft?: number | null
  escort_threshold_weight_lbs?: number | null

  curfew_restrictions?: string | null
  special_notes?: string | null
  source?: string | null

  // Seasonal / Frost Law restrictions (added in migration 004)
  seasonal_weight_restrictions?: string | null

  // Permit pricing columns (added in migration 006)
  base_permit_fee_usd?: number | null
  oversize_surcharge_width_usd?: number | null
  oversize_surcharge_height_usd?: number | null
  oversize_surcharge_length_usd?: number | null
  overweight_surcharge_usd?: number | null
  additional_notes_pricing?: string | null

  notes?: string | null
  updated_at?: string
  last_updated?: string
}

export interface LoadDimensions {
  weight: number
  length: number
  width: number
  height: number
}
