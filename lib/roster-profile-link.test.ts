import { describe, expect, it, vi } from 'vitest'
import {
  fetchActorTeamContext,
  fetchLinkedTeamMemberRoster,
  fetchOrganizationMembershipForOrg,
  fetchOrganizationMembershipForUser,
  pickPreferredMembership,
} from './roster-profile-link'

function createSupabaseMock(handlers: Record<string, () => Promise<{ data: unknown; error: unknown }>>) {
  return {
    from: (table: string) => {
      const resolve = async () => handlers[table]?.() ?? { data: null, error: null }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        // organization_memberships terminates at limit(); roster uses maybeSingle()
        limit: (count?: number) => {
          if (table === 'organization_memberships') {
            return resolve().then((result) => {
              const row = result.data
              const rows = row == null ? [] : Array.isArray(row) ? row : [row]
              return { data: rows, error: result.error }
            })
          }
          void count
          return chain
        },
        maybeSingle: resolve,
      }
      return chain
    },
  }
}

describe('fetchLinkedTeamMemberRoster', () => {
  it('returns roster row linked by user id before email lookup', async () => {
    const linkedLookup = vi.fn(async () => ({
      data: {
        id: 'roster-1',
        organization_id: 'org-1',
        created_by_user_id: 'owner-user',
        linked_user_id: 'driver-user',
        user_roles: ['Driver'],
      },
      error: null,
    }))
    const emailLookup = vi.fn(async () => ({ data: null, error: null }))

    const supabase = {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: (_col: string, value: string) => {
            if (table === 'team_member_profiles' && value === 'driver-user') {
              return {
                order: () => ({
                  limit: () => ({
                    maybeSingle: linkedLookup,
                  }),
                }),
              }
            }
            if (table === 'team_member_profiles') {
              return {
                order: () => ({
                  limit: () => ({
                    maybeSingle: emailLookup,
                  }),
                }),
              }
            }
            return chain
          },
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
        }
        return chain
      },
    }

    const result = await fetchLinkedTeamMemberRoster(
      supabase as never,
      'driver-user',
      'driver@example.com'
    )

    expect(result?.id).toBe('roster-1')
    expect(linkedLookup).toHaveBeenCalled()
    expect(emailLookup).not.toHaveBeenCalled()
  })

  it('falls back to driver_email when linked_user_id is missing', async () => {
    const supabase = createSupabaseMock({
      team_member_profiles: async () => ({
        data: {
          id: 'roster-email',
          organization_id: 'org-1',
          created_by_user_id: 'owner-user',
          driver_email: 'driver@example.com',
          user_roles: ['Admin'],
        },
        error: null,
      }),
      organization_memberships: async () => ({ data: null, error: null }),
    })

    const firstLookup = await fetchLinkedTeamMemberRoster(
      supabase as never,
      'driver-user',
      'driver@example.com'
    )
    expect(firstLookup?.driver_email).toBe('driver@example.com')
  })
})

describe('fetchActorTeamContext', () => {
  it('loads membership before roster for bootstrap decisions', async () => {
    const callOrder: string[] = []
    const supabase = {
      from: (table: string) => {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: (count?: number) => {
            if (table === 'organization_memberships') {
              callOrder.push(table)
              return Promise.resolve({
                data: [{ organization_id: 'org-1', role: 'Admin', is_primary_owner: false }],
                error: null,
              })
            }
            // roster path: .limit(1).maybeSingle()
            void count
            return {
              maybeSingle: async () => {
                callOrder.push(table)
                return { data: null, error: null }
              },
            }
          },
          maybeSingle: async () => {
            callOrder.push(table)
            return { data: null, error: null }
          },
        }
        return chain
      },
    }

    const context = await fetchActorTeamContext(supabase as never, 'user-1', 'admin@example.com')
    expect(context.organizationMembership).toEqual({
      organization_id: 'org-1',
      role: 'Admin',
      is_primary_owner: false,
    })
    expect(context.linkedRoster).toBeNull()
    expect(callOrder[0]).toBe('organization_memberships')
    expect(callOrder[1]).toBe('team_member_profiles')
  })
})

describe('pickPreferredMembership', () => {
  it('prefers primary owner membership over newer non-primary rows', () => {
    const preferred = pickPreferredMembership([
      {
        organization_id: 'org-new',
        is_primary_owner: false,
        created_at: '2026-06-01T00:00:00Z',
      },
      {
        organization_id: 'org-home',
        is_primary_owner: true,
        created_at: '2025-01-01T00:00:00Z',
      },
    ])
    expect(preferred?.organization_id).toBe('org-home')
  })

  it('falls back to most recently created membership', () => {
    const preferred = pickPreferredMembership([
      {
        organization_id: 'org-old',
        is_primary_owner: false,
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        organization_id: 'org-new',
        is_primary_owner: false,
        created_at: '2026-01-01T00:00:00Z',
      },
    ])
    expect(preferred?.organization_id).toBe('org-new')
  })

  it.each([
    [null, null],
    [undefined, null],
    [[], null],
    [[{ organization_id: null }], null],
    [[{ organization_id: '' }], null],
  ])('returns null for empty/org-less inputs %#', (input, expected) => {
    expect(pickPreferredMembership(input as never)).toBe(expected)
  })
})

describe('fetchOrganizationMembershipForOrg', () => {
  it('returns membership for the requested home org', async () => {
    const eqs: string[] = []
    const supabase = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: (col: string, value: string) => {
            eqs.push(`${col}=${value}`)
            return chain
          },
          maybeSingle: async () => ({
            data: {
              organization_id: 'org-home',
              role: 'Owner',
              is_primary_owner: true,
            },
            error: null,
          }),
        }
        return chain
      },
    }

    const membership = await fetchOrganizationMembershipForOrg(
      supabase as never,
      'user-1',
      'org-home'
    )
    expect(membership).toEqual({
      organization_id: 'org-home',
      role: 'Owner',
      is_primary_owner: true,
    })
    expect(eqs).toContain('user_id=user-1')
    expect(eqs).toContain('organization_id=org-home')
  })

  it('returns null when organizationId missing', async () => {
    const from = vi.fn()
    const membership = await fetchOrganizationMembershipForOrg(
      { from } as never,
      'user-1',
      null
    )
    expect(membership).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })
})

describe('fetchOrganizationMembershipForUser', () => {
  it('returns membership organization and role', async () => {
    const supabase = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: async () => ({
            data: [{ organization_id: 'org-9', role: 'Driver', is_primary_owner: false }],
            error: null,
          }),
        }
        return chain
      },
    }

    const membership = await fetchOrganizationMembershipForUser(supabase as never, 'user-1')
    expect(membership).toEqual({
      organization_id: 'org-9',
      role: 'Driver',
      is_primary_owner: false,
    })
  })

  it('does not order by updated_at (column does not exist on organization_memberships)', async () => {
    const orders: Array<{ col: string; asc: boolean }> = []
    const supabase = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: (col: string, opts?: { ascending?: boolean }) => {
            orders.push({ col, asc: opts?.ascending !== false })
            return chain
          },
          limit: async () => ({ data: [], error: null }),
        }
        return chain
      },
    }

    await fetchOrganizationMembershipForUser(supabase as never, 'user-1')
    expect(orders.map((o) => o.col)).toEqual(['is_primary_owner', 'created_at'])
    expect(orders.some((o) => o.col === 'updated_at')).toBe(false)
  })
})