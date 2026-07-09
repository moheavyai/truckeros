import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH, POST } from './route'

vi.mock('@/lib/team-member-profiles-api', () => ({
  getAuthenticatedMemberProfile: vi.fn(),
}))

vi.mock('@/lib/invite-notifications', () => ({
  sendInviteNotifications: vi.fn(() => ({
    email: {
      channel: 'email',
      to: 'driver@example.com',
      role: 'Driver',
      invite_link: 'https://app.example.com/invite/test-token',
      sent: false,
      stubbed: true,
      body: 'email body',
    },
    sms: null,
  })),
}))

describe('/api/team-invites', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET returns 401 without bearer token', async () => {
    const response = await GET(new NextRequest('http://localhost/api/team-invites'))
    expect(response.status).toBe(401)
  })

  it('POST rejects Owner role invites', async () => {
    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')

    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: { from: vi.fn() } as never,
      userId: 'owner-1',
      profile: {
        user_id: 'owner-1',
        organization_id: 'org-1',
        is_primary_owner: true,
        user_roles: ['Owner'],
      } as never,
    })

    const response = await POST(
      new NextRequest('http://localhost/api/team-invites', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'Owner',
          invite_email: 'newowner@example.com',
        }),
      })
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toMatch(/cannot be assigned via invite/i)
  })

  it('POST returns email and sms notification shape on success', async () => {
    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')
    const { sendInviteNotifications } = await import('@/lib/invite-notifications')

    const updateEq = vi.fn().mockReturnThis()
    const updateIn = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({
      eq: updateEq,
      in: updateIn,
    }))

    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'invite-1',
        invite_token: 'test-token',
        invite_link: 'https://app.example.com/invite/test-token',
        role: 'Driver',
        invite_email: 'driver@example.com',
      },
      error: null,
    })
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))

    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: {
        from: vi.fn(() => ({
          update,
          insert,
        })),
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'owner-1', email: 'owner@example.com' } },
            error: null,
          }),
        },
      } as never,
      userId: 'owner-1',
      profile: {
        user_id: 'owner-1',
        organization_id: 'org-1',
        is_primary_owner: true,
        user_roles: ['Owner'],
      } as never,
    })

    const response = await POST(
      new NextRequest('http://localhost/api/team-invites', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'Driver',
          invite_email: 'driver@example.com',
        }),
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.email).toMatchObject({ channel: 'email', stubbed: true })
    expect(body.sms).toBeNull()
    expect(sendInviteNotifications).toHaveBeenCalled()
  })

  it('POST rejects self Permit Clerk invite by email with 403', async () => {
    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')

    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: {
        from: vi.fn(),
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'owner-1', email: 'owner@example.com', phone: null } },
            error: null,
          }),
        },
      } as never,
      userId: 'owner-1',
      profile: {
        user_id: 'owner-1',
        organization_id: 'org-1',
        is_primary_owner: true,
        user_roles: ['Owner'],
        driver_email: 'owner@example.com',
      } as never,
    })

    const response = await POST(
      new NextRequest('http://localhost/api/team-invites', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'Permit Clerk',
          invite_email: 'Owner@Example.com',
        }),
      })
    )

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toMatch(/yourself as Permit Clerk/i)
  })

  it('POST rejects phone-only self Permit Clerk invite with 403 when auth phone matches', async () => {
    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')

    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: {
        from: vi.fn(),
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'owner-1', email: 'owner@example.com', phone: '5551112222' } },
            error: null,
          }),
        },
      } as never,
      userId: 'owner-1',
      profile: {
        user_id: 'owner-1',
        organization_id: 'org-1',
        is_primary_owner: true,
        user_roles: ['Owner'],
      } as never,
    })

    const response = await POST(
      new NextRequest('http://localhost/api/team-invites', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'Permit Clerk',
          invite_phone: '(555) 111-2222',
        }),
      })
    )

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toMatch(/yourself as Permit Clerk/i)
  })

  it('POST fails when revoking prior email invites errors', async () => {
    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')

    const updateEq = vi.fn().mockReturnThis()
    const update = vi.fn(() => ({
      eq: updateEq.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: 'revoke failed' } }),
        }),
      }),
    }))

    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: {
        from: vi.fn(() => ({
          update,
          insert: vi.fn(),
        })),
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'owner-1', email: 'owner@example.com' } },
            error: null,
          }),
        },
      } as never,
      userId: 'owner-1',
      profile: {
        user_id: 'owner-1',
        organization_id: 'org-1',
        is_primary_owner: true,
        user_roles: ['Owner'],
      } as never,
    })

    const response = await POST(
      new NextRequest('http://localhost/api/team-invites', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'Driver',
          invite_email: 'driver@example.com',
        }),
      })
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('revoke failed')
  })

  it('PATCH returns 401 without bearer token', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost/api/team-invites', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'invite-1' }),
      })
    )
    expect(response.status).toBe(401)
  })

  it('POST rejects non-local Host when APP_URL unset (no Host-header phishing)', async () => {
    const prevApp = process.env.NEXT_PUBLIC_APP_URL
    const prevApp2 = process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.APP_URL

    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')
    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: { from: vi.fn() } as never,
      userId: 'owner-1',
      profile: {
        user_id: 'owner-1',
        organization_id: 'org-1',
        is_primary_owner: true,
        user_roles: ['Owner'],
      } as never,
    })

    try {
      const response = await POST(
        new NextRequest('https://localhost.evil.com/api/team-invites', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token-1',
            'Content-Type': 'application/json',
            Host: 'localhost.evil.com',
          },
          body: JSON.stringify({
            role: 'Driver',
            invite_email: 'driver@example.com',
          }),
        })
      )
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toMatch(/NEXT_PUBLIC_APP_URL|APP_URL/i)
    } finally {
      if (prevApp !== undefined) process.env.NEXT_PUBLIC_APP_URL = prevApp
      if (prevApp2 !== undefined) process.env.APP_URL = prevApp2
    }
  })
})

describe('isSafeLocalDevHost', () => {
  it('allows exact local hosts with optional port', async () => {
    const { isSafeLocalDevHost } = await import('./route')
    expect(isSafeLocalDevHost('localhost')).toBe(true)
    expect(isSafeLocalDevHost('localhost:3000')).toBe(true)
    expect(isSafeLocalDevHost('127.0.0.1')).toBe(true)
    expect(isSafeLocalDevHost('127.0.0.1:3000')).toBe(true)
    expect(isSafeLocalDevHost('[::1]')).toBe(true)
    expect(isSafeLocalDevHost('[::1]:3000')).toBe(true)
  })

  it('rejects localhost.evil.com and similar prefix tricks', async () => {
    const { isSafeLocalDevHost } = await import('./route')
    expect(isSafeLocalDevHost('localhost.evil.com')).toBe(false)
    expect(isSafeLocalDevHost('127.0.0.1.nip.io')).toBe(false)
    expect(isSafeLocalDevHost('evil.com')).toBe(false)
  })

  it('rejects userinfo / @ authority tricks', async () => {
    const { isSafeLocalDevHost } = await import('./route')
    expect(isSafeLocalDevHost('127.0.0.1:80@evil.com')).toBe(false)
    expect(isSafeLocalDevHost('localhost:3000@evil.com')).toBe(false)
    expect(isSafeLocalDevHost('user@localhost')).toBe(false)
  })
})
