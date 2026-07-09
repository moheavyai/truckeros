import { NextRequest, NextResponse } from 'next/server'
import {
  createOrUpdateRosterMemberForUser,
  parseMemberProfileForm,
  saveTeamMemberProfileForUser,
} from '@/lib/team-member-profiles-api'

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
    lower.includes('cannot reassign your own membership') ||
    lower.includes('cannot invite yourself') ||
    lower.includes('cannot reassign your own membership role to permit clerk')
  ) {
    return 403
  }
  if (lower.includes('not found')) return 404
  // Client validation / bad role or org context (not server faults)
  if (
    lower.includes('only admin, driver, permit clerk') ||
    lower.includes('owner role can only be assigned') ||
    lower.includes('owner role cannot be assigned') ||
    lower.includes('at least one role is required') ||
    lower.includes('invalid role combination') ||
    lower.includes('organization not configured')
  ) {
    return 400
  }
  return 500
}

/**
 * POST /api/team-member-profiles
 *
 * Saves a member profile (self or another org user) or a roster entry.
 * Server-side permission checks enforce primary-owner rules.
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
    const form = parseMemberProfileForm(body)
    const source = String(body.source ?? 'member_profile')

    if (source === 'team_member_profile') {
      const saved = await createOrUpdateRosterMemberForUser(token, {
        id: body.id ? String(body.id) : undefined,
        form,
        linkedUserId: body.linked_user_id ? String(body.linked_user_id) : null,
        permissions: body.permissions,
      })
      return NextResponse.json({ success: true, data: saved })
    }

    const saved = await saveTeamMemberProfileForUser(token, {
      form,
      targetUserId: body.target_user_id ? String(body.target_user_id) : undefined,
      permissions: body.permissions,
      saveScope:
        body.save_scope === 'carrier_only' || body.save_scope === 'member_only' || body.save_scope === 'full'
          ? body.save_scope
          : 'full',
    })

    return NextResponse.json({ success: true, data: saved })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save team member profile'
    console.error('[team-member-profiles] POST error:', error)
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}