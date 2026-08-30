import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAuthCallbackNext } from '@/lib/auth-redirect'

export const dynamic = 'force-dynamic'

function loginErrorRedirect(origin: string, message: string): NextResponse {
  const dest = new URL('/login', origin)
  dest.searchParams.set('error', message)
  return NextResponse.redirect(dest)
}

/**
 * Exchanges the Supabase PKCE `code` from confirmation / reset / magic links.
 * Without this route, those emails dump `?code=` onto /login and never create a session.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const type = (searchParams.get('type') || '').toLowerCase()
  const providerError =
    searchParams.get('error_description') || searchParams.get('error')
  const next = resolveAuthCallbackNext(searchParams.get('next'))

  if (providerError) {
    return loginErrorRedirect(origin, providerError)
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.warn('[auth/callback] exchangeCodeForSession failed', error.message)
      return loginErrorRedirect(
        origin,
        error.message || 'Could not complete email confirmation. Try signing in, or resend the link.'
      )
    }
  }

  if (type === 'recovery' || type === 'password_recovery') {
    const dest = new URL('/login', origin)
    dest.searchParams.set('mode', 'recovery')
    return NextResponse.redirect(dest)
  }

  if (!code && (type === 'signup' || type === 'email')) {
    const dest = new URL('/login', origin)
    dest.searchParams.set('confirmed', '1')
    return NextResponse.redirect(dest)
  }

  return NextResponse.redirect(new URL(next, origin))
}
