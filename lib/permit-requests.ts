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

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  sanitizeLoadedArrangement,
  sanitizeMoveType,
  sanitizeNumberOfPieces,
} from '@/lib/load-details-options'
import { SERVICE_MODE_ELIGIBLE_ROLES as SERVICE_MODE_ELIGIBLE_ROLES_LIST } from '@/lib/service-mode-scope'

export type SavedDropStop = {
  id?: string
  query?: string
  street?: string
  city?: string
  state?: string
  zip?: string
  lat?: number
  lon?: number
}

export interface SavePermitRequestInput {
  origin_city: string
  origin_state: string
  destination_city: string
  destination_state: string
  origin_query?: string
  destination_query?: string
  drops?: SavedDropStop[]
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

/** Columns on permit_requests that SavePermitRequestInput may populate (migrations 002, 009, 014). */
export type PermitRequestInsertRecord = {
  user_id: string
  origin_city: string
  origin_state: string
  destination_city: string
  destination_state: string
  origin_query?: string | null
  destination_query?: string | null
  drops?: SavedDropStop[] | null
  weight: number
  length: number
  width: number
  height: number
  equipment?: Record<string, unknown> | null
  cargo?: Record<string, unknown> | null
  route_corridor?: string[]
  permit_required_states?: string[]
  requires_permit?: boolean
  reasons?: string[]
  notes?: string[]
  estimated_cost?: number
  cost_breakdown?: unknown | null
  distance_miles?: number | null
  duration_hours?: number | null
}

/** Align with Phase 1 client SM eligibility (shared SERVICE_MODE_ELIGIBLE_ROLES). */
const SERVICE_MODE_ELIGIBLE_ROLES = new Set<string>(SERVICE_MODE_ELIGIBLE_ROLES_LIST)

/** Sanitize cargo subfields (piece count + enums) before persistence. */
export function sanitizeCargoSnapshot(
  cargo: Record<string, any> | null | undefined
): Record<string, unknown> | null {
  if (!cargo) return null

  const sanitized: Record<string, unknown> = { ...cargo }

  if ('numberOfPieces' in cargo) {
    sanitized.numberOfPieces = sanitizeNumberOfPieces(cargo.numberOfPieces)
  }
  if ('loadedArrangement' in cargo) {
    sanitized.loadedArrangement = sanitizeLoadedArrangement(cargo.loadedArrangement)
  }
  if ('moveType' in cargo) {
    sanitized.moveType = sanitizeMoveType(cargo.moveType)
  }

  return sanitized
}

/**
 * Validates cargo.organizationId against the authenticated user's carrier org or
 * eligible service-mode membership. Returns null to strip unauthorized values.
 */
export async function validateCargoOrganizationId(
  supabase: SupabaseClient,
  userId: string,
  organizationId: unknown
): Promise<string | null> {
  if (typeof organizationId !== 'string') return null
  const orgId = organizationId.trim()
  if (!orgId) return null

  const [{ data: ownProfile }, { data: membership }, { data: created }] = await Promise.all([
    supabase
      .from('member_profiles')
      .select('organization_id')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('organization_memberships')
      .select('organization_id, role')
      .eq('user_id', userId)
      .eq('organization_id', orgId)
      .maybeSingle(),
    supabase
      .from('organizations')
      .select('id')
      .eq('id', orgId)
      .eq('created_by_user_id', userId)
      .maybeSingle(),
  ])

  if (ownProfile?.organization_id === orgId) return orgId
  if (created?.id === orgId) return orgId

  const role = typeof membership?.role === 'string' ? membership.role : null
  if (membership?.organization_id === orgId && role && SERVICE_MODE_ELIGIBLE_ROLES.has(role)) {
    return orgId
  }

  return null
}

export async function sanitizeCargoSnapshotForUser(
  supabase: SupabaseClient,
  userId: string,
  cargo: Record<string, any> | null | undefined
): Promise<Record<string, unknown> | null> {
  const sanitized = sanitizeCargoSnapshot(cargo)
  if (!sanitized) return null

  if ('organizationId' in sanitized) {
    const validated = await validateCargoOrganizationId(
      supabase,
      userId,
      sanitized.organizationId
    )
    if (validated) {
      sanitized.organizationId = validated
    } else {
      delete sanitized.organizationId
    }
  }

  return sanitized
}

/** Build an insert payload with only known DB columns (avoids stray client fields). */
export function buildPermitRequestInsertRecord(
  payload: SavePermitRequestInput,
  userId: string,
  cargoOverride?: Record<string, unknown> | null
): PermitRequestInsertRecord {
  return {
    user_id: userId,
    origin_city: payload.origin_city,
    origin_state: payload.origin_state,
    destination_city: payload.destination_city,
    destination_state: payload.destination_state,
    origin_query: payload.origin_query ?? null,
    destination_query: payload.destination_query ?? null,
    drops: payload.drops ?? null,
    weight: payload.weight,
    length: payload.length,
    width: payload.width,
    height: payload.height,
    equipment: payload.equipment ?? null,
    cargo: cargoOverride !== undefined ? cargoOverride : sanitizeCargoSnapshot(payload.cargo),
    route_corridor: payload.route_corridor ?? [],
    permit_required_states: payload.permit_required_states ?? [],
    requires_permit: payload.requires_permit ?? false,
    reasons: payload.reasons ?? [],
    notes: payload.notes ?? [],
    estimated_cost: payload.estimated_cost ?? 0,
    cost_breakdown: payload.cost_breakdown ?? null,
    distance_miles: payload.distance_miles ?? null,
    duration_hours: payload.duration_hours ?? null,
  }
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
  const cargo = await sanitizeCargoSnapshotForUser(supabase, user.id, payload.cargo)
  const recordToInsert = buildPermitRequestInsertRecord(payload, user.id, cargo)

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