import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

vi.mock('@/lib/team-member-profiles-api', () => ({
  createAuthedSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/carrier-connection-invite-service', () => ({
  acceptCarrierConnectionInviteForUser: vi.fn(),
  previewCarrierConnectionInviteForUser: vi.fn(),
  CARRIER_CONNECTION_INVITE_UNAVAILABLE_MESSAGE: 'Invite not found or no longer valid',
}))

describe('/api/carrier-connection-invites/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET requires auth', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/carrier-connection-invites/accept?token=abc'
      )
    )
    expect(response.status).toBe(401)
  })

  it('GET returns 400 when token query is missing', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/carrier-connection-invites/accept', {
        headers: { Authorization: 'Bearer token-1' },
      })
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/missing invite token/i)
  })

  it('POST returns 400 when token body is missing', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')
    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'u1', email: 'owner@example.com' } },
          error: null,
        }),
      },
    } as never)

    const response = await POST(
      new NextRequest('http://localhost/api/carrier-connection-invites/accept', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/missing invite token/i)
  })

  it('GET returns preview for matching user', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')
    const { previewCarrierConnectionInviteForUser } = await import(
      '@/lib/carrier-connection-invite-service'
    )

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'u1', email: 'owner@example.com' } },
          error: null,
        }),
      },
    } as never)

    vi.mocked(previewCarrierConnectionInviteForUser).mockResolvedValue({
      id: 'inv-1',
      company_name: 'ABC Trucking',
      usdot_number: '123',
      invite_email: 'owner@example.com',
      organization_id: 'org-1',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    })

    const response = await GET(
      new NextRequest(
        'http://localhost/api/carrier-connection-invites/accept?token=tok',
        {
          headers: { Authorization: 'Bearer token-1' },
        }
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.company_name).toBe('ABC Trucking')
  })

  it('GET maps email mismatch to unavailable message', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')
    const { previewCarrierConnectionInviteForUser } = await import(
      '@/lib/carrier-connection-invite-service'
    )

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'u1', email: 'other@example.com' } },
          error: null,
        }),
      },
    } as never)

    // Admin-style preview that would surface invite; route re-validates email.
    vi.mocked(previewCarrierConnectionInviteForUser).mockResolvedValue({
      id: 'inv-1',
      company_name: 'ABC Trucking',
      invite_email: 'owner@example.com',
      organization_id: 'org-1',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    })

    const response = await GET(
      new NextRequest(
        'http://localhost/api/carrier-connection-invites/accept?token=tok',
        {
          headers: { Authorization: 'Bearer token-1' },
        }
      )
    )

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toMatch(/not found or no longer valid/i)
  })

  it('POST accepts connection', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')
    const { acceptCarrierConnectionInviteForUser } = await import(
      '@/lib/carrier-connection-invite-service'
    )

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'u1', email: 'owner@example.com' } },
          error: null,
        }),
      },
    } as never)

    vi.mocked(acceptCarrierConnectionInviteForUser).mockResolvedValue({
      invite: {
        id: 'inv-1',
        invited_by_user_id: 'clerk-1',
        company_name: 'ABC',
        invite_token: 'tok',
        status: 'accepted',
        organization_id: 'org-1',
        expires_at: new Date().toISOString(),
      },
      multiOrgJoin: false,
      organizationId: 'org-1',
    })

    const response = await POST(
      new NextRequest('http://localhost/api/carrier-connection-invites/accept', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: 'tok' }),
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.organization_id).toBe('org-1')
    expect(body.data.multi_org_join).toBe(false)
  })

  it('POST maps email mismatch to uniform unavailable', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')
    const { acceptCarrierConnectionInviteForUser } = await import(
      '@/lib/carrier-connection-invite-service'
    )

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'u1', email: 'other@example.com' } },
          error: null,
        }),
      },
    } as never)

    vi.mocked(acceptCarrierConnectionInviteForUser).mockRejectedValue(
      new Error('Sign in with the email address that received this invite')
    )

    const response = await POST(
      new NextRequest('http://localhost/api/carrier-connection-invites/accept', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: 'tok' }),
      })
    )

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toMatch(/not found or no longer valid/i)
  })

  it('POST maps primary-owner defense failure to 409 with stable message', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')
    const { acceptCarrierConnectionInviteForUser } = await import(
      '@/lib/carrier-connection-invite-service'
    )

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'u1', email: 'owner@example.com' } },
          error: null,
        }),
      },
    } as never)

    vi.mocked(acceptCarrierConnectionInviteForUser).mockRejectedValue(
      new Error('This carrier already has a primary owner')
    )

    const response = await POST(
      new NextRequest('http://localhost/api/carrier-connection-invites/accept', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: 'tok' }),
      })
    )

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toMatch(/not found or no longer valid/i)
  })

  it('POST redacts invite_token from success response', async () => {
    const { createAuthedSupabaseClient } = await import('@/lib/team-member-profiles-api')
    const { acceptCarrierConnectionInviteForUser } = await import(
      '@/lib/carrier-connection-invite-service'
    )

    vi.mocked(createAuthedSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'u1', email: 'owner@example.com' } },
          error: null,
        }),
      },
    } as never)

    vi.mocked(acceptCarrierConnectionInviteForUser).mockResolvedValue({
      invite: {
        id: 'inv-1',
        invited_by_user_id: 'clerk-1',
        company_name: 'ABC',
        invite_email: 'owner@example.com',
        invite_token: 'secret-token',
        status: 'accepted',
        organization_id: 'org-1',
        expires_at: new Date().toISOString(),
      },
      multiOrgJoin: false,
      organizationId: 'org-1',
    })

    const response = await POST(
      new NextRequest('http://localhost/api/carrier-connection-invites/accept', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: 'tok' }),
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).not.toHaveProperty('invite_token')
    expect(body.data.organization_id).toBe('org-1')
  })
})
