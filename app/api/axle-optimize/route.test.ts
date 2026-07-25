import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE, GET, POST } from './route'

const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: (...args: unknown[]) => mockFrom(...args),
  })),
}))

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/axle-optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Chain for member_profiles / organization_memberships org resolve. */
function mockOrgResolve(orgId: string | null) {
  const profileMaybe = vi.fn().mockResolvedValue({
    data: orgId ? { organization_id: orgId } : null,
    error: null,
  })
  const profileEq = vi.fn().mockReturnValue({ maybeSingle: profileMaybe })
  const profileSelect = vi.fn().mockReturnValue({ eq: profileEq })

  return { profileSelect, profileEq, profileMaybe }
}

describe('POST /api/axle-optimize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(jsonRequest({ axles: [] }) as any)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 400 for invalid axles', async () => {
    const res = await POST(jsonRequest({ axles: [] }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/axle/i)
  })

  it('returns analysis without save', async () => {
    const res = await POST(
      jsonRequest({
        axles: [
          { id: 'a', position_inches: 0, type: 'drive', current_load_lbs: 17_000 },
          { id: 'b', position_inches: 54, type: 'drive', current_load_lbs: 17_000 },
        ],
        states: ['MO'],
      }) as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.analysis.groups.length).toBeGreaterThanOrEqual(1)
    expect(body.analysis.groups[0].type).toBe('tandem')
    expect(body.analysis.groups[0].bridge_formula?.applicable).toBe(true)
    expect(body.permit.engine).toBe('axleGroupCalculator')
    expect(body.saved).toBeNull()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('saves config when save=true using server org id (ignores client organization_id)', async () => {
    const { profileSelect } = mockOrgResolve('org-home')
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'cfg-1',
        name: 'My rig',
        user_id: 'user-1',
        organization_id: 'org-home',
      },
      error: null,
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const insert = vi.fn().mockReturnValue({ select })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'member_profiles') return { select: profileSelect }
      if (table === 'axle_configs') return { insert }
      return { select: vi.fn() }
    })

    const res = await POST(
      jsonRequest({
        save: true,
        name: 'My rig',
        states: ['KS'],
        organization_id: 'evil-org-from-client',
        state_rules: {
          KS: { tandem_cap_lbs: -999, single_cap_lbs: 20_000 },
        },
        axles: [
          { id: 'a', position_inches: 36, type: 'steer', current_load_lbs: 12_000 },
        ],
      }) as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.saved?.id).toBe('cfg-1')
    expect(insert).toHaveBeenCalled()
    const insertRow = insert.mock.calls[0][0]
    expect(insertRow.user_id).toBe('user-1')
    expect(insertRow.organization_id).toBe('org-home')
    expect(insertRow.organization_id).not.toBe('evil-org-from-client')
    // Negative tandem cap sanitized back to default
    expect(insertRow.state_rules.KS.tandem_cap_lbs).toBeGreaterThan(0)
    expect(insertRow.state_rules._selected_states).toEqual(['KS'])
    expect(body).not.toHaveProperty('details')
  })

  it('empty states save federal-only rules (not all corridor defaults)', async () => {
    const { profileSelect } = mockOrgResolve(null)
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'cfg-fed', name: 'Fed only' },
      error: null,
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const insert = vi.fn().mockReturnValue({ select })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'member_profiles') return { select: profileSelect }
      if (table === 'organization_memberships') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'axle_configs') return { insert }
      return {}
    })

    const res = await POST(
      jsonRequest({
        save: true,
        name: 'Fed only',
        states: [],
        axles: [{ id: 'a', position_inches: 0, type: 'steer', current_load_lbs: 10_000 }],
      }) as any
    )
    expect(res.status).toBe(200)
    const row = insert.mock.calls[0][0]
    expect(row.state_rules._selected_states).toEqual([])
    expect(row.state_rules.US).toBeDefined()
    expect(row.state_rules.MO).toBeUndefined()
    expect(row.state_rules.TX).toBeUndefined()
  })

  it('updates existing config and returns 404 when not owned', async () => {
    const { profileSelect } = mockOrgResolve('org-1')

    const updateMaybe = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybe })
    const updateEqUser = vi.fn().mockReturnValue({ select: updateSelect })
    const updateEqId = vi.fn().mockReturnValue({ eq: updateEqUser })
    const update = vi.fn().mockReturnValue({ eq: updateEqId })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'member_profiles') return { select: profileSelect }
      if (table === 'axle_configs') return { update }
      return {}
    })

    const res = await POST(
      jsonRequest({
        save: true,
        id: 'missing-id',
        name: 'Ghost',
        axles: [{ id: 'a', position_inches: 0, type: 'steer', current_load_lbs: 10_000 }],
      }) as any
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found|not owned/i)
    expect(updateEqUser).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('updates owned config successfully', async () => {
    const { profileSelect } = mockOrgResolve(null)

    // membership fallback after null profile
    const membershipMaybe = vi.fn().mockResolvedValue({
      data: { organization_id: 'org-from-membership' },
      error: null,
    })
    const membershipLimit = vi.fn().mockReturnValue({ maybeSingle: membershipMaybe })
    const membershipOrder2 = vi.fn().mockReturnValue({ limit: membershipLimit })
    const membershipOrder1 = vi.fn().mockReturnValue({ order: membershipOrder2 })
    const membershipEq = vi.fn().mockReturnValue({ order: membershipOrder1 })
    const membershipSelect = vi.fn().mockReturnValue({ eq: membershipEq })

    const updateMaybe = vi.fn().mockResolvedValue({
      data: { id: 'cfg-2', name: 'Updated', organization_id: 'org-from-membership' },
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybe })
    const updateEqUser = vi.fn().mockReturnValue({ select: updateSelect })
    const updateEqId = vi.fn().mockReturnValue({ eq: updateEqUser })
    const update = vi.fn().mockReturnValue({ eq: updateEqId })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'member_profiles') return { select: profileSelect }
      if (table === 'organization_memberships') return { select: membershipSelect }
      if (table === 'axle_configs') return { update }
      return {}
    })

    const res = await POST(
      jsonRequest({
        save: true,
        id: 'cfg-2',
        name: 'Updated',
        axles: [{ id: 'a', position_inches: 10, type: 'steer', current_load_lbs: 11_000 }],
        states: ['TX'],
      }) as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.saved?.id).toBe('cfg-2')
    const row = update.mock.calls[0][0]
    expect(row.organization_id).toBe('org-from-membership')
  })
})

describe('GET /api/axle-optimize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  })

  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('lists configs for user', async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ id: 'c1', name: 'A' }],
      error: null,
    })
    const order = vi.fn().mockReturnValue({ limit })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    mockFrom.mockReturnValue({ select })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.configs).toHaveLength(1)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })
})

describe('DELETE /api/axle-optimize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  })

  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const req = new Request('http://localhost/api/axle-optimize?id=x', { method: 'DELETE' })
    const res = await DELETE(req as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 when id is missing', async () => {
    const req = new Request('http://localhost/api/axle-optimize', { method: 'DELETE' })
    const res = await DELETE(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/id/i)
  })

  it('returns 404 when not owned', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eqUser = vi.fn().mockReturnValue({ select })
    const eqId = vi.fn().mockReturnValue({ eq: eqUser })
    const del = vi.fn().mockReturnValue({ eq: eqId })
    mockFrom.mockReturnValue({ delete: del })

    const req = new Request('http://localhost/api/axle-optimize?id=nope', { method: 'DELETE' })
    const res = await DELETE(req as any)
    expect(res.status).toBe(404)
  })

  it('deletes owned config', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'cfg-1' }, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eqUser = vi.fn().mockReturnValue({ select })
    const eqId = vi.fn().mockReturnValue({ eq: eqUser })
    const del = vi.fn().mockReturnValue({ eq: eqId })
    mockFrom.mockReturnValue({ delete: del })

    const req = new Request('http://localhost/api/axle-optimize?id=cfg-1', { method: 'DELETE' })
    const res = await DELETE(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deleted).toBe('cfg-1')
  })
})
