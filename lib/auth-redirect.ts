/**
 * Safe post-login redirect helpers.
 * Only allows same-origin relative paths (blocks open redirects).
 */

/** Default home when onboarding is complete and no invite/explicit redirect is present. */
export const DEFAULT_POST_LOGIN_PATH = '/dashboard'

export const POST_LOGIN_REDIRECT_STORAGE_KEY = 'truckeros_post_login_redirect'

const C0_AND_DEL = /[\u0000-\u001f\u007f]/

/**
 * True when the path targets the login page (would loop when already authenticated).
 */
export function isLoginRedirectPath(pathname: string): boolean {
  const pathOnly = pathname.split('?')[0]?.split('#')[0] ?? ''
  return pathOnly === '/login' || pathOnly.startsWith('/login/')
}

/**
 * Returns a safe in-app path from a raw redirect query value, or the default.
 * Rejects protocol-relative URLs, external URLs, login loops, and control chars.
 */
export function resolvePostLoginRedirect(
  raw: string | null | undefined,
  fallback: string = DEFAULT_POST_LOGIN_PATH
): string {
  if (raw == null) return fallback

  let candidate = String(raw).trim()
  if (!candidate) return fallback

  // Decode once if the value was percent-encoded (common with nested redirects).
  try {
    if (candidate.includes('%')) {
      candidate = decodeURIComponent(candidate)
    }
  } catch {
    return fallback
  }

  candidate = candidate.trim()

  // Reject C0 controls / DEL (e.g. /%09//evil.com after decode).
  if (C0_AND_DEL.test(candidate)) return fallback

  // Must be a root-relative path
  if (!candidate.startsWith('/')) return fallback
  // Block protocol-relative and scheme URLs (//evil.com, /\\evil.com)
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return fallback
  if (candidate.includes('://')) return fallback
  // Block backslash tricks
  if (candidate.includes('\\')) return fallback

  // Avoid /login ↔ /login redirect loops when already authenticated
  if (isLoginRedirectPath(candidate)) return fallback

  return candidate
}

export function readRedirectSearchParam(
  search: string | URLSearchParams | null | undefined
): string | null {
  if (!search) return null
  const params =
    typeof search === 'string'
      ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      : search
  const value = params.get('redirect')
  return value?.trim() ? value : null
}

/** Persist a safe redirect for post-signup confirmation flows. */
export function persistPostLoginRedirect(raw: string | null | undefined): void {
  if (typeof window === 'undefined') return
  const safe = resolvePostLoginRedirect(raw, '')
  if (!safe || safe === DEFAULT_POST_LOGIN_PATH) {
    window.localStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(POST_LOGIN_REDIRECT_STORAGE_KEY, safe)
}

/** Clear any persisted post-login redirect (call after successful login). */
export function clearPostLoginRedirect(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY)
}

/** Read and clear a previously persisted post-login redirect. */
export function consumePostLoginRedirect(): string | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY)
  if (raw) {
    window.localStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY)
  }
  const safe = resolvePostLoginRedirect(raw, '')
  return safe && safe !== DEFAULT_POST_LOGIN_PATH ? safe : null
}

/**
 * Resolve client post-login path: query redirect wins, then stored signup redirect.
 * Does not re-persist query redirects (signup calls persistPostLoginRedirect explicitly).
 */
export function resolveClientPostLoginPath(search?: string | null): string {
  if (typeof window === 'undefined') return DEFAULT_POST_LOGIN_PATH
  const queryRaw = readRedirectSearchParam(search ?? window.location.search)
  if (queryRaw) {
    return resolvePostLoginRedirect(queryRaw)
  }
  return consumePostLoginRedirect() ?? DEFAULT_POST_LOGIN_PATH
}
