import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockMaybeSingle = vi.fn()
const mockUpsert = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      if (table !== 'email_verifications') throw new Error(`unexpected table ${table}`)
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: mockMaybeSingle,
          })),
        })),
        upsert: mockUpsert,
      }
    }),
  })),
}))

vi.mock('@/lib/dev-mode', () => ({
  isDevEnvironment: () => false,
}))

function makeGet() {
  return new NextRequest('http://localhost/api/auth/email-verification', {
    headers: { Authorization: 'Bearer test-token' },
  })
}

function makeSend() {
  return new NextRequest('http://localhost/api/auth/email-verification', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'send' }),
  })
}

describe('/api/auth/email-verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@example.com' } } })
    mockUpsert.mockResolvedValue({ error: null })
  })

  it('GET never includes token_hash', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        email: 'a@example.com',
        verified_at: null,
        last_sent_at: '2026-08-20T12:00:00.000Z',
        token_hash: 'should-not-leak',
      },
      error: null,
    })
    const { GET } = await import('./route')
    const response = await GET(makeGet())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      email: 'a@example.com',
      verified: false,
      verified_at: null,
      last_sent_at: '2026-08-20T12:00:00.000Z',
    })
    expect(JSON.stringify(body)).not.toContain('token_hash')
    expect(JSON.stringify(body)).not.toContain('should-not-leak')
  })

  it('POST send short-circuits when already verified', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { email: 'a@example.com', verified_at: '2026-08-01T00:00:00.000Z', last_sent_at: null },
      error: null,
    })
    const { POST } = await import('./route')
    const response = await POST(makeSend())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.verified).toBe(true)
    expect(body.message).toMatch(/already confirmed/i)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(JSON.stringify(body)).not.toContain('token_hash')
  })

  it('POST send returns 429 while cooldown is active', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        email: 'a@example.com',
        verified_at: null,
        last_sent_at: new Date().toISOString(),
      },
      error: null,
    })
    const { POST } = await import('./route')
    const response = await POST(makeSend())
    expect(response.status).toBe(429)
    const body = await response.json()
    expect(body.error).toMatch(/wait a minute/i)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(JSON.stringify(body)).not.toContain('token_hash')
  })
})
