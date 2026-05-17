import { NextRequest, NextResponse } from 'next/server'
import { savePermitRequestForUser, type SavePermitRequestInput } from '@/lib/permit-requests'

/**
 * POST /api/permit-requests
 *
 * Saves a completed permit analysis result for the currently authenticated user.
 *
 * Security model:
 * - Requires a valid Supabase JWT in the Authorization: Bearer <token> header.
 * - The server **always** derives the owner (user_id) from the validated JWT.
 *   Any user_id sent in the request body is ignored/overridden. This prevents
 *   privilege escalation or saving records for other users.
 * - Row Level Security (RLS) policies defined in migration 005 are the final
 *   enforcement layer in the database.
 *
 * Backward compatibility:
 * - Existing rows that have user_id = NULL (pre-migration data) are not
 *   returned to regular users via RLS. Service role / admin tools can still
 *   access them for backfill or auditing.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Require Authorization header with the user's Supabase access token
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized – missing or invalid Authorization header' },
        { status: 401 }
      )
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim()

    // The shared utility will:
    // 1. Create an authenticated Supabase client
    // 2. Validate the token and extract the real user
    // 3. Force user_id = auth.uid() on the record
    // 4. Perform the insert (RLS will also protect us)
    const saved = await savePermitRequestForUser(body as SavePermitRequestInput, token)

    return NextResponse.json({ success: true, data: saved })
  } catch (error: any) {
    console.error('[permit-requests] Error saving permit request:', error)

    const message = error?.message || 'Failed to save permit request'
    const status = message.toLowerCase().includes('unauthorized') || message.toLowerCase().includes('token')
      ? 401
      : 500

    return NextResponse.json({ success: false, error: message }, { status })
  }
}