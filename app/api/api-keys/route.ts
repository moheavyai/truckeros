/**
 * GET  /api/api-keys  — list API keys for the caller's home organization
 * POST /api/api-keys  — create a new key (returns raw key once)
 *
 * Auth: Supabase user JWT (Authorization: Bearer <access_token>)
 * Authorization: Owner or Admin membership on the target organization only.
 *
 * Security:
 *   - Raw key is generated server-side and returned exactly once on create.
 *   - Only key_prefix + key_hash are stored.
 *   - RLS on api_keys is the final DB gate; we also enforce role checks here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateApiKey } from '@/lib/agent-api-auth'

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

  // Prefer home org from member_profiles, fall back to primary-owner membership
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

  return {
    supabase,
    user,
    organizationId: homeOrgId,
  }
}

/** GET — list keys (never includes hash or raw secret) */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()

    const ctx = await resolveCallerContext(token)
    if ('error' in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status })
    }

    const { data, error } = await ctx.supabase
      .from('api_keys')
      .select(
        'id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at, created_by_user_id'
      )
      .eq('organization_id', ctx.organizationId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[api-keys] list error:', error.message)
      return NextResponse.json({ error: 'Failed to list API keys' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      organization_id: ctx.organizationId,
      keys: data || [],
    })
  } catch (err: any) {
    console.error('[api-keys] GET error:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}

/** POST — create key; returns raw_key exactly once */
export async function POST(request: NextRequest) {
  try {
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
      body = {}
    }

    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim().slice(0, 120)
        : 'API key'

    const env: 'live' | 'test' = body.env === 'test' ? 'test' : 'live'

    // Scopes: only allow known values for now
    const requestedScopes = Array.isArray(body.scopes) ? body.scopes : ['analyze_permit']
    const scopes = requestedScopes
      .filter((s: unknown) => s === 'analyze_permit')
      .slice(0, 10)
    if (scopes.length === 0) scopes.push('analyze_permit')

    const { rawKey, keyPrefix, keyHash } = generateApiKey(env)

    const { data, error } = await ctx.supabase
      .from('api_keys')
      .insert({
        organization_id: ctx.organizationId,
        name,
        key_prefix: keyPrefix,
        key_hash: keyHash,
        scopes,
        created_by_user_id: ctx.user.id,
      })
      .select(
        'id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at, created_by_user_id'
      )
      .single()

    if (error) {
      console.error('[api-keys] create error:', error.message)
      return NextResponse.json(
        { error: error.message || 'Failed to create API key' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      key: data,
      /** Shown only in this response. Store it now — it cannot be recovered later. */
      raw_key: rawKey,
      warning:
        'Copy this key now. For security it is never shown again and cannot be recovered.',
    })
  } catch (err: any) {
    console.error('[api-keys] POST error:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
