import { NextRequest, NextResponse } from 'next/server'
import {
  canCreateCarrierConnectionInvite,
  createCarrierConnectionInvite,
  fetchMembershipRolesForUser,
  listOutgoingCarrierConnectionInvites,
  revokeCarrierConnectionInvite,
} from '@/lib/carrier-connection-invite-service'
import { getAuthenticatedMemberProfile } from '@/lib/team-member-profiles-api'

function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null
  return authHeader.replace(/^Bearer\s+/i, '').trim()
}

/**
 * True only for exact local dev hostnames (not localhost.evil.com or userinfo@host).
 */
export function isSafeLocalDevHost(host: string): boolean {
  const raw = host.trim().toLowerCase()
  if (!raw) return false
  if (raw.includes('@')) return false

  try {
    const parsed = new URL(`http://${raw}`)
    if (parsed.username || parsed.password) return false
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

function appBaseUrl(request: NextRequest): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')

  let host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  let proto = request.headers.get('x-forwarded-proto') ?? null

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

function errorStatus(message: string): number {
  const lower = message.toLowerCase()
  if (lower.includes('unauthorized') || lower.includes('invalid token')) return 401
  if (lower.includes('forbidden')) return 403
  if (
    lower.includes('required') ||
    lower.includes('provide an email') ||
    lower.includes('usdot already exists') ||
    lower.includes('must be')
  ) {
    return 400
  }
  if (lower.includes('not found')) return 404
  return 500
}

/**
 * GET /api/carrier-connection-invites — list invites created by the actor.
 * POST — Add Carrier + send connection invite (email/SMS stubbed unless providers enabled).
 * PATCH — revoke a pending invite by id.
 */
export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request)
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { supabase, userId, profile } = await getAuthenticatedMemberProfile(token)
    const membershipRoles = await fetchMembershipRolesForUser(supabase, userId)
    if (!canCreateCarrierConnectionInvite(profile, membershipRoles)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const invites = await listOutgoingCarrierConnectionInvites(supabase, userId)
    return NextResponse.json({ success: true, data: invites })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to list carrier connection invites'
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
    const membershipRoles = await fetchMembershipRolesForUser(supabase, userId)
    if (!canCreateCarrierConnectionInvite(profile, membershipRoles)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden – only Permit Clerk can add carriers',
        },
        { status: 403 }
      )
    }

    const body = await request.json()
    const result = await createCarrierConnectionInvite({
      actor: profile,
      invitedByUserId: userId,
      appBaseUrl: appBaseUrl(request),
      membershipRoles,
      input: {
        company_name: body.company_name ? String(body.company_name) : undefined,
        usdot_number: body.usdot_number ? String(body.usdot_number) : undefined,
        mc_number: body.mc_number ? String(body.mc_number) : undefined,
        ein: body.ein ? String(body.ein) : undefined,
        carrier_address: body.carrier_address ? String(body.carrier_address) : undefined,
        carrier_phone: body.carrier_phone ? String(body.carrier_phone) : undefined,
        carrier_email: body.carrier_email ? String(body.carrier_email) : undefined,
        insurance_contact: body.insurance_contact ? String(body.insurance_contact) : undefined,
        invite_contact_name: body.invite_contact_name
          ? String(body.invite_contact_name)
          : undefined,
        invite_email: body.invite_email ? String(body.invite_email) : undefined,
        invite_phone: body.invite_phone ? String(body.invite_phone) : undefined,
        message: body.message ? String(body.message) : undefined,
      },
    })

    return NextResponse.json({
      success: true,
      data: result.invite,
      email: result.email,
      sms: result.sms,
    })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to create carrier connection invite'
    console.error('[carrier-connection-invites] POST error:', error)
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const token = extractBearerToken(request)
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { supabase, userId, profile } = await getAuthenticatedMemberProfile(token)
    const membershipRoles = await fetchMembershipRolesForUser(supabase, userId)
    if (!canCreateCarrierConnectionInvite(profile, membershipRoles)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const inviteId = String(body.id ?? '')
    if (!inviteId) {
      return NextResponse.json({ success: false, error: 'Missing invite id' }, { status: 400 })
    }

    const updated = await revokeCarrierConnectionInvite({
      invitedByUserId: userId,
      inviteId,
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to revoke carrier connection invite'
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}
