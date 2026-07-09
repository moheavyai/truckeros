import { NextRequest, NextResponse } from 'next/server'
import {
  listPendingProfileChangeRequestsForOrg,
  parseRestrictedChangeRequestBody,
  reviewProfileChangeRequest,
  submitProfileChangeRequests,
} from '@/lib/profile-change-requests'
import {
  createAuthedSupabaseClient,
  getAuthenticatedMemberProfile,
} from '@/lib/team-member-profiles-api'

function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null
  return authHeader.replace(/^Bearer\s+/i, '').trim()
}

function errorStatus(message: string): number {
  const lower = message.toLowerCase()
  if (lower.includes('unauthorized') || lower.includes('invalid token')) return 401
  if (lower.includes('forbidden')) return 403
  if (lower.includes('not found')) return 404
  return 500
}

/**
 * GET /api/profile-change-requests
 * Primary owners list pending requests for their organization.
 */
export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request)
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized – missing or invalid Authorization header' },
        { status: 401 }
      )
    }

    const { supabase, profile } = await getAuthenticatedMemberProfile(token)
    const requests = await listPendingProfileChangeRequestsForOrg(supabase, profile)
    return NextResponse.json({ success: true, data: requests })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to list profile change requests'
    console.error('[profile-change-requests] GET error:', error)
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}

/**
 * POST /api/profile-change-requests
 * Drivers submit restricted-field edits for admin review.
 */
export async function POST(request: NextRequest) {
  try {
    const token = extractBearerToken(request)
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized – missing or invalid Authorization header' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const form = parseRestrictedChangeRequestBody(body)

    const { supabase, profile } = await getAuthenticatedMemberProfile(token)
    const created = await submitProfileChangeRequests(supabase, profile, form)
    return NextResponse.json({ success: true, data: created })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to submit profile change requests'
    console.error('[profile-change-requests] POST error:', error)
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}

/**
 * PATCH /api/profile-change-requests
 * Primary owners approve or reject pending driver field changes.
 */
export async function PATCH(request: NextRequest) {
  try {
    const token = extractBearerToken(request)
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized – missing or invalid Authorization header' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const requestId = body.id ? String(body.id) : ''
    const action = body.action === 'reject' ? 'reject' : body.action === 'approve' ? 'approve' : null

    if (!requestId || !action) {
      return NextResponse.json(
        { success: false, error: 'Request id and action (approve|reject) are required' },
        { status: 400 }
      )
    }

    const { supabase, profile } = await getAuthenticatedMemberProfile(token)
    const updated = await reviewProfileChangeRequest(supabase, profile, requestId, action)
    return NextResponse.json({ success: true, data: updated })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to review profile change request'
    console.error('[profile-change-requests] PATCH error:', error)
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}