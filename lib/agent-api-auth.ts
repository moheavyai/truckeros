/**
 * lib/agent-api-auth.ts
 *
 * Authentication helper for the external Agent API (/api/v1/tools/*).
 *
 * Supports two callers:
 *   1. API key  – Authorization: Bearer mh_live_...  (or mh_test_...)
 *   2. User JWT – Authorization: Bearer <supabase access token>
 *                 (same path the rest of the app already uses)
 *
 * Design:
 *   - API keys are org-scoped. A successful key auth returns organization_id + scopes.
 *   - Raw keys are never stored. We store only key_prefix + SHA-256 hash.
 *   - Scopes gate which tools a key may call. First scope: "analyze_permit".
 *
 * Security notes:
 *   - Always prefer the organization_id returned by this helper over any client-supplied value.
 *   - Service-role client is used only for key lookup (bypasses RLS by design).
 *   - last_used_at is updated asynchronously so auth stays fast.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'

export type AgentScope = 'analyze_permit' // expand later

export interface AgentAuthSuccess {
  ok: true
  kind: 'api_key' | 'user_jwt'
  organizationId: string | null
  userId: string | null
  apiKeyId: string | null
  scopes: string[]
  /** Full Supabase access token when kind === 'user_jwt' (for downstream calls that need it). */
  accessToken?: string
}

export interface AgentAuthFailure {
  ok: false
  status: 401 | 403
  error: string
}

export type AgentAuthResult = AgentAuthSuccess | AgentAuthFailure

const KEY_PREFIX_RE = /^mh_(live|test)_[A-Za-z0-9_-]{6,}/

/** Generate a new API key. Returns the raw key (show once) + the values to store. */
export function generateApiKey(env: 'live' | 'test' = 'live'): {
  rawKey: string
  keyPrefix: string
  keyHash: string
} {
  const secret = randomBytes(24).toString('hex') // 48 hex chars, URL-safe
  const rawKey = `mh_${env}_${secret}`
  const keyPrefix = rawKey.slice(0, 16) // e.g. mh_live_xxxxxxxxxxxx
  const keyHash = hashApiKey(rawKey)
  return { rawKey, keyPrefix, keyHash }
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'hex')
    const bufB = Buffer.from(b, 'hex')
    if (bufA.length !== bufB.length) return false
    return timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

/**
 * Resolve Authorization header into a trusted AgentAuthResult.
 *
 * Usage in a route:
 *   const auth = await authenticateAgentRequest(request)
 *   if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
 *   if (!auth.scopes.includes('analyze_permit')) ...
 */
export async function authenticateAgentRequest(
  request: Request
): Promise<AgentAuthResult> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return {
      ok: false,
      status: 401,
      error: 'Missing or invalid Authorization header. Expected Bearer <token>.',
    }
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return { ok: false, status: 401, error: 'Empty bearer token.' }
  }

  // ---------- API key path ----------
  if (KEY_PREFIX_RE.test(token)) {
    return authenticateApiKey(token)
  }

  // ---------- User JWT path (existing app pattern) ----------
  return authenticateUserJwt(token)
}

async function authenticateApiKey(rawKey: string): Promise<AgentAuthResult> {
  if (!supabaseAdmin) {
    console.error('[agent-api-auth] SUPABASE_SERVICE_ROLE_KEY is not configured')
    return {
      ok: false,
      status: 401,
      error: 'API key authentication is not available on this server.',
    }
  }

  const keyPrefix = rawKey.slice(0, 16)
  const presentedHash = hashApiKey(rawKey)

  const { data: row, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, organization_id, key_hash, scopes, revoked_at, expires_at')
    .eq('key_prefix', keyPrefix)
    .maybeSingle()

  if (error) {
    console.error('[agent-api-auth] api_keys lookup error:', error.message)
    return { ok: false, status: 401, error: 'Invalid API key.' }
  }

  if (!row) {
    return { ok: false, status: 401, error: 'Invalid API key.' }
  }

  if (row.revoked_at) {
    return { ok: false, status: 401, error: 'API key has been revoked.' }
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { ok: false, status: 401, error: 'API key has expired.' }
  }

  if (!safeEqualHex(presentedHash, row.key_hash)) {
    return { ok: false, status: 401, error: 'Invalid API key.' }
  }

  // Fire-and-forget last_used_at update (do not block the request)
  void supabaseAdmin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(({ error: updErr }) => {
      if (updErr) console.warn('[agent-api-auth] last_used_at update failed:', updErr.message)
    })

  const scopes: string[] = Array.isArray(row.scopes) ? row.scopes : ['analyze_permit']

  return {
    ok: true,
    kind: 'api_key',
    organizationId: row.organization_id,
    userId: null,
    apiKeyId: row.id,
    scopes,
  }
}

async function authenticateUserJwt(accessToken: string): Promise<AgentAuthResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  })

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { ok: false, status: 401, error: 'Invalid or expired authentication token.' }
  }

  // Resolve primary organization for the user (best-effort).
  // For pure analysis tools this is informational; write paths will re-validate.
  let organizationId: string | null = null
  try {
    const { data: membership } = await supabase
      .from('organization_memberships')
      .select('organization_id, is_primary_owner, role')
      .eq('user_id', user.id)
      .order('is_primary_owner', { ascending: false })
      .limit(1)
      .maybeSingle()

    organizationId = membership?.organization_id ?? null
  } catch {
    // Non-fatal for read-only tools
  }

  // User JWTs are treated as having full analyze_permit scope for now.
  // (They are already authenticated members of the product.)
  return {
    ok: true,
    kind: 'user_jwt',
    organizationId,
    userId: user.id,
    apiKeyId: null,
    scopes: ['analyze_permit'],
    accessToken,
  }
}

/**
 * Record a usage event. Best-effort; never throws to the caller.
 */
export async function recordAgentUsage(params: {
  organizationId: string | null
  apiKeyId: string | null
  tool: string
  statusCode: number
  latencyMs: number
  requestId?: string | null
}): Promise<void> {
  if (!supabaseAdmin || !params.organizationId) return

  try {
    await supabaseAdmin.from('agent_api_usage').insert({
      organization_id: params.organizationId,
      api_key_id: params.apiKeyId,
      tool: params.tool,
      status_code: params.statusCode,
      latency_ms: params.latencyMs,
      request_id: params.requestId ?? null,
    })
  } catch (err: any) {
    console.warn('[agent-api-auth] usage log failed:', err?.message)
  }
}
