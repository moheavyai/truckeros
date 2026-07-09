import { describe, expect, it, vi } from 'vitest'
import {
  buildPermitRequestInsertRecord,
  sanitizeCargoSnapshot,
  sanitizeCargoSnapshotForUser,
  validateCargoOrganizationId,
  type SavePermitRequestInput,
} from './permit-requests'

const basePayload: SavePermitRequestInput = {
  origin_city: 'Grand Island',
  origin_state: 'NE',
  destination_city: 'Dickinson',
  destination_state: 'ND',
  origin_query: 'Case IH plant Grand Island',
  destination_query: 'West Plains I94 Business Loop e Dickinson ND',
  drops: [
    {
      id: 'drop-1',
      query: 'Northern Plains Equipment 1915 US 2 Minot ND',
      city: 'Minot',
      state: 'ND',
      lat: 48.23,
      lon: -101.29,
    },
    {
      id: 'drop-2',
      query: 'West Plains I94 Business Loop e Dickinson ND',
      city: 'Dickinson',
      state: 'ND',
      lat: 46.89,
      lon: -102.79,
    },
  ],
  weight: 80000,
  length: 75,
  width: 8.5,
  height: 13.6,
  route_corridor: ['NE', 'SD', 'ND'],
  permit_required_states: ['NE', 'ND'],
  requires_permit: true,
  reasons: ['oversize'],
  notes: [],
  estimated_cost: 150,
  cost_breakdown: null,
  distance_miles: 620,
  duration_hours: 11,
  user_id: 'client-should-be-ignored',
}

describe('buildPermitRequestInsertRecord', () => {
  it('includes query and drops columns required by migration 014', () => {
    const record = buildPermitRequestInsertRecord(basePayload, 'user-abc')
    expect(record.user_id).toBe('user-abc')
    expect(record.origin_query).toBe('Case IH plant Grand Island')
    expect(record.destination_query).toBe('West Plains I94 Business Loop e Dickinson ND')
    expect(record.drops).toHaveLength(2)
    expect(record.drops?.[0].query).toContain('Northern Plains')
  })

  it('overrides client user_id with server-derived value', () => {
    const record = buildPermitRequestInsertRecord(basePayload, 'server-user')
    expect(record.user_id).toBe('server-user')
    expect(record.user_id).not.toBe(basePayload.user_id)
  })

  it('nulls optional query fields when omitted', () => {
    const { origin_query: _oq, destination_query: _dq, drops: _d, ...rest } = basePayload
    const record = buildPermitRequestInsertRecord(rest, 'user-abc')
    expect(record.origin_query).toBeNull()
    expect(record.destination_query).toBeNull()
    expect(record.drops).toBeNull()
  })

  it('sanitizes cargo subfields when building insert record', () => {
    const record = buildPermitRequestInsertRecord(
      {
        ...basePayload,
        cargo: {
          numberOfPieces: 0,
          loadedArrangement: 'bogus',
          moveType: 'flying',
          description: 'Load',
        },
      },
      'user-abc'
    )

    expect(record.cargo).toEqual({
      numberOfPieces: 1,
      loadedArrangement: 'side-by-side',
      moveType: 'hauled',
      description: 'Load',
    })
  })
})

describe('validateCargoOrganizationId', () => {
  function mockSupabase(responses: {
    ownOrg?: string | null
    membership?: { organization_id: string; role: string } | null
    created?: { id: string } | null
  }) {
    return {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn((column: string, value: string) => {
            if (table === 'member_profiles' && column === 'user_id') {
              return {
                maybeSingle: vi.fn().mockResolvedValue({
                  data: responses.ownOrg ? { organization_id: responses.ownOrg } : null,
                  error: null,
                }),
              }
            }
            if (table === 'organization_memberships' && column === 'user_id') {
              return {
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: responses.membership ?? null,
                    error: null,
                  }),
                })),
              }
            }
            if (table === 'organizations' && column === 'id') {
              return {
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: responses.created ?? null,
                    error: null,
                  }),
                })),
              }
            }
            return { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
          }),
        })),
      })),
    }
  }

  it('accepts own carrier organization', async () => {
    const supabase = mockSupabase({ ownOrg: 'org-own' })
    await expect(validateCargoOrganizationId(supabase as never, 'user-1', 'org-own')).resolves.toBe(
      'org-own'
    )
  })

  it('accepts organization the user created (ownership path, not SM role)', async () => {
    const supabase = mockSupabase({
      ownOrg: null,
      created: { id: 'org-created' },
    })
    await expect(
      validateCargoOrganizationId(supabase as never, 'user-1', 'org-created')
    ).resolves.toBe('org-created')
  })

  it('accepts eligible service-mode membership', async () => {
    const supabase = mockSupabase({
      membership: { organization_id: 'org-client', role: 'Permit Clerk' },
    })
    await expect(
      validateCargoOrganizationId(supabase as never, 'user-1', 'org-client')
    ).resolves.toBe('org-client')
  })

  it('strips Owner/Admin membership orgs (Phase 1: Clerk-only SM cargo scope)', async () => {
    const ownerSupabase = mockSupabase({
      membership: { organization_id: 'org-client', role: 'Owner' },
    })
    await expect(
      validateCargoOrganizationId(ownerSupabase as never, 'user-1', 'org-client')
    ).resolves.toBeNull()

    const adminSupabase = mockSupabase({
      membership: { organization_id: 'org-client', role: 'Admin' },
    })
    await expect(
      validateCargoOrganizationId(adminSupabase as never, 'user-1', 'org-client')
    ).resolves.toBeNull()
  })

  it('strips unauthorized organization ids', async () => {
    const supabase = mockSupabase({
      membership: { organization_id: 'org-client', role: 'Viewer' },
    })
    await expect(
      validateCargoOrganizationId(supabase as never, 'user-1', 'org-client')
    ).resolves.toBeNull()
  })
})

describe('sanitizeCargoSnapshotForUser', () => {
  it('removes invalid organizationId from cargo snapshot', async () => {
    const supabase = mockSupabaseForSanitize({ ownOrg: null, membership: null, created: null })
    const result = await sanitizeCargoSnapshotForUser(supabase as never, 'user-1', {
      description: 'Load',
      organizationId: 'org-forged',
      numberOfPieces: 2,
      loadedArrangement: 'side-by-side',
      moveType: 'hauled',
    })

    expect(result).toEqual({
      description: 'Load',
      numberOfPieces: 2,
      loadedArrangement: 'side-by-side',
      moveType: 'hauled',
    })
    expect(result).not.toHaveProperty('organizationId')
  })
})

function mockSupabaseForSanitize(responses: {
  ownOrg?: string | null
  membership?: { organization_id: string; role: string } | null
  created?: { id: string } | null
}) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn((column: string) => {
          if (table === 'member_profiles') {
            return {
              maybeSingle: vi.fn().mockResolvedValue({
                data: responses.ownOrg ? { organization_id: responses.ownOrg } : null,
                error: null,
              }),
            }
          }
          if (table === 'organization_memberships') {
            return {
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: responses.membership ?? null,
                  error: null,
                }),
              })),
            }
          }
          if (table === 'organizations') {
            return {
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: responses.created ?? null,
                  error: null,
                }),
              })),
            }
          }
          return { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
        }),
      })),
    })),
  }
}

describe('sanitizeCargoSnapshot', () => {
  it('returns null for missing cargo', () => {
    expect(sanitizeCargoSnapshot(null)).toBeNull()
    expect(sanitizeCargoSnapshot(undefined)).toBeNull()
  })

  it('clamps and allowlists cargo subfields', () => {
    expect(
      sanitizeCargoSnapshot({
        numberOfPieces: 5000,
        loadedArrangement: 'stacked',
        moveType: 'towed',
      })
    ).toEqual({
      numberOfPieces: 999,
      loadedArrangement: 'stacked',
      moveType: 'towed',
    })
  })
})