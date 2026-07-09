/**
 * Reject cross-origin POSTs that could trigger cookie-authenticated actions (CSRF).
 * Same-origin browser requests include Origin matching Host; Supabase auth cookies
 * also use SameSite=Lax, which blocks cross-site POSTs from carrying the session.
 */
export function isSameOriginPostRequest(request: Request): boolean {
  const host = request.headers.get('host')
  if (!host) {
    return false
  }

  const origin = request.headers.get('origin')
  if (origin) {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }

  const referer = request.headers.get('referer')
  if (referer) {
    try {
      return new URL(referer).host === host
    } catch {
      return false
    }
  }

  // Non-browser clients (curl, scripts) may omit Origin/Referer.
  return true
}
