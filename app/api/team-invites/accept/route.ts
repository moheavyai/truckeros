import { NextRequest, NextResponse } from 'next/server'
import { acceptTeamInviteForUser, previewTeamInviteForUser } from '@/lib/team-invite-accept'
import { INVITE_UNAVAILABLE_MESSAGE, validateAcceptTeamInvite } from '@/lib/team-invites'
import { createAuthedSupabaseClient } from '@/lib/team-member-profiles-api'

function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null
  return authHeader.replace(/^Bearer\s+/i, '').trim()
}

function errorStatus(message: string): number {
  const lower = message.toLowerCase()
  if (lower.includes('unauthorized') || lower.includes('invalid token')) return 401
  // Uniform 404 for not found / expired / revoked / email mismatch (no token oracle).
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
 * GET /api/team-invites/accept?token= — preview invite via server RPC (requires auth).
 * POST /api/team-invites/accept — accept invite via server RPC.
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token')?.trim()
    if (!token) {
      return NextResponse.json({ success: false, error: 'Missing invite token' }, { status: 400 })
    }

    const bearer = extractBearerToken(request)
    const supabase = bearer ? createAuthedSupabaseClient(bearer) : null

    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Sign in required to preview this invite' },
        { status: 401 }
      )
    }

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const invite = await previewTeamInviteForUser({
      supabase,
      token,
      acceptorEmail: userData.user.email,
    })

    if (!invite) {
      return NextResponse.json({ success: false, error: INVITE_UNAVAILABLE_MESSAGE }, { status: 404 })
    }

    const validation = validateAcceptTeamInvite(
      {
        id: invite.id,
        organization_id: invite.organization_id,
        invited_by_user_id: '',
        role: invite.role,
        invite_email: invite.invite_email,
        invite_token: token,
        status: 'pending',
        expires_at: invite.expires_at,
      },
      {
        token,
        acceptorUserId: userData.user.id,
        acceptorEmail: userData.user.email,
      }
    )

    if (validation.ok === false) {
      // Do not reveal email mismatch vs missing (token validity oracle).
      console.warn('[team-invites/accept] preview rejected', validation.code)
      return NextResponse.json(
        { success: false, error: INVITE_UNAVAILABLE_MESSAGE },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        id: invite.id,
        role: invite.role,
        invite_email: invite.invite_email,
        organization_id: invite.organization_id,
        expires_at: invite.expires_at,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load invite'
    console.warn('[team-invites/accept] GET error', message)
    const status = errorStatus(message)
    const clientMessage =
      status === 404 || status === 403 ? INVITE_UNAVAILABLE_MESSAGE : message
    return NextResponse.json({ success: false, error: clientMessage }, { status: status === 403 ? 404 : status })
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

    const outcome = await acceptTeamInviteForUser({
      supabase,
      userId: userData.user.id,
      acceptorEmail: userData.user.email,
      token: inviteToken,
    })

    return NextResponse.json({
      success: true,
      data: {
        ...outcome.invite,
        multi_org_join: outcome.multiOrgJoin,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to accept invite'
    console.warn('[team-invites/accept] POST error', message)
    const status = errorStatus(message)
    const clientMessage =
      status === 404 || status === 403 ? INVITE_UNAVAILABLE_MESSAGE : message
    return NextResponse.json(
      { success: false, error: clientMessage },
      { status: status === 403 ? 404 : status }
    )
  }
}
