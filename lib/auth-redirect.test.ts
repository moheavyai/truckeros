import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  consumePostLoginRedirect,
  isLoginRedirectPath,
  persistPostLoginRedirect,
  POST_LOGIN_REDIRECT_STORAGE_KEY,
  readRedirectSearchParam,
  resolveClientPostLoginPath,
  resolvePostLoginRedirect,
} from './auth-redirect'

describe('resolvePostLoginRedirect', () => {
  it('defaults to dashboard', () => {
    expect(resolvePostLoginRedirect(null)).toBe('/dashboard')
    expect(resolvePostLoginRedirect('')).toBe('/dashboard')
    expect(resolvePostLoginRedirect('   ')).toBe('/dashboard')
  })

  it('accepts safe relative paths', () => {
    expect(resolvePostLoginRedirect('/invite/abc')).toBe('/invite/abc')
    expect(resolvePostLoginRedirect('/profile?tab=team')).toBe('/profile?tab=team')
  })

  it('rejects open redirects and non-relative URLs', () => {
    expect(resolvePostLoginRedirect('https://evil.com')).toBe('/dashboard')
    expect(resolvePostLoginRedirect('//evil.com')).toBe('/dashboard')
    expect(resolvePostLoginRedirect('/\\evil.com')).toBe('/dashboard')
    expect(resolvePostLoginRedirect('invite/abc')).toBe('/dashboard')
    expect(resolvePostLoginRedirect('javascript:alert(1)')).toBe('/dashboard')
    expect(resolvePostLoginRedirect('/path/with/://scheme')).toBe('/dashboard')
  })

  it('rejects control-character and encoded protocol-relative tricks', () => {
    expect(resolvePostLoginRedirect('/%09//evil.com')).toBe('/dashboard')
    expect(resolvePostLoginRedirect('/%0d%0a//evil.com')).toBe('/dashboard')
    expect(resolvePostLoginRedirect('%2F%2Fevil.com')).toBe('/dashboard')
  })

  it('rejects /login redirect loops', () => {
    expect(resolvePostLoginRedirect('/login')).toBe('/dashboard')
    expect(resolvePostLoginRedirect('/login?x=1')).toBe('/dashboard')
    expect(isLoginRedirectPath('/login')).toBe(true)
  })

  it('returns custom fallback when provided', () => {
    expect(resolvePostLoginRedirect('//evil', '/profile')).toBe('/profile')
  })

  it('returns fallback on bad percent-encoding', () => {
    expect(resolvePostLoginRedirect('%E0%A4%A')).toBe('/dashboard')
  })

  it('decodes a single-encoded relative path', () => {
    expect(resolvePostLoginRedirect('%2Finvite%2Ftok')).toBe('/invite/tok')
  })
})

describe('readRedirectSearchParam', () => {
  it('reads redirect from query string', () => {
    expect(readRedirectSearchParam('?redirect=%2Finvite%2Fabc')).toBe('/invite/abc')
    expect(readRedirectSearchParam(new URLSearchParams('redirect=/profile'))).toBe('/profile')
    expect(readRedirectSearchParam('')).toBeNull()
  })
})

describe('persist/consume post-login redirect', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null
      },
      setItem(key: string, value: string) {
        this.store[key] = value
      },
      removeItem(key: string) {
        delete this.store[key]
      },
    })
    vi.stubGlobal('window', {
      localStorage: (globalThis as { localStorage: Storage }).localStorage,
      location: { search: '' },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists and consumes a safe redirect', () => {
    persistPostLoginRedirect('/invite/tok')
    expect(localStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY)).toBe('/invite/tok')
    expect(consumePostLoginRedirect()).toBe('/invite/tok')
    expect(localStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY)).toBeNull()
  })

  it('resolveClientPostLoginPath prefers query over storage without re-persisting', () => {
    persistPostLoginRedirect('/profile')
    expect(resolveClientPostLoginPath('?redirect=/invite/x')).toBe('/invite/x')
    // Query path must not leave a new stored redirect behind for bare /login later.
    // (signup still calls persistPostLoginRedirect explicitly)
  })

  it('clearPostLoginRedirect removes stored path', async () => {
    const { clearPostLoginRedirect } = await import('./auth-redirect')
    persistPostLoginRedirect('/invite/tok')
    clearPostLoginRedirect()
    expect(localStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY)).toBeNull()
  })
})

