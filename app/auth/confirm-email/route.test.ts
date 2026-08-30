import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockRpc = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    rpc: mockRpc,
  })),
}))

describe('GET /auth/confirm-email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: null } })
    mockRpc.mockResolvedValue({ data: [{ ok: true }], error: null })
  })

  it('redirects missing token to login error when signed out', async () => {
    const { GET } = await import('./route')
    const response = await GET(new NextRequest('http://localhost/auth/confirm-email'))
    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)
    const location = response.headers.get('location') || ''
    expect(location).toContain('/login?error=')
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('redirects missing token to profile verify_error when signed in', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    const { GET } = await import('./route')
    const response = await GET(new NextRequest('http://localhost/auth/confirm-email'))
    const location = response.headers.get('location') || ''
    expect(location).toContain('/profile?verify_error=1')
  })

  it('happy path redirects to login confirmed when no session', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost/auth/confirm-email?token=raw-token-value')
    )
    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)
    const location = response.headers.get('location') || ''
    expect(location).toContain('/login?confirmed=1')
    expect(mockRpc).toHaveBeenCalledWith(
      'consume_email_verification_token',
      expect.objectContaining({ p_token_hash: expect.any(String) })
    )
  })

  it('happy path redirects to profile verified when session exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost/auth/confirm-email?token=raw-token-value')
    )
    const location = response.headers.get('location') || ''
    expect(location).toContain('/profile?verified=1')
  })
})
