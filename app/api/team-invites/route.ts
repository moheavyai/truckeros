import { NextRequest, NextResponse } from 'next/server'
import { canManageMemberPermissions } from '@/lib/member-profile-permissions'
import { sendInviteNotifications } from '@/lib/invite-notifications'
import {
  assertNotSelfPermitClerkInvite,
  buildTeamInviteRecord,
  filterActivePendingInvites,
  isInviteExpired,
  validateCreateTeamInviteInput,
  type TeamInviteRow,
} from '@/lib/team-invites'
import { isSafeLocalDevHost } from '@/lib/safe-local-dev-host'
import { getAuthenticatedMemberProfile } from '@/lib/team-member-profiles-api'

function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null
  return authHeader.replace(/^Bearer\s+/i, '').trim()
}

function errorStatus(message: string): number {
  const lower = message.toLowerCase()
  if (lower.includes('unauthorized') || lower.includes('invalid token')) return 401
  if (
    lower.includes('forbidden') ||
    lower.includes('cannot invite yourself') ||
    lower.includes('cannot reassign your own membership')
  ) {
    return 403
  }
  return 500
}

/**
 * Invite links must use a configured public origin (prevents Host-header phishing).
 * Localhost is allowed only for exact local hostnames (dev).
 */
function appBaseUrl(request: NextRequest): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')

  let host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  let proto = request.headers.get('x-forwarded-proto') ?? null

  // Fall back to request URL (tests / local NextRequest without Host header).
  if (!host) {
    try {
      const url = new URL(request.url)
      host = url.host
      proto = proto ?? url.protocol.replace(':', '')
    } catch {
      host = null
    }
  }

  if (!host) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL (or APP_URL) must be configured to create invite links'
    )
  }

  if (!isSafeLocalDevHost(host)) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL (or APP_URL) must be configured to create invite links'
    )
  }

  return `${proto ?? 'http'}://${host}`
}

/**
 * GET /api/team-invites — list pending invites for the actor's organization.
 * POST /api/team-invites — create an email or SMS invite (SMS stubbed unless TWILIO_ENABLED).
 */
export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request)
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { supabase, profile } = await getAuthenticatedMemberProfile(token)
    if (!profile.organization_id || !canManageMemberPermissions(profile)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('team_invites')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)

    const rows = filterActivePendingInvites(data ?? [])
    const expiredIds = (data ?? [])
      .filter((row) => isInviteExpired(row as Pick<TeamInviteRow, 'expires_at' | 'status'>))
      .map((row) => row.id)

    if (expiredIds.length > 0) {
      await supabase
        .from('team_invites')
        .update({ status: 'expired' })
        .in('id', expiredIds)
    }

    return NextResponse.json({ success: true, data: rows })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to list team invites'
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = extractBearerToken(request)
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { supabase, userId, profile } = await getAuthenticatedMemberProfile(token)
    if (!profile.organization_id || !canManageMemberPermissions(profile)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const validated = validateCreateTeamInviteInput({
      organizationId: profile.organization_id,
      role: String(body.role ?? 'Viewer'),
      inviteEmail: body.invite_email ? String(body.invite_email) : null,
      invitePhone: body.invite_phone ? String(body.invite_phone) : null,
    })

    // Prefer auth email/phone; also check profile contact fields for self-invite PE.
    let inviterAuthEmail: string | null = null
    let inviterAuthPhone: string | null = null
    if (typeof supabase.auth?.getUser === 'function') {
      const { data: authData } = await supabase.auth.getUser()
      inviterAuthEmail = authData?.user?.email ?? null
      const phone =
        (authData?.user as { phone?: string | null } | null | undefined)?.phone ?? null
      inviterAuthPhone = phone
    }
    assertNotSelfPermitClerkInvite({
      role: validated.role,
      inviteEmail: validated.invite_email,
      invitePhone: validated.invite_phone,
      inviterEmails: [
        inviterAuthEmail,
        profile.driver_email,
        profile.carrier_email,
      ],
      inviterPhones: [
        inviterAuthPhone,
        profile.driver_phone,
        profile.carrier_phone,
      ],
    })

    const record = buildTeamInviteRecord({
      organizationId: profile.organization_id,
      invitedByUserId: userId,
      role: String(body.role ?? 'Viewer'),
      inviteEmail: body.invite_email ? String(body.invite_email) : null,
      invitePhone: body.invite_phone ? String(body.invite_phone) : null,
      appBaseUrl: appBaseUrl(request),
    })

    if (record.invite_email) {
      const { error: revokeEmailError } = await supabase
        .from('team_invites')
        .update({ status: 'revoked' })
        .eq('organization_id', profile.organization_id)
        .eq('status', 'pending')
        .eq('invite_email', record.invite_email)
      if (revokeEmailError) throw new Error(revokeEmailError.message)
    }

    if (record.invite_phone) {
      const { error: revokePhoneError } = await supabase
        .from('team_invites')
        .update({ status: 'revoked' })
        .eq('organization_id', profile.organization_id)
        .eq('status', 'pending')
        .eq('invite_phone', record.invite_phone)
      if (revokePhoneError) throw new Error(revokePhoneError.message)
    }

    const { data, error } = await supabase.from('team_invites').insert(record).select('*').single()
    if (error) throw new Error(error.message)

    const notifications = sendInviteNotifications({
      invite: {
        role: record.role,
        invite_email: record.invite_email,
        invite_phone: record.invite_phone,
        invite_link: record.invite_link,
      },
    })

    return NextResponse.json({
      success: true,
      data,
      email: notifications.email,
      sms: notifications.sms,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create team invite'
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const token = extractBearerToken(request)
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { supabase, profile } = await getAuthenticatedMemberProfile(token)
    if (!profile.organization_id || !canManageMemberPermissions(profile)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const inviteId = String(body.id ?? '')
    if (!inviteId) {
      return NextResponse.json({ success: false, error: 'Missing invite id' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('team_invites')
      .update({ status: 'revoked' })
      .eq('id', inviteId)
      .eq('organization_id', profile.organization_id)
      .eq('status', 'pending')
      .select('*')
      .single()

    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, data })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to revoke team invite'
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}