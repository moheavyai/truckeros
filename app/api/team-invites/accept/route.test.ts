import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

vi.mock('@/lib/team-invite-accept', () => ({
  acceptTeamInviteForUser: vi.fn(),
  previewTeamInviteForUser: vi.fn(),
}))

vi.mock('@/lib/team-member-profiles-api', () => ({
  createAuthedSupabaseClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'driver@example.com' } },
        error: null,
      }),
    },
  })),
}))

describe('/api/team-invites/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POST returns 401 without bearer token', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/team-invites/accept', {
        method: 'POST',
        body: JSON.stringify({ token: 'abc' }),
      })
    )
    expect(response.status).toBe(401)
  })

  it('POST returns 400 when token missing in body', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/team-invites/accept', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
    )
    expect(response.status).toBe(400)
  })

  it('POST accepts invite via server handler with multi_org_join', async () => {
    const { acceptTeamInviteForUser } = await import('@/lib/team-invite-accept')

    vi.mocked(acceptTeamInviteForUser).mockResolvedValue({
      invite: {
        id: 'invite-1',
        organization_id: 'org-1',
        invited_by_user_id: 'owner-1',
        role: 'Driver',
        invite_token: 'abc',
        status: 'accepted',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
      multiOrgJoin: true,
    })

    const response = await POST(
      new NextRequest('http://localhost/api/team-invites/accept', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: 'abc' }),
      })
    )

    expect(response.status).toBe(200)
    expect(acceptTeamInviteForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        acceptorEmail: 'driver@example.com',
        token: 'abc',
      })
    )
    const body = await response.json()
    expect(body.data.multi_org_join).toBe(true)
  })

  it('POST maps email mismatch to uniform unavailable 404', async () => {
    const { acceptTeamInviteForUser } = await import('@/lib/team-invite-accept')
    vi.mocked(acceptTeamInviteForUser).mockRejectedValue(
      new Error('Sign in with the email address that received this invite')
    )

    const response = await POST(
      new NextRequest('http://localhost/api/team-invites/accept', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: 'abc' }),
      })
    )

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toMatch(/not found or no longer valid/i)
  })

  it('GET returns 401 without bearer token', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/team-invites/accept?token=abc')
    )
    expect(response.status).toBe(401)
  })

  it('GET returns 400 without token query', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/team-invites/accept', {
        headers: { Authorization: 'Bearer token-1' },
      })
    )
    expect(response.status).toBe(400)
  })

  it('GET previews invite via server handler', async () => {
    const { previewTeamInviteForUser } = await import('@/lib/team-invite-accept')

    vi.mocked(previewTeamInviteForUser).mockResolvedValue({
      id: 'invite-1',
      role: 'Driver',
      invite_email: 'driver@example.com',
      organization_id: 'org-1',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    })

    const response = await GET(
      new NextRequest('http://localhost/api/team-invites/accept?token=abc', {
        headers: { Authorization: 'Bearer token-1' },
      })
    )

    expect(response.status).toBe(200)
    expect(previewTeamInviteForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'abc',
        acceptorEmail: 'driver@example.com',
      })
    )
  })

  it('GET maps email mismatch to uniform 404', async () => {
    const { previewTeamInviteForUser } = await import('@/lib/team-invite-accept')
    vi.mocked(previewTeamInviteForUser).mockResolvedValue({
      id: 'invite-1',
      role: 'Driver',
      invite_email: 'other@example.com',
      organization_id: 'org-1',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    })

    const response = await GET(
      new NextRequest('http://localhost/api/team-invites/accept?token=abc', {
        headers: { Authorization: 'Bearer token-1' },
      })
    )

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toMatch(/not found or no longer valid/i)
  })
})
