import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { FORCED_CARRIER_OWNER_EMAIL } from './forced-carrier-owner'
import {
  buildCarrierOnlyApiSavePayload,
  emptyMemberProfileForm,
  prepareMemberProfileSave,
  validateBootstrapCarrierSaveRoles,
} from './member-profile'
import {
  buildActingPermissionActor,
  canActorSaveCarrierOnlyScope,
  createOrUpdateRosterMemberForUser,
  deleteTeamMemberForUser,
  saveTeamMemberProfileForUser,
  selfSaveFormForActor,
} from './team-member-profiles-api'
import type { MemberProfile } from '@/types/member-profile'

const deletionMocks = vi.hoisted(() => ({
  mockCreateDeletionRequest: vi.fn(),
}))

vi.mock('@/lib/deletion-requests', () => ({
  createDeletionRequest: deletionMocks.mockCreateDeletionRequest,
}))

const supabaseMocks = vi.hoisted(() => {
  const mockGetUser = vi.fn()
  const mockMaybeSingle = vi.fn()
  const mockLinkedRosterMaybeSingle = vi.fn()
  const mockMembershipLookupMaybeSingle = vi.fn()
  const mockMembershipRoleMaybeSingle = vi.fn()
  const mockTargetMaybeSingle = vi.fn()
  const mockPrimaryOwnerMaybeSingle = vi.fn()
  const mockUpsert = vi.fn()
  const mockUpdate = vi.fn()
  const mockDelete = vi.fn()
  const mockFrom = vi.fn()
  const mockAuthedOrgUpsert = vi.fn()
  const mockAdminOrgUpsert = vi.fn()
  const mockAdminUpsert = vi.fn()
  const mockAdminFrom = vi.fn()
  const callOrder: string[] = []

  const mockCreateClient = vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }))

  const adminAccessState = {
    hasAdminAccess: true,
    supabaseAdmin: null as { from: typeof mockAdminFrom } | null,
  }
  adminAccessState.supabaseAdmin = { from: mockAdminFrom }

  return {
    mockGetUser,
    mockMaybeSingle,
    mockLinkedRosterMaybeSingle,
    mockMembershipLookupMaybeSingle,
    mockMembershipRoleMaybeSingle,
    mockTargetMaybeSingle,
    mockPrimaryOwnerMaybeSingle,
    mockUpsert,
    mockUpdate,
    mockDelete,
    mockFrom,
    mockCreateClient,
    mockAuthedOrgUpsert,
    mockAdminOrgUpsert,
    mockAdminUpsert,
    mockAdminFrom,
    adminAccessState,
    callOrder,
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: supabaseMocks.mockCreateClient,
}))

vi.mock('@/lib/supabase', () => ({
  get hasAdminAccess() {
    return supabaseMocks.adminAccessState.hasAdminAccess
  },
  get supabaseAdmin() {
    return supabaseMocks.adminAccessState.supabaseAdmin
  },
}))

const driverProfile: MemberProfile = {
  user_id: 'driver-1',
  organization_id: 'org-1',
  is_primary_owner: false,
  user_roles: ['Driver'],
  company_name: 'Carrier Co',
  usdot_number: '123456',
  driver_full_name: 'Jane Doe',
  cdl_number: 'D123',
}

const ownerProfile: MemberProfile = {
  user_id: 'owner-1',
  organization_id: 'org-1',
  is_primary_owner: true,
  user_roles: ['Owner'],
  company_name: 'Carrier Co',
}

describe('selfSaveFormForActor', () => {
  it('strips carrier fields and restricted identity fields for driver self-save', () => {
    const form = {
      ...emptyMemberProfileForm(),
      company_name: 'Hacked Carrier',
      usdot_number: '999999',
      driver_full_name: 'Janet Doe',
      cdl_number: 'NEW123',
      driver_phone: '555-0100',
    }

    const result = selfSaveFormForActor(form, driverProfile, 'full')

    expect(result.company_name).toBe('Carrier Co')
    expect(result.usdot_number).toBe('123456')
    expect(result.driver_full_name).toBe('Jane Doe')
    expect(result.cdl_number).toBe('D123')
    expect(result.driver_phone).toBe('555-0100')
  })

  it('forces member_only scope for drivers even when full is requested', () => {
    const form = {
      ...emptyMemberProfileForm(),
      company_name: 'Attempted Carrier Edit',
      driver_phone: '555-0100',
    }

    const result = selfSaveFormForActor(form, driverProfile, 'full')

    expect(result.company_name).toBe('Carrier Co')
    expect(result.driver_phone).toBe('555-0100')
  })

  it('skips restricted-field baseline pass for driver carrier_only scope', () => {
    const form = {
      ...emptyMemberProfileForm(),
      driver_full_name: 'Janet Doe',
      company_name: 'Updated Carrier',
    }

    const memberOnly = selfSaveFormForActor(form, driverProfile, 'member_only')
    const carrierOnly = selfSaveFormForActor(form, driverProfile, 'carrier_only')

    expect(memberOnly.driver_full_name).toBe('Jane Doe')
    expect(memberOnly.company_name).toBe('Carrier Co')
    expect(carrierOnly.driver_full_name).toBe('Jane Doe')
    expect(carrierOnly.company_name).toBe('Updated Carrier')
  })

  it('passes restricted identity fields through for non-driver actors', () => {
    const adminProfile: MemberProfile = {
      user_id: 'admin-1',
      organization_id: 'org-1',
      is_primary_owner: false,
      user_roles: ['Owner'],
      driver_full_name: 'Admin Name',
    }
    const form = {
      ...emptyMemberProfileForm(),
      driver_full_name: 'Updated Name',
      cdl_number: 'NEW123',
    }

    const result = selfSaveFormForActor(form, adminProfile, 'member_only')

    expect(result.driver_full_name).toBe('Updated Name')
    expect(result.cdl_number).toBe('NEW123')
  })

  it('preserves carrier payload for primary owner carrier-only saves', () => {
    const form = {
      ...emptyMemberProfileForm(),
      company_name: 'Updated Carrier',
      driver_full_name: 'Owner Name',
    }

    const result = selfSaveFormForActor(form, ownerProfile, 'carrier_only')

    expect(result.company_name).toBe('Updated Carrier')
    expect(result.driver_full_name).toBe('')
  })
})

describe('buildActingPermissionActor', () => {
  it('uses membership role for target org over stale home user_roles', () => {
    const actor = buildActingPermissionActor({
      userId: 'u-1',
      homeProfile: {
        organization_id: 'org-1',
        is_primary_owner: false,
        user_roles: ['Viewer'],
      },
      membership: {
        organization_id: 'org-1',
        role: 'Admin',
        is_primary_owner: false,
      },
      effectiveOrgId: 'org-1',
    })
    expect(actor.user_roles).toEqual(['Admin'])
    expect(actor.is_primary_owner).toBe(false)
  })

  it('applies Owner Operator only on home org', () => {
    const home = buildActingPermissionActor({
      userId: 'u-1',
      homeProfile: {
        organization_id: 'org-home',
        is_primary_owner: true,
        user_roles: ['Owner', 'Driver'],
      },
      membership: {
        organization_id: 'org-home',
        role: 'Owner',
        is_primary_owner: true,
      },
      effectiveOrgId: 'org-home',
    })
    expect(home.user_roles).toEqual(['Owner', 'Driver'])

    const foreign = buildActingPermissionActor({
      userId: 'u-1',
      homeProfile: {
        organization_id: 'org-home',
        is_primary_owner: true,
        user_roles: ['Owner', 'Driver'],
      },
      membership: {
        organization_id: 'org-client',
        role: 'Permit Clerk',
        is_primary_owner: false,
      },
      effectiveOrgId: 'org-client',
    })
    expect(foreign.user_roles).toEqual(['Permit Clerk'])
  })
})

describe('canActorSaveCarrierOnlyScope', () => {
  it('allows bootstrap carrier_only when actorProfile is null', () => {
    expect(canActorSaveCarrierOnlyScope(null)).toBe(true)
  })

  it('allows primary owner carrier_only saves', () => {
    expect(canActorSaveCarrierOnlyScope(ownerProfile)).toBe(true)
  })

  it('blocks org-linked driver carrier_only saves without Owner / Admin role', () => {
    expect(canActorSaveCarrierOnlyScope(driverProfile)).toBe(false)
  })

  it('allows Owner / Admin role holders to save carrier_only before primary owner flag is set', () => {
    const pendingOwner: MemberProfile = {
      user_id: 'owner-pending',
      is_primary_owner: false,
      user_roles: ['Owner'],
      company_name: 'Pending Carrier',
    }
    expect(canActorSaveCarrierOnlyScope(pendingOwner)).toBe(true)
  })

  it('allows bootstrap carrier_only when profile has no org and form has Owner / Admin', () => {
    const partialProfile: MemberProfile = {
      user_id: 'user-partial',
      is_primary_owner: false,
      user_roles: ['Driver'],
      company_name: 'Partial Carrier',
    }
    const form = { ...emptyMemberProfileForm(), user_roles: ['Owner'] }

    expect(canActorSaveCarrierOnlyScope(partialProfile, form)).toBe(true)
    expect(canActorSaveCarrierOnlyScope(partialProfile)).toBe(false)
  })
})

describe('saveTeamMemberProfileForUser', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    supabaseMocks.adminAccessState.hasAdminAccess = true
    supabaseMocks.adminAccessState.supabaseAdmin = { from: supabaseMocks.mockAdminFrom }
    vi.clearAllMocks()

    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'viewer-1', email: 'viewer@example.com' } },
      error: null,
    })
    supabaseMocks.mockLinkedRosterMaybeSingle.mockResolvedValue({ data: null, error: null })
    supabaseMocks.mockMembershipLookupMaybeSingle.mockResolvedValue({ data: null, error: null })
    supabaseMocks.mockMembershipRoleMaybeSingle.mockResolvedValue({ data: null, error: null })
    supabaseMocks.mockTargetMaybeSingle.mockResolvedValue({
      data: {
        user_id: 'driver-1',
        organization_id: 'org-1',
        is_primary_owner: false,
        user_roles: ['Driver'],
        company_name: 'Carrier Co',
        usdot_number: '123456',
      },
      error: null,
    })
    supabaseMocks.mockPrimaryOwnerMaybeSingle.mockResolvedValue({ data: null, error: null })

    supabaseMocks.callOrder.length = 0

    supabaseMocks.mockFrom.mockImplementation((table: string) => {
      if (table === 'member_profiles') {
        return {
          select: vi.fn(() => {
            const filters: Record<string, unknown> = {}
            const chain = {
              eq: vi.fn((col: string, val: unknown) => {
                filters[col] = val
                return chain
              }),
              maybeSingle: vi.fn(async () => {
                if (filters.is_primary_owner === true) {
                  return supabaseMocks.mockPrimaryOwnerMaybeSingle()
                }
                if (
                  typeof filters.user_id === 'string' &&
                  typeof filters.organization_id === 'string'
                ) {
                  return supabaseMocks.mockTargetMaybeSingle()
                }
                return supabaseMocks.mockMaybeSingle()
              }),
            }
            return chain
          }),
          upsert: (...args: unknown[]) => {
            supabaseMocks.callOrder.push('member_profiles.upsert')
            return supabaseMocks.mockUpsert(...args)
          },
          update: (...args: unknown[]) => {
            supabaseMocks.callOrder.push('member_profiles.update')
            const updateResult = supabaseMocks.mockUpdate(...args)
            if (updateResult?.eq) return updateResult
            // Default chain: .update().eq().eq().select().single()
            const eq2 = {
              select: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve({
                    data: {
                      user_id: 'driver-1',
                      organization_id: 'org-1',
                      is_primary_owner: false,
                      user_roles: ['Driver'],
                    },
                    error: null,
                  })
                ),
              })),
            }
            const eq1 = { eq: vi.fn(() => eq2) }
            return { eq: vi.fn(() => eq1) }
          },
        }
      }

      if (table === 'team_member_profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: supabaseMocks.mockLinkedRosterMaybeSingle,
                })),
              })),
            })),
          })),
        }
      }

      if (table === 'organizations') {
        return {
          upsert: (...args: unknown[]) => {
            supabaseMocks.callOrder.push('organizations.upsert')
            return supabaseMocks.mockAuthedOrgUpsert(...args)
          },
        }
      }

      if (table === 'organization_memberships') {
        const membershipLimit = vi.fn(async () => {
          const result = await supabaseMocks.mockMembershipLookupMaybeSingle()
          const row = result?.data
          const rows = row == null ? [] : Array.isArray(row) ? row : [row]
          return { data: rows, error: result?.error ?? null }
        })
        // Supports both fetchActorTeamContext (order/limit) and sync previous-role (eq/maybeSingle).
        const membershipChain: {
          eq: ReturnType<typeof vi.fn>
          order: ReturnType<typeof vi.fn>
          limit: ReturnType<typeof vi.fn>
          maybeSingle: typeof supabaseMocks.mockMembershipRoleMaybeSingle
        } = {
          eq: vi.fn(() => membershipChain),
          order: vi.fn(() => membershipChain),
          limit: membershipLimit,
          maybeSingle: supabaseMocks.mockMembershipRoleMaybeSingle,
        }
        return {
          select: vi.fn(() => membershipChain),
          upsert: (...args: unknown[]) => {
            supabaseMocks.callOrder.push('organization_memberships.upsert')
            return supabaseMocks.mockAuthedOrgUpsert(...args)
          },
        }
      }

      return {
        upsert: supabaseMocks.mockAuthedOrgUpsert.mockResolvedValue({ error: null }),
      }
    })

    supabaseMocks.mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'member_profiles') {
        return {
          upsert: (...args: unknown[]) => {
            supabaseMocks.callOrder.push('member_profiles.adminUpsert')
            return supabaseMocks.mockAdminUpsert(...args)
          },
        }
      }

      if (table === 'organizations') {
        return {
          upsert: (...args: unknown[]) => {
            supabaseMocks.callOrder.push('organizations.adminUpsert')
            return supabaseMocks.mockAdminOrgUpsert(...args)
          },
        }
      }

      if (table === 'organization_memberships') {
        return {
          upsert: (...args: unknown[]) => {
            supabaseMocks.callOrder.push('organization_memberships.adminUpsert')
            return supabaseMocks.mockAdminOrgUpsert(...args)
          },
        }
      }

      return {
        upsert: supabaseMocks.mockAdminOrgUpsert.mockResolvedValue({ error: null }),
      }
    })

    supabaseMocks.mockAuthedOrgUpsert.mockResolvedValue({ error: null })
    supabaseMocks.mockAdminOrgUpsert.mockResolvedValue({ error: null })

    const defaultUpsertResult = {
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      })),
    }

    supabaseMocks.mockUpsert.mockReturnValue(defaultUpsertResult)
    supabaseMocks.mockAdminUpsert.mockReturnValue(defaultUpsertResult)
    supabaseMocks.mockUpdate.mockReturnValue(undefined)
  })

  it('rejects viewer self-save before upsert', async () => {
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        user_id: 'viewer-1',
        organization_id: 'org-1',
        is_primary_owner: false,
        user_roles: ['Viewer'],
      },
      error: null,
    })
    // Membership Viewer (or missing → home Viewer fallback)
    supabaseMocks.mockMembershipRoleMaybeSingle.mockResolvedValue({
      data: { organization_id: 'org-1', role: 'Viewer', is_primary_owner: false },
      error: null,
    })

    await expect(
      saveTeamMemberProfileForUser('token', {
        form: { ...emptyMemberProfileForm(), driver_phone: '555-0100' },
        saveScope: 'member_only',
      })
    ).rejects.toThrow('Forbidden – viewer accounts cannot edit profiles')

    expect(supabaseMocks.mockUpsert).not.toHaveBeenCalled()
  })

  it('allows self-save when membership is Admin even if home user_roles is Viewer', async () => {
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        user_id: 'admin-1',
        organization_id: 'org-1',
        is_primary_owner: false,
        user_roles: ['Viewer'],
      },
      error: null,
    })
    supabaseMocks.mockMembershipRoleMaybeSingle.mockResolvedValue({
      data: { organization_id: 'org-1', role: 'Admin', is_primary_owner: false },
      error: null,
    })
    supabaseMocks.mockUpsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              user_id: 'admin-1',
              organization_id: 'org-1',
              user_roles: ['Viewer'],
              driver_phone: '555-0100',
            },
            error: null,
          })
        ),
      })),
    })

    await saveTeamMemberProfileForUser('token', {
      form: { ...emptyMemberProfileForm(), driver_phone: '555-0100' },
      saveScope: 'member_only',
    })

    expect(supabaseMocks.mockUpsert).toHaveBeenCalled()
  })

  it('denies self-save when membership is Viewer even if home user_roles is Owner', async () => {
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'stale-owner', email: 'stale@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        user_id: 'stale-owner',
        organization_id: 'org-1',
        is_primary_owner: false,
        user_roles: ['Owner'],
      },
      error: null,
    })
    supabaseMocks.mockMembershipRoleMaybeSingle.mockResolvedValue({
      data: { organization_id: 'org-1', role: 'Viewer', is_primary_owner: false },
      error: null,
    })

    await expect(
      saveTeamMemberProfileForUser('token', {
        form: { ...emptyMemberProfileForm(), driver_phone: '555-0100' },
        saveScope: 'member_only',
      })
    ).rejects.toThrow('Forbidden – viewer accounts cannot edit profiles')

    expect(supabaseMocks.mockUpsert).not.toHaveBeenCalled()
  })

  it('allows targetUserId edit when membership grants Admin (not home multi-select)', async () => {
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        user_id: 'admin-1',
        organization_id: 'org-1',
        is_primary_owner: false,
        user_roles: ['Viewer'],
        company_name: 'Carrier Co',
      },
      error: null,
    })
    supabaseMocks.mockMembershipRoleMaybeSingle.mockResolvedValue({
      data: { organization_id: 'org-1', role: 'Admin', is_primary_owner: false },
      error: null,
    })
    supabaseMocks.mockAuthedOrgUpsert.mockResolvedValue({ error: null })

    await saveTeamMemberProfileForUser('token', {
      targetUserId: 'driver-1',
      form: {
        ...emptyMemberProfileForm(),
        driver_full_name: 'Team Driver',
        user_roles: ['Driver'],
      },
    })

    expect(supabaseMocks.mockUpdate).toHaveBeenCalled()
    expect(supabaseMocks.mockAuthedOrgUpsert).toHaveBeenCalled()
  })

  it('saves Permit Clerk other-member under parent org with is_primary_owner false', async () => {
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'owner-1', email: 'owner@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: ownerProfile,
      error: null,
    })
    supabaseMocks.mockMembershipRoleMaybeSingle.mockResolvedValue({
      data: { organization_id: 'org-1', role: 'Owner', is_primary_owner: true },
      error: null,
    })
    supabaseMocks.mockTargetMaybeSingle.mockResolvedValue({
      data: {
        user_id: 'clerk-1',
        organization_id: 'org-1',
        is_primary_owner: false,
        user_roles: ['Viewer'],
        company_name: 'Carrier Co',
        usdot_number: '123456',
      },
      error: null,
    })

    const updatePayloads: unknown[] = []
    supabaseMocks.mockUpdate.mockImplementation((payload: unknown) => {
      updatePayloads.push(payload)
      const eq2 = {
        select: vi.fn(() => ({
          single: vi.fn(() =>
            Promise.resolve({
              data: {
                user_id: 'clerk-1',
                organization_id: 'org-1',
                is_primary_owner: false,
                user_roles: ['Permit Clerk'],
                company_name: 'Carrier Co',
              },
              error: null,
            })
          ),
        })),
      }
      const eq1 = { eq: vi.fn(() => eq2) }
      return { eq: vi.fn(() => eq1) }
    })

    await saveTeamMemberProfileForUser('token', {
      targetUserId: 'clerk-1',
      form: {
        ...emptyMemberProfileForm(),
        driver_full_name: 'Pat Clerk',
        company_name: 'Independent LLC',
        user_roles: ['Permit Clerk'],
      },
    })

    expect(updatePayloads[0]).toMatchObject({
      user_id: 'clerk-1',
      organization_id: 'org-1',
      is_primary_owner: false,
      user_roles: ['Permit Clerk'],
      company_name: 'Carrier Co',
      driver_full_name: 'Pat Clerk',
    })
    expect((updatePayloads[0] as { company_name: string }).company_name).not.toBe('Independent LLC')
  })

  it('rejects Owner role on non-primary other-member save', async () => {
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'owner-1', email: 'owner@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: ownerProfile,
      error: null,
    })
    supabaseMocks.mockMembershipRoleMaybeSingle.mockResolvedValue({
      data: { organization_id: 'org-1', role: 'Owner', is_primary_owner: true },
      error: null,
    })

    await expect(
      saveTeamMemberProfileForUser('token', {
        targetUserId: 'driver-1',
        form: {
          ...emptyMemberProfileForm(),
          driver_full_name: 'Bad',
          user_roles: ['Owner'],
        },
      })
    ).rejects.toThrow(/Only Admin, Driver, Permit Clerk, or Viewer/)
    expect(supabaseMocks.mockUpdate).not.toHaveBeenCalled()
  })

  it('Admin cannot demote primary owner via other-member save', async () => {
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        user_id: 'admin-1',
        organization_id: 'org-1',
        is_primary_owner: false,
        user_roles: ['Admin'],
        company_name: 'Carrier Co',
      },
      error: null,
    })
    supabaseMocks.mockMembershipRoleMaybeSingle.mockResolvedValue({
      data: { organization_id: 'org-1', role: 'Admin', is_primary_owner: false },
      error: null,
    })
    supabaseMocks.mockTargetMaybeSingle.mockResolvedValue({
      data: {
        user_id: 'owner-1',
        organization_id: 'org-1',
        is_primary_owner: true,
        user_roles: ['Owner', 'Driver'],
        company_name: 'Carrier Co',
        driver_full_name: 'Primary Owner',
      },
      error: null,
    })

    const updatePayloads: unknown[] = []
    supabaseMocks.mockUpdate.mockImplementation((payload: unknown) => {
      updatePayloads.push(payload)
      const eq2 = {
        select: vi.fn(() => ({
          single: vi.fn(() =>
            Promise.resolve({
              data: {
                ...(payload as object),
                user_id: 'owner-1',
              },
              error: null,
            })
          ),
        })),
      }
      const eq1 = { eq: vi.fn(() => eq2) }
      return { eq: vi.fn(() => eq1) }
    })

    await saveTeamMemberProfileForUser('token', {
      targetUserId: 'owner-1',
      form: {
        ...emptyMemberProfileForm(),
        driver_full_name: 'Primary Owner Updated',
        driver_phone: '555-9999',
        // Attempt demotion via assignable-only roles
        user_roles: ['Admin'],
      },
    })

    expect(updatePayloads[0]).toMatchObject({
      is_primary_owner: true,
      user_roles: ['Owner', 'Driver'],
      driver_full_name: 'Primary Owner Updated',
      driver_phone: '555-9999',
    })
  })

  it('rejects other-member save when target is not in actor org', async () => {
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'owner-1', email: 'owner@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: ownerProfile,
      error: null,
    })
    supabaseMocks.mockMembershipRoleMaybeSingle.mockResolvedValue({
      data: { organization_id: 'org-1', role: 'Owner', is_primary_owner: true },
      error: null,
    })
    supabaseMocks.mockTargetMaybeSingle.mockResolvedValue({ data: null, error: null })

    await expect(
      saveTeamMemberProfileForUser('token', {
        targetUserId: 'foreign-user',
        form: {
          ...emptyMemberProfileForm(),
          user_roles: ['Driver'],
        },
      })
    ).rejects.toThrow(/Team member not found/)
  })

  it('skips bootstrap and clamps roles for roster-linked self-save without member_profiles', async () => {
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    supabaseMocks.mockLinkedRosterMaybeSingle.mockResolvedValue({
      data: {
        id: 'roster-admin',
        organization_id: 'org-1',
        created_by_user_id: 'owner-1',
        user_roles: ['Admin'],
        driver_email: 'admin@example.com',
      },
      error: null,
    })
    supabaseMocks.mockMembershipLookupMaybeSingle.mockResolvedValue({ data: null, error: null })
    supabaseMocks.mockUpsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              user_id: 'admin-1',
              organization_id: 'org-1',
              is_primary_owner: false,
              user_roles: ['Admin'],
              driver_full_name: 'Org Admin',
            },
            error: null,
          })
        ),
      })),
    })

    await saveTeamMemberProfileForUser('token', {
      form: {
        ...emptyMemberProfileForm(),
        user_roles: ['Owner'],
        driver_full_name: 'Org Admin',
      },
      saveScope: 'member_only',
    })

    const profilePayload = supabaseMocks.mockUpsert.mock.calls[0][0]
    expect(profilePayload.organization_id).toBe('org-1')
    expect(profilePayload.is_primary_owner).toBe(false)
    expect(profilePayload.user_roles).toEqual(['Admin'])
    expect(supabaseMocks.callOrder).not.toContain('organizations.upsert')
  })

  it('skips bootstrap when only organization_memberships is visible', async () => {
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'driver-2', email: 'driver@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    supabaseMocks.mockLinkedRosterMaybeSingle.mockResolvedValue({ data: null, error: null })
    supabaseMocks.mockMembershipLookupMaybeSingle.mockResolvedValue({
      data: { organization_id: 'org-1', role: 'Driver' },
      error: null,
    })
    supabaseMocks.mockUpsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              user_id: 'driver-2',
              organization_id: 'org-1',
              is_primary_owner: false,
              user_roles: ['Driver'],
            },
            error: null,
          })
        ),
      })),
    })

    await saveTeamMemberProfileForUser('token', {
      form: {
        ...emptyMemberProfileForm(),
        user_roles: ['Owner'],
        driver_full_name: 'Dana Driver',
      },
      saveScope: 'member_only',
    })

    const profilePayload = supabaseMocks.mockUpsert.mock.calls[0][0]
    expect(profilePayload.organization_id).toBe('org-1')
    expect(profilePayload.user_roles).toEqual(['Driver'])
    expect(supabaseMocks.callOrder).not.toContain('organizations.upsert')
  })

  it('rejects non-primary-owner carrier_only self-save before upsert', async () => {
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'driver-1' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: driverProfile,
      error: null,
    })

    await expect(
      saveTeamMemberProfileForUser('token', {
        form: { ...emptyMemberProfileForm(), company_name: 'Hacked Carrier' },
        saveScope: 'carrier_only',
      })
    ).rejects.toThrow(
      'Forbidden – only primary owners or Owner/Admin accounts can save carrier-only updates'
    )

    expect(supabaseMocks.mockUpsert).not.toHaveBeenCalled()
  })

  it('allows forced carrier owner to update company name via carrier_only save', async () => {
    const updatedCompanyName = 'Andre Hauling LLC'
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'andre-1', email: FORCED_CARRIER_OWNER_EMAIL } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        ...driverProfile,
        user_id: 'andre-1',
        company_name: 'Old Carrier Name',
      },
      error: null,
    })
    supabaseMocks.mockAdminUpsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              user_id: 'andre-1',
              organization_id: 'org-1',
              is_primary_owner: true,
              user_roles: ['Owner', 'Driver'],
              company_name: updatedCompanyName,
            },
            error: null,
          })
        ),
      })),
    })

    const result = await saveTeamMemberProfileForUser('token', {
      form: { ...emptyMemberProfileForm(), company_name: updatedCompanyName },
      saveScope: 'carrier_only',
    })

    expect(supabaseMocks.mockAdminUpsert).toHaveBeenCalledTimes(1)
    expect(supabaseMocks.mockUpsert).not.toHaveBeenCalled()
    const upsertPayload = supabaseMocks.mockAdminUpsert.mock.calls[0][0]
    expect(upsertPayload.company_name).toBe(updatedCompanyName)
    expect(upsertPayload.is_primary_owner).toBe(true)
    expect(upsertPayload.user_roles).toEqual(['Owner', 'Driver'])
    expect(result.data.company_name).toBe(updatedCompanyName)
  })

  it('allows forced carrier owner Viewer to save carrier_only via admin upsert', async () => {
    const updatedCompanyName = 'Viewer Promoted Carrier'
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'andre-viewer', email: FORCED_CARRIER_OWNER_EMAIL } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        user_id: 'andre-viewer',
        organization_id: 'org-1',
        is_primary_owner: false,
        user_roles: ['Viewer'],
        company_name: 'Old Carrier Name',
      },
      error: null,
    })
    supabaseMocks.mockAdminUpsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              user_id: 'andre-viewer',
              organization_id: 'org-1',
              is_primary_owner: true,
              user_roles: ['Owner', 'Viewer'],
              company_name: updatedCompanyName,
            },
            error: null,
          })
        ),
      })),
    })

    const result = await saveTeamMemberProfileForUser('token', {
      form: { ...emptyMemberProfileForm(), company_name: updatedCompanyName },
      saveScope: 'carrier_only',
    })

    expect(supabaseMocks.mockAdminUpsert).toHaveBeenCalledTimes(1)
    expect(supabaseMocks.mockUpsert).not.toHaveBeenCalled()
    expect(result.data.company_name).toBe(updatedCompanyName)
  })

  it('rejects bootstrap carrier_only save without company name', async () => {
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'new-owner', email: 'owner@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })

    await expect(
      saveTeamMemberProfileForUser('token', {
        form: emptyMemberProfileForm(),
        saveScope: 'carrier_only',
      })
    ).rejects.toThrow('Company name is required.')

    expect(supabaseMocks.mockUpsert).not.toHaveBeenCalled()
    expect(supabaseMocks.mockAdminUpsert).not.toHaveBeenCalled()
  })

  it('clamps bootstrap carrier_only roles to Owner on null actorProfile', async () => {
    const companyName = 'Role Clamp Carrier'
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'new-owner', email: 'owner@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })
    supabaseMocks.mockUpsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              user_id: 'new-owner',
              organization_id: 'org-new',
              is_primary_owner: true,
              user_roles: ['Owner'],
              company_name: companyName,
            },
            error: null,
          })
        ),
      })),
    })

    await saveTeamMemberProfileForUser('token', {
      form: { ...emptyMemberProfileForm(), company_name: companyName, user_roles: ['Admin'] },
      saveScope: 'carrier_only',
    })

    const upsertPayload = supabaseMocks.mockUpsert.mock.calls[0][0]
    expect(upsertPayload.user_roles).toEqual(['Owner'])
  })

  it('bootstraps organization for forced carrier owner with null actorProfile', async () => {
    const companyName = 'New Bootstrap Carrier'
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'andre-new', email: FORCED_CARRIER_OWNER_EMAIL } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })
    supabaseMocks.mockAdminUpsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              user_id: 'andre-new',
              organization_id: 'org-new',
              is_primary_owner: true,
              user_roles: ['Owner'],
              company_name: companyName,
            },
            error: null,
          })
        ),
      })),
    })

    const result = await saveTeamMemberProfileForUser('token', {
      form: { ...emptyMemberProfileForm(), company_name: companyName },
      saveScope: 'carrier_only',
    })

    expect(supabaseMocks.mockAdminUpsert).toHaveBeenCalledTimes(1)
    const upsertPayload = supabaseMocks.mockAdminUpsert.mock.calls[0][0]
    expect(upsertPayload.is_primary_owner).toBe(true)
    expect(upsertPayload.organization_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(upsertPayload.company_name).toBe(companyName)
    expect(supabaseMocks.mockAdminOrgUpsert).toHaveBeenCalled()
    expect(supabaseMocks.mockAuthedOrgUpsert).not.toHaveBeenCalled()
    expect(result.data.company_name).toBe(companyName)
  })

  it('allows forced carrier owner full save via admin upsert on null profile bootstrap', async () => {
    const companyName = 'Full Bootstrap Carrier'
    const driverPhone = '555-0199'
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'andre-new', email: FORCED_CARRIER_OWNER_EMAIL } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })
    supabaseMocks.mockAdminUpsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              user_id: 'andre-new',
              organization_id: 'org-new',
              is_primary_owner: true,
              user_roles: ['Owner'],
              company_name: companyName,
              driver_phone: driverPhone,
            },
            error: null,
          })
        ),
      })),
    })

    const result = await saveTeamMemberProfileForUser('token', {
      form: {
        ...emptyMemberProfileForm(),
        company_name: companyName,
        driver_full_name: 'Andre Owner',
        driver_email: FORCED_CARRIER_OWNER_EMAIL,
        driver_phone: driverPhone,
      },
      saveScope: 'full',
    })

    expect(supabaseMocks.mockAdminUpsert).toHaveBeenCalledTimes(1)
    expect(supabaseMocks.mockUpsert).not.toHaveBeenCalled()
    expect(supabaseMocks.mockAdminOrgUpsert).toHaveBeenCalled()
    expect(supabaseMocks.mockAuthedOrgUpsert).not.toHaveBeenCalled()
    const upsertPayload = supabaseMocks.mockAdminUpsert.mock.calls[0][0]
    expect(upsertPayload.is_primary_owner).toBe(true)
    expect(upsertPayload.company_name).toBe(companyName)
    expect(upsertPayload.driver_phone).toBe(driverPhone)
    expect(result.data.company_name).toBe(companyName)
  })

  it('creates organization before member_profiles upsert on null profile bootstrap', async () => {
    const companyName = 'FK Safe Carrier'
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'new-owner', email: 'owner@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })
    supabaseMocks.mockUpsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              user_id: 'new-owner',
              organization_id: 'org-fk-safe',
              is_primary_owner: true,
              user_roles: ['Owner'],
              company_name: companyName,
            },
            error: null,
          })
        ),
      })),
    })

    await saveTeamMemberProfileForUser('token', {
      form: {
        ...emptyMemberProfileForm(),
        company_name: companyName,
        driver_full_name: 'Pat Owner',
        driver_email: 'owner@example.com',
        user_roles: ['Owner'],
      },
      saveScope: 'full',
    })

    expect(supabaseMocks.callOrder.indexOf('organizations.upsert')).toBeGreaterThanOrEqual(0)
    expect(supabaseMocks.callOrder.indexOf('member_profiles.upsert')).toBeGreaterThanOrEqual(0)
    expect(supabaseMocks.callOrder.indexOf('organizations.upsert')).toBeLessThan(
      supabaseMocks.callOrder.indexOf('member_profiles.upsert')
    )

    const orgPayload = supabaseMocks.mockAuthedOrgUpsert.mock.calls.find(
      (call) => typeof call[0]?.id === 'string'
    )?.[0]
    const profilePayload = supabaseMocks.mockUpsert.mock.calls[0][0]
    expect(orgPayload?.id).toBe(profilePayload.organization_id)
    expect(orgPayload?.name).toBe(companyName)
    expect(profilePayload.organization_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  it('persists Owner Operator roles on full bootstrap save', async () => {
    const companyName = 'Owner Operator Hauling'
    const fullName = 'Pat Owner'
    const companyPhone = '555-0100'
    const cellPhone = '555-0100'
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'owner-op-1', email: 'owner@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })
    supabaseMocks.mockUpsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              user_id: 'owner-op-1',
              organization_id: 'org-owner-op',
              is_primary_owner: true,
              user_roles: ['Owner', 'Driver'],
              company_name: companyName,
              driver_full_name: fullName,
              carrier_phone: companyPhone,
              driver_phone: cellPhone,
              driver_email: 'owner@example.com',
              carrier_email: 'owner@example.com',
            },
            error: null,
          })
        ),
      })),
    })

    const result = await saveTeamMemberProfileForUser('token', {
      form: {
        ...emptyMemberProfileForm(),
        company_name: companyName,
        driver_full_name: fullName,
        driver_email: 'owner@example.com',
        carrier_phone: companyPhone,
        driver_phone: cellPhone,
        user_roles: ['Owner', 'Driver'],
      },
      saveScope: 'full',
    })

    expect(supabaseMocks.mockUpsert).toHaveBeenCalledTimes(1)
    const upsertPayload = supabaseMocks.mockUpsert.mock.calls[0][0]
    expect(upsertPayload.user_roles).toEqual(['Owner', 'Driver'])
    expect(upsertPayload.driver_full_name).toBe(fullName)
    expect(upsertPayload.carrier_phone).toBe(companyPhone)
    expect(upsertPayload.driver_phone).toBe(cellPhone)
    expect(result.data.user_roles).toEqual(['Owner', 'Driver'])
  })

  it('allows forced carrier owner full save via admin upsert when promoting org-linked non-primary owner', async () => {
    const updatedCompanyName = 'Full Promoted Carrier'
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'andre-1', email: FORCED_CARRIER_OWNER_EMAIL } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        user_id: 'andre-1',
        organization_id: 'org-1',
        is_primary_owner: false,
        user_roles: ['Owner'],
        company_name: 'Old Carrier Name',
      },
      error: null,
    })
    supabaseMocks.mockAdminUpsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              user_id: 'andre-1',
              organization_id: 'org-1',
              is_primary_owner: true,
              user_roles: ['Owner'],
              company_name: updatedCompanyName,
            },
            error: null,
          })
        ),
      })),
    })

    const result = await saveTeamMemberProfileForUser('token', {
      form: {
        ...emptyMemberProfileForm(),
        company_name: updatedCompanyName,
      },
      saveScope: 'full',
    })

    expect(supabaseMocks.mockAdminUpsert).toHaveBeenCalledTimes(1)
    expect(supabaseMocks.mockUpsert).not.toHaveBeenCalled()
    const upsertPayload = supabaseMocks.mockAdminUpsert.mock.calls[0][0]
    expect(upsertPayload.is_primary_owner).toBe(true)
    expect(upsertPayload.company_name).toBe(updatedCompanyName)
    expect(result.data.company_name).toBe(updatedCompanyName)
  })

  it('throws when forced carrier owner needs promotion but admin access is missing', async () => {
    supabaseMocks.adminAccessState.hasAdminAccess = false
    supabaseMocks.adminAccessState.supabaseAdmin = null
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'andre-1', email: FORCED_CARRIER_OWNER_EMAIL } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        ...driverProfile,
        user_id: 'andre-1',
        is_primary_owner: false,
      },
      error: null,
    })

    await expect(
      saveTeamMemberProfileForUser('token', {
        form: { ...emptyMemberProfileForm(), company_name: 'Needs Admin' },
        saveScope: 'carrier_only',
      })
    ).rejects.toThrow(
      'Carrier save requires SUPABASE_SERVICE_ROLE_KEY on server for account promotion.'
    )

    expect(supabaseMocks.mockUpsert).not.toHaveBeenCalled()
    expect(supabaseMocks.mockAdminUpsert).not.toHaveBeenCalled()
  })

  it('throws when forced carrier owner full bootstrap needs admin but access is missing', async () => {
    supabaseMocks.adminAccessState.hasAdminAccess = false
    supabaseMocks.adminAccessState.supabaseAdmin = null
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'andre-new', email: FORCED_CARRIER_OWNER_EMAIL } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })

    await expect(
      saveTeamMemberProfileForUser('token', {
        form: {
          ...emptyMemberProfileForm(),
          company_name: 'Bootstrap Needs Admin',
          driver_full_name: 'Andre Owner',
          driver_email: FORCED_CARRIER_OWNER_EMAIL,
        },
        saveScope: 'full',
      })
    ).rejects.toThrow(
      'Carrier save requires SUPABASE_SERVICE_ROLE_KEY on server for account promotion.'
    )

    expect(supabaseMocks.mockUpsert).not.toHaveBeenCalled()
    expect(supabaseMocks.mockAdminUpsert).not.toHaveBeenCalled()
  })

  it('runs ensureOrganizationBootstrap on admin client for forced carrier owner carrier_only', async () => {
    const updatedCompanyName = 'Admin Bootstrap Org'
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'andre-1', email: FORCED_CARRIER_OWNER_EMAIL } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        ...driverProfile,
        user_id: 'andre-1',
        is_primary_owner: false,
        user_roles: ['Viewer'],
        company_name: 'Old Carrier Name',
      },
      error: null,
    })
    supabaseMocks.mockAuthedOrgUpsert.mockResolvedValue({
      error: { message: 'new row violates row-level security policy' },
    })
    supabaseMocks.mockAdminUpsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              user_id: 'andre-1',
              organization_id: 'org-1',
              is_primary_owner: true,
              user_roles: ['Owner', 'Viewer'],
              company_name: updatedCompanyName,
            },
            error: null,
          })
        ),
      })),
    })

    const result = await saveTeamMemberProfileForUser('token', {
      form: { ...emptyMemberProfileForm(), company_name: updatedCompanyName },
      saveScope: 'carrier_only',
    })

    expect(supabaseMocks.mockAdminUpsert).toHaveBeenCalledTimes(1)
    expect(supabaseMocks.mockAdminOrgUpsert).toHaveBeenCalled()
    expect(supabaseMocks.mockAuthedOrgUpsert).not.toHaveBeenCalled()
    expect(result.data.company_name).toBe(updatedCompanyName)
  })

  it('blocks self-promote to Permit Clerk when previous membership role is Owner', async () => {
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'owner-1', email: 'owner@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: { ...ownerProfile, user_roles: ['Owner'] },
      error: null,
    })
    supabaseMocks.mockMembershipLookupMaybeSingle.mockResolvedValue({
      data: {
        organization_id: 'org-1',
        role: 'Owner',
        is_primary_owner: true,
        created_at: '2020-01-01T00:00:00Z',
      },
      error: null,
    })
    supabaseMocks.mockMembershipRoleMaybeSingle.mockResolvedValue({
      data: { role: 'Owner' },
      error: null,
    })
    supabaseMocks.mockUpsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              ...ownerProfile,
              user_roles: ['Permit Clerk'],
            },
            error: null,
          })
        ),
      })),
    })

    await expect(
      saveTeamMemberProfileForUser('token', {
        form: {
          ...emptyMemberProfileForm(),
          user_roles: ['Permit Clerk'],
          driver_full_name: 'Self Promote',
        },
        saveScope: 'full',
      })
    ).rejects.toThrow(/own membership role to Permit Clerk/i)

    expect(supabaseMocks.callOrder).not.toContain('organization_memberships.upsert')
  })

  it('allows stay-as-Clerk self sync when previous membership role is Permit Clerk', async () => {
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'clerk-1', email: 'clerk@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        user_id: 'clerk-1',
        organization_id: 'org-1',
        is_primary_owner: true,
        user_roles: ['Permit Clerk'],
        company_name: 'Bureau Co',
      },
      error: null,
    })
    supabaseMocks.mockMembershipLookupMaybeSingle.mockResolvedValue({
      data: {
        organization_id: 'org-1',
        role: 'Permit Clerk',
        is_primary_owner: true,
        created_at: '2020-01-01T00:00:00Z',
      },
      error: null,
    })
    supabaseMocks.mockMembershipRoleMaybeSingle.mockResolvedValue({
      data: { role: 'Permit Clerk' },
      error: null,
    })
    supabaseMocks.mockUpsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              user_id: 'clerk-1',
              organization_id: 'org-1',
              is_primary_owner: true,
              user_roles: ['Permit Clerk'],
              driver_phone: '555-9999',
            },
            error: null,
          })
        ),
      })),
    })
    supabaseMocks.mockAuthedOrgUpsert.mockResolvedValue({ error: null })

    await expect(
      saveTeamMemberProfileForUser('token', {
        form: {
          ...emptyMemberProfileForm(),
          user_roles: ['Permit Clerk'],
          driver_phone: '555-9999',
        },
        saveScope: 'full',
      })
    ).resolves.toMatchObject({ source: 'member_profile' })

    expect(supabaseMocks.callOrder).toContain('organization_memberships.upsert')
  })
})

describe('ensureOrganizationMembership self-Clerk PE', () => {
  /**
   * Behavioral coverage: saveTeamMemberProfileForUser "blocks self-promote…" hits
   * ensureOrganizationBootstrap → ensureOrganizationMembership PE for primary owners.
   * This source lock documents the bootstrap path still wires the same assert.
   */
  it('asserts self-promote PE before primary-owner membership upsert (source + behavioral path)', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'lib', 'team-member-profiles-api.ts'),
      'utf8'
    )
    const ensureStart = source.indexOf('async function ensureOrganizationMembership')
    expect(ensureStart).toBeGreaterThan(-1)
    const ensureFn = source.slice(ensureStart, ensureStart + 1200)
    expect(ensureFn).toContain('assertNotSelfPromoteToPermitClerk')
    expect(ensureFn).toContain("nextRole === 'Permit Clerk'")
    expect(ensureFn).toContain("select('role')")
    expect(ensureFn).toContain('previousRole')
    // Wired from bootstrap for primary owners
    expect(source).toContain('await ensureOrganizationMembership(membershipClient, userId, profile)')
  })
})

describe('saveTeamMemberProfileForUser bootstrap gate', () => {
  it('mirrors validateBootstrapCarrierSaveRoles before carrier_only upsert when actor lacks organization_id', () => {
    const source = readFileSync(path.join(process.cwd(), 'lib', 'team-member-profiles-api.ts'), 'utf8')

    expect(source).toContain('validateBootstrapCarrierSaveRoles')
    expect(source).toContain('isForcedCarrierOwner')
    expect(source).toContain('forcedCarrierOwnerNeedsAdminPromotion')
    expect(source).toContain('hasAdminAccess')
    expect(source).toContain('supabaseAdmin')
    expect(source).toMatch(
      /forcedCarrierOwner && hasAdminAccess && supabaseAdmin \? supabaseAdmin : supabase/
    )
    expect(source).toContain('ensureOrganizationRecord')
    expect(source).toMatch(/ensureOrganizationBootstrap\(upsertClient, userId, data as MemberProfile/)
    expect(source).toContain('isNewOrganizationBootstrap')
    expect(source).toMatch(/bootstrappingNewOrg[\s\S]*ensureOrganizationRecord/)
    expect(source).toContain(
      'Carrier save requires SUPABASE_SERVICE_ROLE_KEY on server for account promotion.'
    )
    expect(source).toContain('normalizeBootstrapSelfRoles')
    expect(source).toContain('validateBootstrapSelfSave')
    expect(source).toContain('validateBootstrapCarrierOnlySave')
    expect(source).toContain('needsPrimaryOwnerBootstrap')
    expect(source).toContain('fetchActorTeamContext')
    expect(source).toContain('clampSelfSaveRolesFromTeamContext')
    expect(source).toContain('resolveSelfSaveOrganizationId')
    expect(source).toMatch(/shouldBootstrap[\s\S]*validateBootstrapSelfSave\(formForSave\)/)
    expect(source).toMatch(/shouldBootstrap[\s\S]*validateBootstrapCarrierOnlySave\(formForSave\)/)
    expect(source).toMatch(/shouldBootstrap[\s\S]*normalizeBootstrapSelfRoles/)
    expect(source).toMatch(
      /shouldBootstrap[\s\S]*validateBootstrapCarrierSaveRoles\(formForSave, actorProfile, actorEmail\)/
    )
    expect(source).toMatch(
      /saveScope === 'carrier_only' && forcedCarrierOwner[\s\S]*ensureBootstrapOwnerRoles\(formForSave\)/
    )
    expect(source).toMatch(/roleCheck\.ok === false[\s\S]*throw new Error\(roleCheck\.message\)/)
    expect(source).toContain(
      'Forbidden – only primary owners or Owner/Admin accounts can save carrier-only updates'
    )
  })

  it('auto-assigns Owner / Admin before bootstrap carrier validation', () => {
    expect(
      validateBootstrapCarrierSaveRoles(
        { ...emptyMemberProfileForm(), company_name: 'Acme' },
        null
      ).ok
    ).toBe(true)
    expect(readFileSync(path.join(process.cwd(), 'lib', 'team-member-profiles-api.ts'), 'utf8')).toContain(
      'ensureBootstrapOwnerRoles'
    )
  })
})

describe('deleteTeamMemberForUser', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.clearAllMocks()
    deletionMocks.mockCreateDeletionRequest.mockReset()

    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'owner-1' } },
      error: null,
    })

    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: ownerProfile,
      error: null,
    })

    supabaseMocks.mockTargetMaybeSingle.mockResolvedValue({
      data: {
        is_primary_owner: false,
        user_roles: ['Driver'],
      },
      error: null,
    })

    supabaseMocks.mockDelete.mockResolvedValue({ error: null })

    supabaseMocks.mockFrom.mockImplementation((table: string) => {
      if (table === 'member_profiles') {
        return {
          select: vi.fn((columns?: string) => {
            const isTargetLookup =
              typeof columns === 'string' && columns.includes('is_primary_owner')
            if (isTargetLookup) {
              return {
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    maybeSingle: supabaseMocks.mockTargetMaybeSingle,
                  })),
                })),
              }
            }
            return {
              eq: vi.fn(() => ({
                maybeSingle: supabaseMocks.mockMaybeSingle,
              })),
            }
          }),
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => supabaseMocks.mockDelete()),
            })),
          })),
        }
      }

      if (table === 'organization_memberships') {
        const chain: {
          eq: ReturnType<typeof vi.fn>
          maybeSingle: ReturnType<typeof vi.fn>
        } = {
          eq: vi.fn(() => chain),
          // Align membership role with actor home profile mock for membership-first authz.
          maybeSingle: vi.fn(async () => {
            const actorResult = await supabaseMocks.mockMaybeSingle()
            const actor = actorResult?.data as
              | {
                  organization_id?: string
                  user_roles?: string[]
                  is_primary_owner?: boolean
                }
              | null
              | undefined
            const roles = actor?.user_roles ?? ['Owner']
            const role = roles.includes('Owner')
              ? 'Owner'
              : roles.includes('Admin')
                ? 'Admin'
                : roles.includes('Permit Clerk')
                  ? 'Permit Clerk'
                  : roles.includes('Driver')
                    ? 'Driver'
                    : roles.includes('Viewer')
                      ? 'Viewer'
                      : 'Owner'
            return {
              data: {
                organization_id: actor?.organization_id ?? 'org-1',
                role,
                is_primary_owner: actor?.is_primary_owner === true,
              },
              error: null,
            }
          }),
        }
        return {
          select: vi.fn(() => chain),
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => supabaseMocks.mockDelete()),
            })),
          })),
        }
      }

      if (table === 'team_member_profiles') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => supabaseMocks.mockDelete()),
            })),
          })),
        }
      }

      return {}
    })
  })

  it('allows Owner to directly delete a team member', async () => {
    const result = await deleteTeamMemberForUser('token', {
      source: 'member_profile',
      id: 'driver-1',
      userId: 'driver-1',
    })

    expect(result.deleted).toBe(true)
    expect(result.source).toBe('member_profile')
    expect(deletionMocks.mockCreateDeletionRequest).not.toHaveBeenCalled()
    expect(supabaseMocks.mockDelete).toHaveBeenCalled()
  })

  it('allows Admin to directly delete a team member', async () => {
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        ...ownerProfile,
        user_id: 'admin-1',
        is_primary_owner: false,
        user_roles: ['Admin'],
      },
      error: null,
    })
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1' } },
      error: null,
    })

    const result = await deleteTeamMemberForUser('token', {
      source: 'member_profile',
      id: 'driver-1',
      userId: 'driver-1',
    })

    expect(result.deleted).toBe(true)
    expect(deletionMocks.mockCreateDeletionRequest).not.toHaveBeenCalled()
  })

  it('creates a deletion request for Permit Clerk instead of direct delete', async () => {
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        ...ownerProfile,
        user_id: 'clerk-1',
        is_primary_owner: false,
        user_roles: ['Permit Clerk'],
      },
      error: null,
    })
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'clerk-1' } },
      error: null,
    })
    deletionMocks.mockCreateDeletionRequest.mockResolvedValue({
      id: 'req-1',
      status: 'pending',
      resource_type: 'team_member',
      resource_id: 'driver-1',
    })

    const result = await deleteTeamMemberForUser('token', {
      source: 'member_profile',
      id: 'driver-1',
      userId: 'driver-1',
    })

    expect(result.deleted).toBe(false)
    expect(result.deletion_request).toMatchObject({ id: 'req-1', status: 'pending' })
    expect(deletionMocks.mockCreateDeletionRequest).toHaveBeenCalledTimes(1)
    expect(supabaseMocks.mockDelete).not.toHaveBeenCalled()
  })

  it('forbids Viewer from deleting team members', async () => {
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        ...ownerProfile,
        user_id: 'viewer-1',
        is_primary_owner: false,
        user_roles: ['Viewer'],
      },
      error: null,
    })
    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'viewer-1' } },
      error: null,
    })

    await expect(
      deleteTeamMemberForUser('token', {
        source: 'member_profile',
        id: 'driver-1',
        userId: 'driver-1',
      })
    ).rejects.toThrow('Forbidden – cannot delete this team member')
  })

  it('forbids deleting a primary owner target', async () => {
    supabaseMocks.mockTargetMaybeSingle.mockResolvedValue({
      data: {
        is_primary_owner: true,
        user_roles: ['Owner'],
      },
      error: null,
    })

    await expect(
      deleteTeamMemberForUser('token', {
        source: 'member_profile',
        id: 'other-owner',
        userId: 'other-owner',
      })
    ).rejects.toThrow('Forbidden – cannot delete this team member')
    expect(supabaseMocks.mockDelete).not.toHaveBeenCalled()
    expect(deletionMocks.mockCreateDeletionRequest).not.toHaveBeenCalled()
  })

  it('forbids deleting a primary owner even when user_roles lacks Owner', async () => {
    supabaseMocks.mockTargetMaybeSingle.mockResolvedValue({
      data: {
        is_primary_owner: true,
        user_roles: ['Driver'],
      },
      error: null,
    })

    await expect(
      deleteTeamMemberForUser('token', {
        source: 'member_profile',
        id: 'other-owner',
        userId: 'other-owner',
      })
    ).rejects.toThrow('Forbidden – cannot delete this team member')
    expect(supabaseMocks.mockDelete).not.toHaveBeenCalled()
  })

  it('forbids deleting a non-primary Owner role target', async () => {
    supabaseMocks.mockTargetMaybeSingle.mockResolvedValue({
      data: {
        is_primary_owner: false,
        user_roles: ['Owner'],
      },
      error: null,
    })

    await expect(
      deleteTeamMemberForUser('token', {
        source: 'member_profile',
        id: 'owner-role-user',
        userId: 'owner-role-user',
      })
    ).rejects.toThrow('Forbidden – cannot delete this team member')
    expect(supabaseMocks.mockDelete).not.toHaveBeenCalled()
  })

  it('forbids deleting primary owner with legacy Owner / Admin roles', async () => {
    supabaseMocks.mockTargetMaybeSingle.mockResolvedValue({
      data: {
        is_primary_owner: true,
        user_roles: ['Owner / Admin'],
      },
      error: null,
    })

    await expect(
      deleteTeamMemberForUser('token', {
        source: 'member_profile',
        id: 'legacy-owner',
        userId: 'legacy-owner',
      })
    ).rejects.toThrow('Forbidden – cannot delete this team member')
    expect(supabaseMocks.mockDelete).not.toHaveBeenCalled()
  })
})

describe('carrier-only save payload integration', () => {
  it('preserves organization_id and company_name through scoped form and upsert prep', () => {
    const form = {
      ...emptyMemberProfileForm(),
      company_name: 'Renamed Carrier LLC',
      usdot_number: '7654321',
    }
    const scoped = selfSaveFormForActor(form, ownerProfile, 'carrier_only')
    const apiPayload = buildCarrierOnlyApiSavePayload(scoped, ownerProfile)
    const upsertPayload = prepareMemberProfileSave(scoped, ownerProfile.user_id!, ownerProfile)

    expect(apiPayload).toMatchObject({
      organization_id: 'org-1',
      company_name: 'Renamed Carrier LLC',
      usdot_number: '7654321',
    })
    expect(upsertPayload.organization_id).toBe('org-1')
    expect(upsertPayload.company_name).toBe('Renamed Carrier LLC')
  })

  it('bootstraps organization_id when no existing profile row', () => {
    const form = {
      ...emptyMemberProfileForm(),
      company_name: 'Bootstrap Carrier',
      user_roles: ['Owner'],
    }
    const scoped = selfSaveFormForActor(form, null, 'carrier_only')
    const apiPayload = buildCarrierOnlyApiSavePayload(scoped, null)
    const upsertPayload = prepareMemberProfileSave(scoped, 'new-user', null)

    expect(apiPayload.organization_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(apiPayload.company_name).toBe('Bootstrap Carrier')
    expect(upsertPayload.organization_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(upsertPayload.is_primary_owner).toBe(true)
    expect(upsertPayload.company_name).toBe('Bootstrap Carrier')
  })
})

describe('createOrUpdateRosterMemberForUser', () => {
  const mockRosterInsert = vi.fn()
  const mockRosterUpdate = vi.fn()

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.clearAllMocks()

    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'owner-1' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: ownerProfile,
      error: null,
    })

    mockRosterInsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              id: 'roster-1',
              organization_id: 'org-1',
              driver_full_name: 'New Driver',
              permissions: { mode: 'custom', custom: { equipment: true, profiles: false, account_settings: false } },
            },
            error: null,
          })
        ),
      })),
    })

    mockRosterUpdate.mockReturnValue({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({
                data: {
                  id: 'roster-1',
                  organization_id: 'org-1',
                  driver_full_name: 'Updated Driver',
                  permissions: { mode: 'global' },
                },
                error: null,
              })
            ),
          })),
        })),
      })),
    })

    supabaseMocks.mockFrom.mockImplementation((table: string) => {
      if (table === 'member_profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: supabaseMocks.mockMaybeSingle,
            })),
          })),
        }
      }

      if (table === 'team_member_profiles') {
        return {
          insert: mockRosterInsert,
          update: mockRosterUpdate,
        }
      }

      if (table === 'organization_memberships') {
        const chain: {
          eq: ReturnType<typeof vi.fn>
          maybeSingle: ReturnType<typeof vi.fn>
        } = {
          eq: vi.fn(() => chain),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              organization_id: 'org-1',
              role: 'Owner',
              is_primary_owner: true,
            },
            error: null,
          }),
        }
        return {
          select: vi.fn(() => chain),
        }
      }

      return {}
    })
  })

  it('inserts roster member with permissions payload for new team member save', async () => {
    const permissions = {
      mode: 'custom' as const,
      custom: {
        equipment: true,
        profiles: false,
        account_settings: false,
      },
    }

    const result = await createOrUpdateRosterMemberForUser('token', {
      form: {
        ...emptyMemberProfileForm(),
        driver_full_name: 'New Driver',
        driver_email: 'newdriver@example.com',
        user_roles: ['Driver'],
      },
      permissions,
    })

    expect(mockRosterInsert).toHaveBeenCalledTimes(1)
    const insertPayload = mockRosterInsert.mock.calls[0][0]
    expect(insertPayload.permissions).toEqual(permissions)
    expect(insertPayload.organization_id).toBe('org-1')
    expect(result.source).toBe('team_member_profile')
    expect(result.data.permissions).toEqual(permissions)
  })

  it('inserts Permit Clerk as child under parent carrier org with inherited carrier fields', async () => {
    const result = await createOrUpdateRosterMemberForUser('token', {
      form: {
        ...emptyMemberProfileForm(),
        driver_full_name: 'Pat Permit',
        driver_email: 'pat@example.com',
        company_name: 'Independent Shell LLC',
        usdot_number: '1111111',
        user_roles: ['Permit Clerk'],
      },
    })

    expect(mockRosterInsert).toHaveBeenCalledTimes(1)
    const insertPayload = mockRosterInsert.mock.calls[0][0]
    expect(insertPayload.organization_id).toBe(ownerProfile.organization_id)
    expect(insertPayload.user_roles).toEqual(['Permit Clerk'])
    // Parent carrier denormalized for display — not the client-supplied independent company
    expect(insertPayload.company_name).toBe(ownerProfile.company_name)
    expect(insertPayload.company_name).not.toBe('Independent Shell LLC')
    expect(insertPayload.usdot_number).toBeNull()
    expect(insertPayload).not.toHaveProperty('is_primary_owner')
    expect(result.source).toBe('team_member_profile')

    // Never touch organizations bootstrap on roster path
    const tables = supabaseMocks.mockFrom.mock.calls.map((call: unknown[]) => call[0])
    expect(tables).not.toContain('organizations')
  })

  it('rejects Owner role when creating a roster team member', async () => {
    await expect(
      createOrUpdateRosterMemberForUser('token', {
        form: {
          ...emptyMemberProfileForm(),
          driver_full_name: 'Bad Owner',
          user_roles: ['Owner'],
        },
      })
    ).rejects.toThrow(/Only Admin, Driver, Permit Clerk, or Viewer/)
    expect(mockRosterInsert).not.toHaveBeenCalled()
  })

  it('rejects Owner role when updating a roster team member', async () => {
    await expect(
      createOrUpdateRosterMemberForUser('token', {
        id: 'roster-1',
        form: {
          ...emptyMemberProfileForm(),
          driver_full_name: 'Bad Owner',
          user_roles: ['Owner'],
        },
      })
    ).rejects.toThrow(/Only Admin, Driver, Permit Clerk, or Viewer/)
    expect(mockRosterUpdate).not.toHaveBeenCalled()
  })

  it('requires at least one role on new roster insert', async () => {
    await expect(
      createOrUpdateRosterMemberForUser('token', {
        form: {
          ...emptyMemberProfileForm(),
          driver_full_name: 'No Role',
          user_roles: [],
        },
      })
    ).rejects.toThrow(/At least one role is required/)
    expect(mockRosterInsert).not.toHaveBeenCalled()
  })

  it('allows empty roles on roster update (partial personal-field edits)', async () => {
    await createOrUpdateRosterMemberForUser('token', {
      id: 'roster-1',
      form: {
        ...emptyMemberProfileForm(),
        driver_full_name: 'Updated Name',
        user_roles: [],
      },
    })
    expect(mockRosterUpdate).toHaveBeenCalled()
  })

  it('inserts roster member without explicit permissions and relies on DB default', async () => {
    mockRosterInsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              id: 'roster-2',
              organization_id: 'org-1',
              driver_full_name: 'Default Perms Driver',
              permissions: { mode: 'global' },
            },
            error: null,
          })
        ),
      })),
    })

    const result = await createOrUpdateRosterMemberForUser('token', {
      form: {
        ...emptyMemberProfileForm(),
        driver_full_name: 'Default Perms Driver',
        driver_email: 'default@example.com',
        user_roles: ['Driver'],
      },
    })

    const insertPayload = mockRosterInsert.mock.calls[0][0]
    expect(insertPayload.permissions).toBeUndefined()
    expect(result.data.permissions).toEqual({ mode: 'global' })
  })

  it('updates roster member with permissions payload', async () => {
    const permissions = {
      mode: 'custom' as const,
      custom: {
        equipment: false,
        profiles: true,
        account_settings: false,
      },
    }

    const result = await createOrUpdateRosterMemberForUser('token', {
      id: 'roster-1',
      form: {
        ...emptyMemberProfileForm(),
        driver_full_name: 'Updated Driver',
        driver_email: 'updated@example.com',
        user_roles: ['Driver'],
      },
      permissions,
    })

    expect(mockRosterUpdate).toHaveBeenCalledTimes(1)
    const updatePayload = mockRosterUpdate.mock.calls[0][0]
    expect(updatePayload.permissions).toEqual(permissions)
    expect(result.data.permissions).toEqual({ mode: 'global' })
  })

  it('writes permissions for primary owner without Owner/Admin role in user_roles', async () => {
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: {
        ...ownerProfile,
        user_roles: ['Driver'],
        is_primary_owner: true,
      },
      error: null,
    })

    const permissions = {
      mode: 'custom' as const,
      custom: {
        equipment: true,
        profiles: true,
        account_settings: false,
      },
    }

    await createOrUpdateRosterMemberForUser('token', {
      form: {
        ...emptyMemberProfileForm(),
        driver_full_name: 'Owner Saved Driver',
        driver_email: 'owner-saved@example.com',
        user_roles: ['Driver'],
      },
      permissions,
    })

    const insertPayload = mockRosterInsert.mock.calls.at(-1)?.[0]
    expect(insertPayload.permissions).toEqual(permissions)
  })
})

describe('membership sync hygiene (linked roster + primary preserve)', () => {
  const mockRosterUpdate = vi.fn()
  const mockMembershipUpsert = vi.fn()
  const mockMembershipMaybeSingle = vi.fn()
  const mockLinkedMemberMaybeSingle = vi.fn()

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.clearAllMocks()

    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'owner-1' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: ownerProfile,
      error: null,
    })

    mockLinkedMemberMaybeSingle.mockResolvedValue({
      data: { user_id: 'linked-1' },
      error: null,
    })

    mockMembershipMaybeSingle.mockResolvedValue({
      data: {
        role: 'Admin',
        permissions: {
          mode: 'custom',
          custom: { equipment: true, profiles: true, account_settings: false },
        },
        is_primary_owner: false,
      },
      error: null,
    })

    mockMembershipUpsert.mockResolvedValue({ error: null })

    mockRosterUpdate.mockReturnValue({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({
                data: {
                  id: 'roster-1',
                  organization_id: 'org-1',
                  linked_user_id: 'linked-1',
                  user_roles: ['Viewer'],
                },
                error: null,
              })
            ),
          })),
        })),
      })),
    })

    // Authz lookup returns Owner primary; sync lookup uses mockMembershipMaybeSingle after.
    let membershipSelectCount = 0
    supabaseMocks.mockFrom.mockImplementation((table: string) => {
      if (table === 'member_profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: supabaseMocks.mockMaybeSingle,
              eq: vi.fn(() => ({
                maybeSingle: mockLinkedMemberMaybeSingle,
              })),
            })),
          })),
        }
      }

      if (table === 'team_member_profiles') {
        return {
          update: mockRosterUpdate,
        }
      }

      if (table === 'organization_memberships') {
        const chain: {
          eq: ReturnType<typeof vi.fn>
          maybeSingle: ReturnType<typeof vi.fn>
        } = {
          eq: vi.fn(() => chain),
          maybeSingle: vi.fn(async () => {
            membershipSelectCount += 1
            // First select: acting authz for actor; later: sync of linked membership.
            if (membershipSelectCount === 1) {
              return {
                data: {
                  organization_id: 'org-1',
                  role: 'Owner',
                  is_primary_owner: true,
                  permissions: { mode: 'global' },
                },
                error: null,
              }
            }
            return mockMembershipMaybeSingle()
          }),
        }
        return {
          select: vi.fn(() => chain),
          upsert: mockMembershipUpsert,
        }
      }

      return {}
    })
  })

  it('syncs membership role for linked roster update and preserves custom perms when role unchanged', async () => {
    mockMembershipMaybeSingle.mockResolvedValue({
      data: {
        role: 'Driver',
        permissions: {
          mode: 'custom',
          custom: { equipment: true, profiles: false, account_settings: false },
        },
        is_primary_owner: false,
      },
      error: null,
    })

    await createOrUpdateRosterMemberForUser('token', {
      id: 'roster-1',
      linkedUserId: 'linked-1',
      form: {
        ...emptyMemberProfileForm(),
        driver_full_name: 'Linked Driver',
        user_roles: ['Driver'],
      },
      // no permissions in body → role-only sync path
    })

    expect(mockMembershipUpsert).toHaveBeenCalledTimes(1)
    const upsert = mockMembershipUpsert.mock.calls[0][0]
    expect(upsert.role).toBe('Driver')
    expect(upsert.is_primary_owner).toBe(false)
    expect(upsert.permissions).toEqual({
      mode: 'custom',
      custom: { equipment: true, profiles: false, account_settings: false },
    })
  })

  it('resets custom permissions when role changes (Admin → Viewer)', async () => {
    mockMembershipMaybeSingle.mockResolvedValue({
      data: {
        role: 'Admin',
        permissions: {
          mode: 'custom',
          custom: { equipment: true, profiles: true, account_settings: true },
        },
        is_primary_owner: false,
      },
      error: null,
    })

    await createOrUpdateRosterMemberForUser('token', {
      id: 'roster-1',
      linkedUserId: 'linked-1',
      form: {
        ...emptyMemberProfileForm(),
        driver_full_name: 'Demoted',
        user_roles: ['Viewer'],
      },
    })

    const upsert = mockMembershipUpsert.mock.calls[0][0]
    expect(upsert.role).toBe('Viewer')
    expect(upsert.permissions).toEqual({ mode: 'global' })
  })

  it('preserves is_primary_owner true on role sync', async () => {
    mockMembershipMaybeSingle.mockResolvedValue({
      data: {
        role: 'Owner',
        permissions: { mode: 'global' },
        is_primary_owner: true,
      },
      error: null,
    })

    // Roster cannot assign Owner; Admin sync must still not clear primary flag.
    await createOrUpdateRosterMemberForUser('token', {
      id: 'roster-1',
      linkedUserId: 'linked-1',
      form: {
        ...emptyMemberProfileForm(),
        driver_full_name: 'Primary Owner',
        user_roles: ['Admin'],
      },
    })

    const upsert = mockMembershipUpsert.mock.calls[0][0]
    expect(upsert.role).toBe('Admin')
    expect(upsert.is_primary_owner).toBe(true)
  })

  it('syncs membership role on member_profile targetUserId path', async () => {
    const mockTargetUpdate = vi.fn(() => {
      const eq2 = {
        select: vi.fn(() => ({
          single: vi.fn(() =>
            Promise.resolve({
              data: {
                user_id: 'driver-1',
                organization_id: 'org-1',
                user_roles: ['Viewer'],
                is_primary_owner: false,
              },
              error: null,
            })
          ),
        })),
      }
      const eq1 = { eq: vi.fn(() => eq2) }
      return { eq: vi.fn(() => eq1) }
    })

    supabaseMocks.mockGetUser.mockResolvedValue({
      data: { user: { id: 'owner-1', email: 'owner@example.com' } },
      error: null,
    })
    supabaseMocks.mockMaybeSingle.mockResolvedValue({
      data: ownerProfile,
      error: null,
    })
    supabaseMocks.mockTargetMaybeSingle.mockResolvedValue({
      data: {
        user_id: 'driver-1',
        organization_id: 'org-1',
        is_primary_owner: false,
        user_roles: ['Driver'],
        company_name: 'Carrier Co',
      },
      error: null,
    })

    mockMembershipMaybeSingle.mockResolvedValue({
      data: {
        role: 'Driver',
        permissions: { mode: 'global' },
        is_primary_owner: false,
      },
      error: null,
    })

    supabaseMocks.mockFrom.mockImplementation((table: string) => {
      if (table === 'member_profiles') {
        return {
          select: vi.fn(() => {
            const filters: Record<string, unknown> = {}
            const chain = {
              eq: vi.fn((col: string, val: unknown) => {
                filters[col] = val
                return chain
              }),
              maybeSingle: vi.fn(async () => {
                if (filters.is_primary_owner === true) {
                  return { data: null, error: null }
                }
                if (
                  typeof filters.user_id === 'string' &&
                  typeof filters.organization_id === 'string'
                ) {
                  return supabaseMocks.mockTargetMaybeSingle()
                }
                return supabaseMocks.mockMaybeSingle()
              }),
            }
            return chain
          }),
          update: mockTargetUpdate,
        }
      }
      if (table === 'organization_memberships') {
        const chain: {
          eq: ReturnType<typeof vi.fn>
          maybeSingle: typeof mockMembershipMaybeSingle
        } = {
          eq: vi.fn(() => chain),
          maybeSingle: mockMembershipMaybeSingle,
        }
        return {
          select: vi.fn(() => chain),
          upsert: mockMembershipUpsert,
        }
      }
      if (table === 'team_member_profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      return {}
    })

    await saveTeamMemberProfileForUser('token', {
      targetUserId: 'driver-1',
      form: {
        ...emptyMemberProfileForm(),
        driver_full_name: 'Team Driver',
        user_roles: ['Viewer'],
      },
    })

    expect(mockMembershipUpsert).toHaveBeenCalled()
    const upsert = mockMembershipUpsert.mock.calls.at(-1)?.[0]
    expect(upsert.role).toBe('Viewer')
    expect(upsert.user_id).toBe('driver-1')
    expect(upsert.is_primary_owner).toBe(false)
  })
})
