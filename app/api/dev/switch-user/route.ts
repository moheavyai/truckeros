import { NextRequest, NextResponse } from 'next/server'
import {
  fetchDevSwitchAllowlistEmails,
  isDevSwitchEmailAllowed,
  resolveDevSwitchOrganizationId,
} from '@/lib/dev-account-switch'
import { isDevAccountSwitcherEnabled } from '@/lib/dev-mode'
import { normalizeInviteEmail } from '@/lib/team-invites'
import { hasAdminAccess, supabaseAdmin } from '@/lib/supabase'
import { createAuthedSupabaseClient } from '@/lib/team-member-profiles-api'

function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null
  return authHeader.replace(/^Bearer\s+/i, '').trim()
}

function appBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (!host) {
    throw new Error('NEXT_PUBLIC_APP_URL must be configured for dev account switching')
  }

  const isLocalHost =
    host.startsWith('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.startsWith('[::1]')

  if (!isLocalHost) {
    throw new Error('NEXT_PUBLIC_APP_URL must be configured for dev account switching')
  }

  const proto = request.headers.get('x-forwarded-proto') ?? 'http'
  return `${proto}://${host}`
}

/**
 * POST /api/dev/switch-user — dev-only magic link for account switching.
 * Requires auth, org allowlisted emails, and SUPABASE_SERVICE_ROLE_KEY.
 */
export async function POST(request: NextRequest) {
  if (!isDevAccountSwitcherEnabled()) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
  }

  const token = extractBearerToken(request)
  if (!token) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  if (!hasAdminAccess || !supabaseAdmin) {
    return NextResponse.json(
      { success: false, error: 'SUPABASE_SERVICE_ROLE_KEY is required for dev account switching' },
      { status: 503 }
    )
  }

  try {
    const supabase = createAuthedSupabaseClient(token)
    const {
      data: { user: actorUser },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !actorUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    let body: { email?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const email = normalizeInviteEmail(String(body.email ?? ''))
    if (!email) {
      return NextResponse.json({ success: false, error: 'Missing email' }, { status: 400 })
    }

    const organizationId = await resolveDevSwitchOrganizationId(
      supabase,
      actorUser.id,
      actorUser.email
    )
    const allowlist = await fetchDevSwitchAllowlistEmails(
      supabase,
      organizationId,
      actorUser.email,
      { adminClient: hasAdminAccess ? supabaseAdmin : null }
    )

    if (!isDevSwitchEmailAllowed(email, allowlist)) {
      return NextResponse.json(
        { success: false, error: 'Email is not allowed for dev account switching' },
        { status: 403 }
      )
    }

    const redirectTo = `${appBaseUrl(request)}/profile`
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    })

    if (error) {
      console.error('[dev/switch-user] generateLink failed:', error.message)
      throw new Error('Failed to generate sign-in link')
    }

    const hashedToken = data.properties?.hashed_token
    if (!hashedToken) {
      throw new Error('Failed to generate sign-in link')
    }

    return NextResponse.json({
      success: true,
      data: {
        email,
        hashed_token: hashedToken,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to switch user'
    console.error('[dev/switch-user] POST error:', message)

    if (message.toLowerCase().includes('unauthorized')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    if (message.includes('NEXT_PUBLIC_APP_URL')) {
      return NextResponse.json({ success: false, error: message }, { status: 500 })
    }

    return NextResponse.json(
      { success: false, error: 'Failed to switch user' },
      { status: 500 }
    )
  }
}