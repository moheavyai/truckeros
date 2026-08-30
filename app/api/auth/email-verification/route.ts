import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isDevEnvironment } from '@/lib/dev-mode'
import {
  EMAIL_VERIFY_ALREADY_CONFIRMED,
  EMAIL_VERIFY_COOLDOWN_MESSAGE,
  EMAIL_VERIFY_FROM,
  EMAIL_VERIFY_NOT_CONFIGURED,
  EMAIL_VERIFY_TOKEN_TTL_MS,
  buildConfirmEmailMessage,
  buildConfirmEmailUrl,
  generateEmailToken,
  hashEmailToken,
  isEmailVerified,
  isEmailVerifyCooldownActive,
  resolveEmailVerifyOrigin,
} from '@/lib/email-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function userClient(accessToken: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  })
}

function bearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length).trim()
  return token || null
}

async function sendResendEmail(params: {
  to: string
  confirmUrl: string
}): Promise<{ ok: boolean; status: number; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { ok: false, status: 503, error: EMAIL_VERIFY_NOT_CONFIGURED }
  }
  const { text, html } = buildConfirmEmailMessage(params.confirmUrl)
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_VERIFY_FROM,
      to: params.to,
      subject: 'Confirm your MoHeavy AI email',
      text,
      html,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { ok: false, status: 502, error: detail || 'Failed to send confirmation email.' }
  }
  return { ok: true, status: 200 }
}

/** GET — verification status for the signed-in login email. Never returns token_hash. */
export async function GET(request: NextRequest) {
  const token = bearerToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = userClient(token)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: row } = await supabase
    .from('email_verifications')
    .select('email, verified_at, last_sent_at')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({
    email: row?.email || user.email || null,
    verified: isEmailVerified(row),
    verified_at: row?.verified_at ?? null,
    last_sent_at: row?.last_sent_at ?? null,
  })
}

/** POST { action: 'send' } — upsert hash-only token and email the confirm link. */
export async function POST(request: NextRequest) {
  const token = bearerToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { action?: string } = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  if (body.action !== 'send') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  const supabase = userClient(token)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.email) {
    return NextResponse.json({ error: 'This account has no login email.' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('email_verifications')
    .select('email, verified_at, last_sent_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (isEmailVerified(existing)) {
    return NextResponse.json({
      ok: true,
      verified: true,
      message: EMAIL_VERIFY_ALREADY_CONFIRMED,
    })
  }

  if (isEmailVerifyCooldownActive(existing?.last_sent_at)) {
    return NextResponse.json({ error: EMAIL_VERIFY_COOLDOWN_MESSAGE }, { status: 429 })
  }

  const rawToken = generateEmailToken()
  const tokenHash = hashEmailToken(rawToken)
  const now = new Date()
  const expires = new Date(now.getTime() + EMAIL_VERIFY_TOKEN_TTL_MS)

  const { error: upsertError } = await supabase.from('email_verifications').upsert(
    {
      user_id: user.id,
      email: user.email,
      token_hash: tokenHash,
      token_expires_at: expires.toISOString(),
      last_sent_at: now.toISOString(),
      updated_at: now.toISOString(),
    },
    { onConflict: 'user_id' }
  )

  if (upsertError) {
    console.warn('[email-verification] upsert failed', upsertError.message)
    return NextResponse.json({ error: 'Could not start email confirmation.' }, { status: 500 })
  }

  const origin = resolveEmailVerifyOrigin(request.nextUrl.origin)
  const confirmUrl = buildConfirmEmailUrl(origin, rawToken)
  if (isDevEnvironment()) {
    console.info('[email-verification] confirm URL', confirmUrl)
  }

  const sent = await sendResendEmail({ to: user.email, confirmUrl })
  if (!sent.ok) {
    return NextResponse.json(
      { error: sent.error || EMAIL_VERIFY_NOT_CONFIGURED },
      { status: sent.status }
    )
  }

  return NextResponse.json({ ok: true, verified: false, last_sent_at: now.toISOString() })
}
