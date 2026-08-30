import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { hashEmailToken } from '@/lib/email-verification-crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const BAD_TOKEN_MESSAGE = 'This confirmation link is invalid or has expired. Request a new email from Profile.'

function redirectTo(origin: string, path: string) {
  return NextResponse.redirect(new URL(path, origin))
}

async function hasSessionUser(): Promise<boolean> {
  try {
    const supabase = await createServerSupabase()
    const { data } = await supabase.auth.getUser()
    return Boolean(data.user)
  } catch {
    return false
  }
}

/** GET ?token= — hash-only consume. Session optional (email client may be another browser). */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin
  const rawToken = (request.nextUrl.searchParams.get('token') || '').trim()
  const signedIn = await hasSessionUser()

  if (!rawToken) {
    return signedIn
      ? redirectTo(origin, '/profile?verify_error=1')
      : redirectTo(origin, `/login?error=${encodeURIComponent(BAD_TOKEN_MESSAGE)}`)
  }

  const anon = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  })
  const tokenHash = hashEmailToken(rawToken)
  const { data, error } = await anon.rpc('consume_email_verification_token', {
    p_token_hash: tokenHash,
  })

  const consumed = Array.isArray(data)
    ? Boolean((data[0] as { ok?: boolean } | undefined)?.ok)
    : Boolean((data as { ok?: boolean } | null)?.ok)

  if (error || !consumed) {
    return signedIn
      ? redirectTo(origin, '/profile?verify_error=1')
      : redirectTo(origin, `/login?error=${encodeURIComponent(BAD_TOKEN_MESSAGE)}`)
  }

  return signedIn
    ? redirectTo(origin, '/profile?verified=1')
    : redirectTo(origin, '/login?confirmed=1')
}
