import { NextRequest, NextResponse } from 'next/server'
import {
  createCarrierLinkRequest,
  listIncomingLinkRequestsForOwner,
  listOutgoingLinkRequests,
  respondToCarrierLinkRequest,
} from '@/lib/carrier-link-requests'
import { createAuthedSupabaseClient, getAuthenticatedMemberProfile } from '@/lib/team-member-profiles-api'
import { isPrimaryOwner } from '@/lib/member-profile-permissions'

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
  if (lower.includes('provide a usdot')) return 400
  return 500
}

/**
 * GET /api/carrier-link-requests?direction=outgoing|incoming
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

    const { supabase, userId, profile } = await getAuthenticatedMemberProfile(token)
    const direction = request.nextUrl.searchParams.get('direction') ?? 'outgoing'

    if (direction === 'incoming') {
      if (!isPrimaryOwner(profile) || !profile.organization_id) {
        return NextResponse.json(
          { success: false, error: 'Forbidden – only primary owners can view incoming requests' },
          { status: 403 }
        )
      }

      const requests = await listIncomingLinkRequestsForOwner(supabase, profile.organization_id)
      return NextResponse.json({ success: true, data: requests })
    }

    const requests = await listOutgoingLinkRequests(supabase, userId)
    return NextResponse.json({ success: true, data: requests })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to list link requests'
    console.error('[carrier-link-requests] GET error:', error)
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}

/**
 * POST /api/carrier-link-requests
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
    const supabase = createAuthedSupabaseClient(token)
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized – invalid token' }, { status: 401 })
    }

    const created = await createCarrierLinkRequest(supabase, userData.user.id, {
      target_usdot: body.target_usdot ? String(body.target_usdot) : undefined,
      target_email: body.target_email ? String(body.target_email) : undefined,
      message: body.message ? String(body.message) : undefined,
    })

    return NextResponse.json({ success: true, data: created })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create link request'
    console.error('[carrier-link-requests] POST error:', error)
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}

/**
 * PATCH /api/carrier-link-requests
 * Body: { id, action: 'approve' | 'reject' }
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

    const { supabase, userId, profile } = await getAuthenticatedMemberProfile(token)
    if (!isPrimaryOwner(profile)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden – only primary owners can respond to link requests' },
        { status: 403 }
      )
    }

    const updated = await respondToCarrierLinkRequest(supabase, requestId, userId, action)
    return NextResponse.json({ success: true, data: updated })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update link request'
    console.error('[carrier-link-requests] PATCH error:', error)
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}