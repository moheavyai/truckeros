import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

const mockGetUser = vi.fn()
const mockPermitSelect = vi.fn()
const mockExistingSelect = vi.fn()
const mockUpsert = vi.fn()

function chainable(result: { data?: any; error?: any }) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
    upsert: vi.fn(() => chain),
  }
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      if (table === 'permit_requests') return mockPermitSelect()
      if (table === 'portal_submissions') {
        if (mockExistingSelect.mock.calls.length === 0 && mockUpsert.mock.calls.length === 0) {
          return mockExistingSelect()
        }
        return mockUpsert()
      }
      throw new Error(`unexpected table ${table}`)
    }),
  })),
}))

function makePost(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/portal-submissions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/portal-submissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockPermitSelect.mockReturnValue(
      chainable({ data: { id: 'req-1', user_id: 'user-1' }, error: null })
    )
  })

  it('returns 401 without bearer token', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/portal-submissions', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    )
    expect(response.status).toBe(401)
  })

  it('sets human_approved true only on record_approval action', async () => {
    mockExistingSelect.mockReturnValue(chainable({ data: null, error: null }))
    mockUpsert.mockReturnValue(
      chainable({
        data: { permit_request_id: 'req-1', state_code: 'TX', human_approved: true },
        error: null,
      })
    )

    const response = await POST(
      makePost({
        permit_request_id: 'req-1',
        state_code: 'TX',
        status: 'prefilled',
        record_approval: true,
        human_approved: false,
      })
    )

    expect(response.status).toBe(200)
    const upsertArg = mockUpsert.mock.results[0].value.upsert.mock.calls[0][0]
    expect(upsertArg.human_approved).toBe(true)
  })

  it('ignores client human_approved when record_approval is not set', async () => {
    mockExistingSelect.mockReturnValue(chainable({ data: null, error: null }))
    mockUpsert.mockReturnValue(
      chainable({
        data: { permit_request_id: 'req-1', state_code: 'TX', human_approved: false },
        error: null,
      })
    )

    const response = await POST(
      makePost({
        permit_request_id: 'req-1',
        state_code: 'TX',
        status: 'submitted',
        human_approved: true,
      })
    )

    expect(response.status).toBe(200)
    const upsertArg = mockUpsert.mock.results[0].value.upsert.mock.calls[0][0]
    expect(upsertArg.human_approved).toBe(false)
  })

  it('preserves existing human_approved on subsequent updates', async () => {
    mockExistingSelect.mockReturnValue(chainable({ data: { human_approved: true }, error: null }))
    mockUpsert.mockReturnValue(
      chainable({
        data: { permit_request_id: 'req-1', state_code: 'TX', human_approved: true },
        error: null,
      })
    )

    const response = await POST(
      makePost({
        permit_request_id: 'req-1',
        state_code: 'TX',
        status: 'submitted',
        human_approved: false,
      })
    )

    expect(response.status).toBe(200)
    const upsertArg = mockUpsert.mock.results[0].value.upsert.mock.calls[0][0]
    expect(upsertArg.human_approved).toBe(true)
  })

  it('uses upsert on permit_request_id,state_code conflict', async () => {
    mockExistingSelect.mockReturnValue(chainable({ data: null, error: null }))
    const upsertChain = chainable({
      data: { permit_request_id: 'req-1', state_code: 'TX' },
      error: null,
    })
    mockUpsert.mockReturnValue(upsertChain)

    await POST(
      makePost({
        permit_request_id: 'req-1',
        state_code: 'TX',
        status: 'prefilled',
        record_approval: true,
      })
    )

    expect(upsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ permit_request_id: 'req-1', state_code: 'TX' }),
      { onConflict: 'permit_request_id,state_code' }
    )
  })
})