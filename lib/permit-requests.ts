// lib/permit-requests.ts
//
// Server-side utility for saving permit requests with enforced user ownership.
// This is the single source of truth for persisting permit analysis results.
//
// Key responsibilities:
// - Authenticate the caller using the provided Supabase access token (JWT)
// - Derive the authoritative user_id from auth.uid() (never trust client-supplied user_id for ownership)
// - Insert the record using an authenticated Supabase client (so RLS policies apply)
// - Return the saved record or throw a descriptive error
//
// This module is used by:
// - app/api/permit-requests/route.ts (the main save endpoint)
// - Potentially app/api/analyze-permit/route.ts when auto-save is requested
//
// Security model:
// - RLS policies in the database (see migration 005) are the final gate.
// - This code adds defense-in-depth by forcing the correct user_id server-side.

import { createClient } from '@supabase/supabase-js'

export interface SavePermitRequestInput {
  origin_city: string
  origin_state: string
  destination_city: string
  destination_state: string
  weight: number
  length: number
  width: number
  height: number

  // NEW (Intake Form v2): full equipment rig + cargo snapshots captured at approval time
  // These are stored as JSONB on permit_requests so History and future analytics
  // can show exactly which tractor/trailer/load the carrier submitted.
  equipment?: Record<string, any>
  cargo?: Record<string, any>

  route_corridor?: string[]
  permit_required_states?: string[]
  requires_permit?: boolean
  reasons?: string[]
  notes?: string[]
  estimated_cost?: number
  cost_breakdown?: any
  distance_miles?: number | null
  duration_hours?: number | null

  // client may send a user_id, but we will override it with the authenticated user
  user_id?: string
}

export interface SavedPermitRequest {
  id: string
  created_at: string
  user_id: string
  [key: string]: any
}

/**
 * Saves a permit request on behalf of the authenticated user.
 * The user_id is **always** taken from the validated JWT — client values are ignored for security.
 */
export async function savePermitRequestForUser(
  payload: SavePermitRequestInput,
  accessToken: string
): Promise<SavedPermitRequest> {
  if (!accessToken) {
    throw new Error('Missing access token')
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  // Create a Supabase client authenticated as this specific user
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
    },
  })

  // Verify the token and get the real user
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    console.error('[permit-requests] Auth error while saving:', authError)
    throw new Error('Invalid or expired authentication token')
  }

  // Build the record we will actually insert.
  // CRITICAL: We force user_id from the authenticated JWT. This prevents
  // a malicious client from trying to save a record under a different user.
  const recordToInsert = {
    ...payload,
    user_id: user.id, // ← authoritative value from Supabase Auth
  }

  // Remove any client-sent user_id to avoid confusion (we already overrode it)
  delete (recordToInsert as any).user_id // safety — we set it above

  // Re-apply the correct user_id
  ;(recordToInsert as any).user_id = user.id

  const { data, error } = await supabase
    .from('permit_requests')
    .insert([recordToInsert])
    .select()
    .single()

  if (error) {
    console.error('[permit-requests] Insert error:', error)
    // Common RLS violation message is helpful for debugging
    if (error.message?.toLowerCase().includes('row-level security')) {
      throw new Error('Permission denied: you can only save requests for your own account')
    }
    throw new Error(`Failed to save permit request: ${error.message}`)
  }

  return data as SavedPermitRequest
}
