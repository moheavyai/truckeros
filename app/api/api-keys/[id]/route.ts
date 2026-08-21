/**
 * PATCH /api/api-keys/[id]
 *
 * Supported actions:
 *   { "action": "revoke" }  — soft-revoke (sets revoked_at)
 *   { "action": "rename", "name": "..." }  — update display name
 *
 * DELETE /api/api-keys/[id]
 *   Hard-delete the key row (Owner/Admin only).
 *
 * Auth: Supabase user JWT. Owner/Admin on the key's organization.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

type MembershipRow = {
  organization_id: string
  role: string
  is_primary_owner: boolean | null
}

function isOwnerOrAdmin(m: MembershipRow): boolean {
  if (m.is_primary_owner) return true
  return m.role === 'Owner' || m.role === 'Admin'
}

async function resolveCallerContext(accessToken: string) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  })

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: 'Unauthorized', status: 401 as const }
  }

  const { data: profile } = await supabase
    .from('member_profiles')
    .select('organization_id, is_primary_owner')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: memberships } = await supabase
    .from('organization_memberships')
    .select('organization_id, role, is_primary_owner')
    .eq('user_id', user.id)
    .order('is_primary_owner', { ascending: false })
    .limit(20)

  const rows = (memberships || []) as MembershipRow[]
  const homeOrgId =
    (typeof profile?.organization_id === 'string' && profile.organization_id) ||
    rows.find((r) => r.is_primary_owner)?.organization_id ||
    rows[0]?.organization_id ||
    null

  if (!homeOrgId) {
    return { error: 'No organization found for this account', status: 403 as const }
  }

  const membership = rows.find((r) => r.organization_id === homeOrgId)
  if (!membership || !isOwnerOrAdmin(membership)) {
    return {
      error: 'Only Owner or Admin can manage API keys for this organization',
      status: 403 as const,
    }
  }

  return { supabase, user, organizationId: homeOrgId }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ error: 'Missing key id' }, { status: 400 })
    }

    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()

    const ctx = await resolveCallerContext(token)
    if ('error' in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status })
    }

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const action = typeof body.action === 'string' ? body.action : ''

    // Ensure the key belongs to the caller's org (defense in depth beyond RLS)
    const { data: existing, error: findErr } = await ctx.supabase
      .from('api_keys')
      .select('id, organization_id, revoked_at, name')
      .eq('id', id)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle()

    if (findErr || !existing) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }

    if (action === 'revoke') {
      if (existing.revoked_at) {
        return NextResponse.json({ ok: true, key: existing, message: 'Already revoked' })
      }

      const { data, error } = await ctx.supabase
        .from('api_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id)
        .eq('organization_id', ctx.organizationId)
        .select(
          'id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at, created_by_user_id'
        )
        .single()

      if (error) {
        console.error('[api-keys] revoke error:', error.message)
        return NextResponse.json({ error: 'Failed to revoke key' }, { status: 500 })
      }

      return NextResponse.json({ ok: true, key: data, message: 'Key revoked' })
    }

    if (action === 'rename') {
      const name =
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim().slice(0, 120)
          : null
      if (!name) {
        return NextResponse.json({ error: 'Name is required' }, { status: 400 })
      }

      const { data, error } = await ctx.supabase
        .from('api_keys')
        .update({ name })
        .eq('id', id)
        .eq('organization_id', ctx.organizationId)
        .select(
          'id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at, created_by_user_id'
        )
        .single()

      if (error) {
        console.error('[api-keys] rename error:', error.message)
        return NextResponse.json({ error: 'Failed to rename key' }, { status: 500 })
      }

      return NextResponse.json({ ok: true, key: data })
    }

    return NextResponse.json(
      { error: 'Unknown action. Use "revoke" or "rename".' },
      { status: 400 }
    )
  } catch (err: any) {
    console.error('[api-keys] PATCH error:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ error: 'Missing key id' }, { status: 400 })
    }

    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()

    const ctx = await resolveCallerContext(token)
    if ('error' in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status })
    }

    const { data: existing, error: findErr } = await ctx.supabase
      .from('api_keys')
      .select('id')
      .eq('id', id)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle()

    if (findErr || !existing) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }

    const { error } = await ctx.supabase
      .from('api_keys')
      .delete()
      .eq('id', id)
      .eq('organization_id', ctx.organizationId)

    if (error) {
      console.error('[api-keys] delete error:', error.message)
      return NextResponse.json({ error: 'Failed to delete key' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, message: 'Key deleted' })
  } catch (err: any) {
    console.error('[api-keys] DELETE error:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
