import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH, POST } from './route'

vi.mock('@/lib/team-member-profiles-api', () => ({
  getAuthenticatedMemberProfile: vi.fn(),
}))

vi.mock('@/lib/carrier-connection-invite-service', () => ({
  canCreateCarrierConnectionInvite: vi.fn(),
  createCarrierConnectionInvite: vi.fn(),
  fetchMembershipRolesForUser: vi.fn().mockResolvedValue([]),
  listOutgoingCarrierConnectionInvites: vi.fn(),
  revokeCarrierConnectionInvite: vi.fn(),
}))

describe('/api/carrier-connection-invites', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET returns 401 without bearer token', async () => {
    const response = await GET(new NextRequest('http://localhost/api/carrier-connection-invites'))
    expect(response.status).toBe(401)
  })

  it('GET passes membership roles into authz and list', async () => {
    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')
    const {
      canCreateCarrierConnectionInvite,
      fetchMembershipRolesForUser,
      listOutgoingCarrierConnectionInvites,
    } = await import('@/lib/carrier-connection-invite-service')

    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: { from: vi.fn() } as never,
      userId: 'clerk-1',
      profile: {
        user_id: 'clerk-1',
        user_roles: [],
        is_primary_owner: false,
      } as never,
    })
    vi.mocked(fetchMembershipRolesForUser).mockResolvedValue(['Permit Clerk'])
    vi.mocked(canCreateCarrierConnectionInvite).mockReturnValue(true)
    vi.mocked(listOutgoingCarrierConnectionInvites).mockResolvedValue([])

    const response = await GET(
      new NextRequest('http://localhost/api/carrier-connection-invites', {
        headers: { Authorization: 'Bearer token-1' },
      })
    )

    expect(response.status).toBe(200)
    expect(fetchMembershipRolesForUser).toHaveBeenCalled()
    expect(canCreateCarrierConnectionInvite).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'clerk-1' }),
      ['Permit Clerk']
    )
  })

  it('POST returns 403 for non-eligible roles', async () => {
    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')
    const { canCreateCarrierConnectionInvite } = await import(
      '@/lib/carrier-connection-invite-service'
    )

    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: { from: vi.fn() } as never,
      userId: 'driver-1',
      profile: {
        user_id: 'driver-1',
        organization_id: 'org-1',
        is_primary_owner: false,
        user_roles: ['Driver'],
      } as never,
    })
    vi.mocked(canCreateCarrierConnectionInvite).mockReturnValue(false)

    const response = await POST(
      new NextRequest('http://localhost/api/carrier-connection-invites', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          company_name: 'ABC',
          invite_email: 'owner@example.com',
        }),
      })
    )

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toMatch(/forbidden/i)
  })

  it('POST creates invite and returns notification shape', async () => {
    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')
    const {
      canCreateCarrierConnectionInvite,
      createCarrierConnectionInvite,
    } = await import('@/lib/carrier-connection-invite-service')

    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: { from: vi.fn() } as never,
      userId: 'clerk-1',
      profile: {
        user_id: 'clerk-1',
        organization_id: 'clerk-org',
        is_primary_owner: false,
        user_roles: ['Permit Clerk'],
      } as never,
    })
    vi.mocked(canCreateCarrierConnectionInvite).mockReturnValue(true)
    vi.mocked(createCarrierConnectionInvite).mockResolvedValue({
      invite: {
        id: 'inv-1',
        invited_by_user_id: 'clerk-1',
        organization_id: 'carrier-org',
        company_name: 'ABC Trucking',
        invite_email: 'owner@example.com',
        invite_token: 'tok',
        invite_link: 'https://app.example.com/carrier-invite/tok',
        status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
      email: {
        channel: 'email',
        to: 'owner@example.com',
        role: 'Carrier Owner',
        invite_link: 'https://app.example.com/carrier-invite/tok',
        sent: false,
        stubbed: true,
        body: 'email body',
      },
      sms: null,
    })

    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'

    const response = await POST(
      new NextRequest('http://localhost/api/carrier-connection-invites', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          company_name: 'ABC Trucking',
          invite_email: 'owner@example.com',
        }),
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.data.company_name).toBe('ABC Trucking')
    expect(body.email.stubbed).toBe(true)
    expect(createCarrierConnectionInvite).toHaveBeenCalled()
  })

  it('PATCH revokes pending invite', async () => {
    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')
    const {
      canCreateCarrierConnectionInvite,
      revokeCarrierConnectionInvite,
    } = await import('@/lib/carrier-connection-invite-service')

    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: { from: vi.fn() } as never,
      userId: 'clerk-1',
      profile: {
        user_id: 'clerk-1',
        user_roles: ['Permit Clerk'],
      } as never,
    })
    vi.mocked(canCreateCarrierConnectionInvite).mockReturnValue(true)
    vi.mocked(revokeCarrierConnectionInvite).mockResolvedValue({
      id: 'inv-1',
      status: 'revoked',
    } as never)

    const response = await PATCH(
      new NextRequest('http://localhost/api/carrier-connection-invites', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: 'inv-1' }),
      })
    )

    expect(response.status).toBe(200)
    expect(revokeCarrierConnectionInvite).toHaveBeenCalledWith({
      invitedByUserId: 'clerk-1',
      inviteId: 'inv-1',
    })
  })
})
