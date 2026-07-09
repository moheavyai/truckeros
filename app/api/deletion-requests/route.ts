import { NextRequest, NextResponse } from 'next/server'
import {
  createDeletionRequest,
  listPendingDeletionRequestsForOrg,
  reviewDeletionRequest,
} from '@/lib/deletion-requests'
import { getAuthenticatedMemberProfile } from '@/lib/team-member-profiles-api'

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
 * GET /api/deletion-requests — pending requests for Owner/Admin.
 * POST /api/deletion-requests — Permit Clerk requests removal.
 * PATCH /api/deletion-requests — Owner/Admin approve or reject.
 */
export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request)
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { supabase, profile } = await getAuthenticatedMemberProfile(token)
    const requests = await listPendingDeletionRequestsForOrg(supabase, profile)
    return NextResponse.json({ success: true, data: requests })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to list deletion requests'
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = extractBearerToken(request)
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { supabase, profile } = await getAuthenticatedMemberProfile(token)
    const created = await createDeletionRequest(supabase, profile, {
      resourceType: body.resource_type,
      resourceId: String(body.resource_id ?? ''),
      targetUserId: body.target_user_id ? String(body.target_user_id) : null,
      source: body.source,
    })

    return NextResponse.json({ success: true, data: created })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create deletion request'
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const token = extractBearerToken(request)
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const action = body.action === 'reject' ? 'reject' : 'approve'
    const requestId = String(body.id ?? '')

    const { supabase, profile } = await getAuthenticatedMemberProfile(token)
    const reviewed = await reviewDeletionRequest(supabase, profile, requestId, action)
    return NextResponse.json({ success: true, data: reviewed })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to review deletion request'
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}