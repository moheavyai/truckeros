import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH, POST } from './route'

vi.mock('@/lib/profile-change-requests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/profile-change-requests')>()
  return {
    ...actual,
    listPendingProfileChangeRequestsForOrg: vi.fn(),
    reviewProfileChangeRequest: vi.fn(),
    submitProfileChangeRequests: vi.fn(),
    parseRestrictedChangeRequestBody: vi.fn(actual.parseRestrictedChangeRequestBody),
  }
})

vi.mock('@/lib/team-member-profiles-api', () => ({
  getAuthenticatedMemberProfile: vi.fn(),
}))

describe('/api/profile-change-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET returns 401 without bearer token', async () => {
    const response = await GET(new NextRequest('http://localhost/api/profile-change-requests'))
    expect(response.status).toBe(401)
  })

  it('GET maps forbidden errors to 403', async () => {
    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')
    const { listPendingProfileChangeRequestsForOrg } = await import('@/lib/profile-change-requests')

    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: {} as never,
      userId: 'driver-1',
      profile: { user_id: 'driver-1', user_roles: ['Driver'] } as never,
    })
    vi.mocked(listPendingProfileChangeRequestsForOrg).mockRejectedValue(
      new Error('Forbidden – only primary owners can list org change requests')
    )

    const response = await GET(
      new NextRequest('http://localhost/api/profile-change-requests', {
        headers: { Authorization: 'Bearer token-1' },
      })
    )

    expect(response.status).toBe(403)
  })

  it('GET returns pending requests for authenticated primary owner', async () => {
    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')
    const { listPendingProfileChangeRequestsForOrg } = await import('@/lib/profile-change-requests')

    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: {} as never,
      userId: 'owner-1',
      profile: { user_id: 'owner-1', is_primary_owner: true } as never,
    })
    vi.mocked(listPendingProfileChangeRequestsForOrg).mockResolvedValue([
      { id: 'req-1', field_key: 'cdl_number', status: 'pending' } as never,
    ])

    const response = await GET(
      new NextRequest('http://localhost/api/profile-change-requests', {
        headers: { Authorization: 'Bearer token-1' },
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    const { submitProfileChangeRequests } = await import('@/lib/profile-change-requests')
    expect(submitProfileChangeRequests).not.toHaveBeenCalled()
  })

  it('POST returns 401 without bearer token', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/profile-change-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_full_name: 'Janet' }),
      })
    )

    expect(response.status).toBe(401)
  })

  it('POST maps forbidden errors to 403', async () => {
    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')
    const { submitProfileChangeRequests } = await import('@/lib/profile-change-requests')

    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: {} as never,
      userId: 'owner-1',
      profile: { user_id: 'owner-1', is_primary_owner: true } as never,
    })
    vi.mocked(submitProfileChangeRequests).mockRejectedValue(
      new Error('Forbidden – only driver accounts use profile change requests')
    )

    const response = await POST(
      new NextRequest('http://localhost/api/profile-change-requests', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ driver_full_name: 'Janet' }),
      })
    )

    expect(response.status).toBe(403)
  })

  it('POST derives baseline server-side and ignores client baseline_profile', async () => {
    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')
    const { submitProfileChangeRequests } = await import('@/lib/profile-change-requests')

    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: {} as never,
      userId: 'driver-1',
      profile: { user_id: 'driver-1', user_roles: ['Driver'] } as never,
    })
    vi.mocked(submitProfileChangeRequests).mockResolvedValue([])

    const response = await POST(
      new NextRequest('http://localhost/api/profile-change-requests', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          driver_full_name: 'Janet',
          baseline_profile: { driver_full_name: 'Fake Baseline' },
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(submitProfileChangeRequests).toHaveBeenCalledWith(
      {},
      { user_id: 'driver-1', user_roles: ['Driver'] },
      expect.objectContaining({ driver_full_name: 'Janet', driver_phone: '' })
    )
    expect(submitProfileChangeRequests.mock.calls[0]?.length).toBe(3)
  })

  it('PATCH validates action and reviews pending request', async () => {
    const { getAuthenticatedMemberProfile } = await import('@/lib/team-member-profiles-api')
    const { reviewProfileChangeRequest } = await import('@/lib/profile-change-requests')

    vi.mocked(getAuthenticatedMemberProfile).mockResolvedValue({
      supabase: {} as never,
      userId: 'owner-1',
      profile: { user_id: 'owner-1', is_primary_owner: true } as never,
    })
    vi.mocked(reviewProfileChangeRequest).mockResolvedValue({
      id: 'req-1',
      status: 'approved',
    } as never)

    const badResponse = await PATCH(
      new NextRequest('http://localhost/api/profile-change-requests', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: 'req-1' }),
      })
    )
    expect(badResponse.status).toBe(400)

    const response = await PATCH(
      new NextRequest('http://localhost/api/profile-change-requests', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: 'req-1', action: 'approve' }),
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(reviewProfileChangeRequest).toHaveBeenCalledWith({}, expect.anything(), 'req-1', 'approve')
  })
})