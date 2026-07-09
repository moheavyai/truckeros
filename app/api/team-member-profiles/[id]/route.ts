import { NextRequest, NextResponse } from 'next/server'
import { deleteTeamMemberForUser } from '@/lib/team-member-profiles-api'

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
  return 500
}

/**
 * DELETE /api/team-member-profiles/[id]
 *
 * Deletes another user's member profile or a roster entry.
 * Primary owner only; cannot delete own profile.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const token = extractBearerToken(request)
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized – missing or invalid Authorization header' },
        { status: 401 }
      )
    }

    const { id } = await context.params
    const source = request.nextUrl.searchParams.get('source')
    const userId = request.nextUrl.searchParams.get('user_id')

    if (source !== 'member_profile' && source !== 'team_member_profile') {
      return NextResponse.json(
        { success: false, error: 'Invalid source – expected member_profile or team_member_profile' },
        { status: 400 }
      )
    }

    const result = await deleteTeamMemberForUser(token, {
      source,
      id,
      userId: userId ?? undefined,
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete team member profile'
    console.error('[team-member-profiles] DELETE error:', error)
    return NextResponse.json({ success: false, error: message }, { status: errorStatus(message) })
  }
}