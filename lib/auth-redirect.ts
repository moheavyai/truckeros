/**
 * Safe post-login redirect helpers.
 * Only allows same-origin relative paths (blocks open redirects).
 */

/** Default home when onboarding is complete and no invite/explicit redirect is present. */
export const DEFAULT_POST_LOGIN_PATH = '/dashboard'

export const POST_LOGIN_REDIRECT_STORAGE_KEY = 'truckeros_post_login_redirect'

/** Route that exchanges the Supabase PKCE `code` for a session. */
export const AUTH_CALLBACK_PATH = '/auth/callback'

const C0_AND_DEL = /[\u0000-\u001f\u007f]/

/**
 * True when the path targets the login page (would loop when already authenticated).
 */
export function isLoginRedirectPath(pathname: string): boolean {
  const pathOnly = pathname.split('?')[0]?.split('#')[0] ?? ''
  return pathOnly === '/login' || pathOnly.startsWith('/login/')
}

function sanitizeRelativePath(
  raw: string | null | undefined,
  fallback: string
): string {
  if (raw == null) return fallback

  let candidate = String(raw).trim()
  if (!candidate) return fallback

  try {
    if (candidate.includes('%')) {
      candidate = decodeURIComponent(candidate)
    }
  } catch {
    return fallback
  }

  candidate = candidate.trim()

  if (C0_AND_DEL.test(candidate)) return fallback
  if (!candidate.startsWith('/')) return fallback
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return fallback
  if (candidate.includes('://')) return fallback
  if (candidate.includes('\\')) return fallback

  return candidate
}

/**
 * Returns a safe in-app path from a raw redirect query value, or the default.
 * Rejects protocol-relative URLs, external URLs, login loops, and control chars.
 */
export function resolvePostLoginRedirect(
  raw: string | null | undefined,
  fallback: string = DEFAULT_POST_LOGIN_PATH
): string {
  const candidate = sanitizeRelativePath(raw, fallback)
  if (candidate !== fallback && isLoginRedirectPath(candidate)) return fallback
  return candidate
}

/**
 * Safe destination after `/auth/callback` exchanges a PKCE code.
 * Allows `/login` (needed so recovery + confirmation land on the form).
 */
export function resolveAuthCallbackNext(raw: string | null | undefined): string {
  return sanitizeRelativePath(raw, '/login')
}

export type AuthEmailRedirectType = 'signup' | 'recovery'

/**
 * Builds the URL we pass to Supabase as emailRedirectTo / reset redirectTo.
 * Always points at `/auth/callback` so the PKCE `code` is exchanged server-side.
 */
export function buildEmailRedirectTo(
  origin: string,
  options?: { next?: string | null; type?: AuthEmailRedirectType }
): string {
  const url = new URL(AUTH_CALLBACK_PATH, origin)
  if (options?.type) url.searchParams.set('type', options.type)
  const next = resolveAuthCallbackNext(options?.next ?? null)
  if (next && next !== '/login') url.searchParams.set('next', next)
  return url.toString()
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
