import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_STATE_RULES,
  buildStateRulesForSave,
  calculateAxleGroups,
  normalizeStateCode,
  parseAxleInputs,
  sanitizeStateRules,
} from '@/lib/axleGroupCalculator'

export const dynamic = 'force-dynamic'

/**
 * Resolve organization_id from the authenticated user's membership/profile only.
 * Never trust client-supplied organization_id.
 */
async function resolveUserOrganizationId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string | null> {
  const { data: profile } = await supabase
    .from('member_profiles')
    .select('organization_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (profile?.organization_id) return String(profile.organization_id)

  const { data: membership } = await supabase
    .from('organization_memberships')
    .select('organization_id')
    .eq('user_id', userId)
    .order('is_primary_owner', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return membership?.organization_id ? String(membership.organization_id) : null
}

/**
 * POST /api/axle-optimize
 *
 * Auth required (supabase.auth.getUser). Runs spacing-based axle group analysis.
 * Optional save: insert/update axle_configs under RLS (user_id from JWT).
 *
 * Body: { axles, states?, name?, save?, state_rules?, id? }
 * Note: organization_id from client is ignored; resolved server-side from membership.
 * Empty states [] → federal baseline only (never expands to all corridor defaults).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = parseAxleInputs(body.axles)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error || 'Invalid axles' }, { status: 400 })
    }

    const rawStates = Array.isArray(body.states) ? body.states : []
    const states = rawStates
      .map((s) => normalizeStateCode(String(s)))
      .filter((s) => s.length === 2)

    // Sanitize overrides — reject negative/NaN caps; known keys only.
    const stateRulesOverride = sanitizeStateRules(body.state_rules, [
      ...states,
      ...Object.keys(DEFAULT_STATE_RULES),
      'US',
    ])

    const analysis = calculateAxleGroups({
      axles: parsed.axles,
      states,
      state_rules: stateRulesOverride,
    })

    const save = body.save === true
    let saved: Record<string, unknown> | null = null

    if (save) {
      const name =
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim().slice(0, 120)
          : 'Untitled axle config'

      // Selected states only (empty → federal US baseline + _selected_states: [])
      const rulesToStore = buildStateRulesForSave(states, stateRulesOverride)

      // Server-derived only — never body.organization_id
      const organization_id = await resolveUserOrganizationId(supabase, user.id)

      const existingId =
        typeof body.id === 'string' && body.id.trim() ? body.id.trim() : null

      const row = {
        user_id: user.id,
        organization_id,
        name,
        axles: parsed.axles,
        state_rules: rulesToStore,
        updated_at: new Date().toISOString(),
      }

      if (existingId) {
        const { data, error } = await supabase
          .from('axle_configs')
          .update(row)
          .eq('id', existingId)
          .eq('user_id', user.id)
          .select('*')
          .maybeSingle()

        if (error) {
          console.error('[axle-optimize] update error:', error)
          return NextResponse.json(
            { error: 'Failed to update axle config', analysis },
            { status: 500 }
          )
        }
        if (!data) {
          return NextResponse.json(
            { error: 'Config not found or not owned by user', analysis },
            { status: 404 }
          )
        }
        saved = data as Record<string, unknown>
      } else {
        const { data, error } = await supabase
          .from('axle_configs')
          .insert(row)
          .select('*')
          .maybeSingle()

        if (error) {
          console.error('[axle-optimize] insert error:', error)
          return NextResponse.json(
            { error: 'Failed to save axle config', analysis },
            { status: 500 }
          )
        }
        saved = data as Record<string, unknown>
      }
    }

    return NextResponse.json({
      success: true,
      analysis,
      permit: analysis.permit_json,
      saved,
    })
  } catch (err: unknown) {
    console.error('[axle-optimize] error:', err)
    return NextResponse.json({ error: 'Axle optimize failed' }, { status: 500 })
  }
}

/**
 * GET /api/axle-optimize
 * List saved configs for the authenticated user (RLS-scoped).
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('axle_configs')
      .select('id, name, axles, state_rules, organization_id, created_at, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[axle-optimize] list error:', error)
      return NextResponse.json({ error: 'Failed to list configs' }, { status: 500 })
    }

    return NextResponse.json({ success: true, configs: data ?? [] })
  } catch (err: unknown) {
    console.error('[axle-optimize] GET error:', err)
    return NextResponse.json({ error: 'List failed' }, { status: 500 })
  }
}

/**
 * DELETE /api/axle-optimize?id=...
 * Delete a config owned by the authenticated user.
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const id =
      request.nextUrl?.searchParams?.get('id')?.trim() ||
      new URL(request.url).searchParams.get('id')?.trim() ||
      ''
    if (!id) {
      return NextResponse.json({ error: 'id query param required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('axle_configs')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[axle-optimize] delete error:', error)
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Config not found or not owned by user' }, { status: 404 })
    }

    return NextResponse.json({ success: true, deleted: data.id })
  } catch (err: unknown) {
    console.error('[axle-optimize] DELETE error:', err)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
