import { NextRequest, NextResponse } from 'next/server'
import {
  acceptCarrierConnectionInviteForUser,
  previewCarrierConnectionInviteForUser,
  CARRIER_CONNECTION_INVITE_UNAVAILABLE_MESSAGE,
} from '@/lib/carrier-connection-invite-service'
import {
  redactCarrierConnectionInviteForClient,
  validateAcceptCarrierConnectionInvite,
} from '@/lib/carrier-connection-invites'
import { createAuthedSupabaseClient } from '@/lib/team-member-profiles-api'

function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null
  return authHeader.replace(/^Bearer\s+/i, '').trim()
}

function errorStatus(message: string): number {
  const lower = message.toLowerCase()
  if (lower.includes('unauthorized') || lower.includes('invalid token')) return 401
  if (lower.includes('already has a primary owner')) return 409
  if (
    lower.includes('not found') ||
    lower.includes('expired') ||
    lower.includes('revoked') ||
    lower.includes('email address that received') ||
    lower.includes('no longer valid') ||
    lower.includes('already been accepted')
  ) {
    return 404
  }
  if (lower.includes('forbidden')) return 403
  return 500
}

/**
 * GET /api/carrier-connection-invites/accept?token= — preview (auth required).
 * POST — accept connection (auth + email bind).
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token')?.trim()
    if (!token) {
      return NextResponse.json({ success: false, error: 'Missing invite token' }, { status: 400 })
    }

    const bearer = extractBearerToken(request)
    if (!bearer) {
      return NextResponse.json(
        { success: false, error: 'Sign in required to preview this invite' },
        { status: 401 }
      )
    }

    const supabase = createAuthedSupabaseClient(bearer)
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const preview = await previewCarrierConnectionInviteForUser({
      supabase,
      token,
      acceptorEmail: userData.user.email,
    })

    if (!preview) {
      return NextResponse.json(
        { success: false, error: CARRIER_CONNECTION_INVITE_UNAVAILABLE_MESSAGE },
        { status: 404 }
      )
    }

    // Double-check email binding for admin fallback path that may surface previews.
    const validation = validateAcceptCarrierConnectionInvite(
      {
        id: preview.id,
        invited_by_user_id: '',
        company_name: preview.company_name,
        invite_email: preview.invite_email,
        invite_token: token,
        status: 'pending',
        expires_at: preview.expires_at,
        organization_id: preview.organization_id,
      },
      {
        token,
        acceptorUserId: userData.user.id,
        acceptorEmail: userData.user.email,
      }
    )

    if (validation.ok === false) {
      console.warn('[carrier-connection-invites/accept] preview rejected', validation.code)
      return NextResponse.json(
        { success: false, error: CARRIER_CONNECTION_INVITE_UNAVAILABLE_MESSAGE },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        id: preview.id,
        company_name: preview.company_name,
        usdot_number: preview.usdot_number,
        invite_email: preview.invite_email,
        invite_contact_name: preview.invite_contact_name,
        organization_id: preview.organization_id,
        expires_at: preview.expires_at,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load invite'
    console.warn('[carrier-connection-invites/accept] GET error', message)
    const status = errorStatus(message)
    const clientMessage =
      status === 404 || status === 403
        ? CARRIER_CONNECTION_INVITE_UNAVAILABLE_MESSAGE
        : message
    return NextResponse.json(
      { success: false, error: clientMessage },
      { status: status === 403 ? 404 : status }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = extractBearerToken(request)
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const inviteToken = String(body.token ?? '').trim()
    if (!inviteToken) {
      return NextResponse.json({ success: false, error: 'Missing invite token' }, { status: 400 })
    }

    const supabase = createAuthedSupabaseClient(token)
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const outcome = await acceptCarrierConnectionInviteForUser({
      supabase,
      userId: userData.user.id,
      acceptorEmail: userData.user.email,
      token: inviteToken,
    })

    return NextResponse.json({
      success: true,
      data: {
        ...redactCarrierConnectionInviteForClient(outcome.invite),
        multi_org_join: outcome.multiOrgJoin,
        organization_id: outcome.organizationId,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to accept invite'
    console.warn('[carrier-connection-invites/accept] POST error', message)
    const status = errorStatus(message)
    const clientMessage =
      status === 404 || status === 403 || status === 409
        ? CARRIER_CONNECTION_INVITE_UNAVAILABLE_MESSAGE
        : message
    return NextResponse.json(
      { success: false, error: clientMessage },
      { status: status === 403 ? 404 : status }
    )
  }
}
