import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * POST /api/portal-submissions
 * 
 * Saves a portal submission record.
 * The record must include permit_request_id (which the user owns).
 * RLS + server-side check ensures security.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const authHeader = request.headers.get('authorization')

    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Verify the user owns the permit_request
    const { data: pr, error: prError } = await supabase
      .from('permit_requests')
      .select('id, user_id')
      .eq('id', body.permit_request_id)
      .single()

    if (prError || !pr || pr.user_id !== user.id) {
      return NextResponse.json({ error: 'You do not own this permit request' }, { status: 403 })
    }

    // Prepare the record (allow the client to send the full object from createPortalSubmissionRecord)
    // Supports pdf_reference (storage path/URL), human_approved (from gate), route_comparison json, status updates, raw output for audit.
    const submission = {
      permit_request_id: body.permit_request_id,
      user_id: user.id,
      state_code: body.state_code,
      status: body.status || 'submitted',
      our_recommended_corridor: body.our_recommended_corridor,
      portal_returned_corridor: body.portal_returned_corridor,
      route_comparison: body.route_comparison,
      permit_number: body.permit_number,
      portal_fees: body.portal_fees,
      portal_restrictions: body.portal_restrictions || [],
      user_notes: body.user_notes,
      human_approved: body.human_approved || false,
      pdf_reference: body.pdf_reference,
      raw_portal_output: (body.raw_portal_output || '').substring(0, 4000), // truncated to 4000 for security (raw may contain sensitive permit/audit data; full exposure reduced)
    }

    // Reliable insert using ON CONFLICT DO NOTHING (via the client's conflict option on the exact
    // unique columns from the table: permit_request_id,state_code). This never produces an ON CONFLICT
    // target / duplicate-key error regardless of prior constraint timing. We then SELECT by the same
    // columns to return the row (new or pre-existing) so callers always get data.
    const { error: insError } = await supabase
      .from('portal_submissions')
      .insert(submission, {
        // @ts-ignore - the insert options type in current @supabase may not declare onConflict/ignoreDuplicates,
        // but PostgREST accepts them at runtime to emit "ON CONFLICT (...) DO NOTHING" against the table's
        // (permit_request_id, state_code) unique constraint. This is the reliable form that never errors.
        onConflict: 'permit_request_id,state_code',
        ignoreDuplicates: true
      } as any)
    if (insError) throw insError

    const { data, error } = await supabase
      .from('portal_submissions')
      .select()
      .eq('permit_request_id', submission.permit_request_id)
      .eq('state_code', submission.state_code)
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    console.error('[portal-submissions] Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to save submission' }, { status: 500 })
  }
}

/**
 * GET /api/portal-submissions?permit_request_id=xxx
 * Returns all portal submissions for a given permit request (owned by user).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const permitRequestId = searchParams.get('permit_request_id')

  const authHeader = request.headers.get('authorization')
  if (!authHeader || !permitRequestId) {
    return NextResponse.json({ error: 'Unauthorized or missing permit_request_id' }, { status: 401 })
  }

  const token = authHeader.replace('Bearer ', '')
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership of the parent request
  const { data: pr } = await supabase
    .from('permit_requests')
    .select('user_id')
    .eq('id', permitRequestId)
    .single()

  if (!pr || pr.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('portal_submissions')
    .select('*')
    .eq('permit_request_id', permitRequestId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return NextResponse.json({ data })
}
