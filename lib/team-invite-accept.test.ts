import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isMultiOrgInviteJoin,
  shouldRewriteHomeProfileOnInviteAccept,
} from './team-invites'

const adminMocks = vi.hoisted(() => {
  const state = {
    hasAdminAccess: true,
    supabaseAdmin: null as null | { from: ReturnType<typeof vi.fn> },
  }
  return { state }
})

vi.mock('@/lib/supabase', () => ({
  get hasAdminAccess() {
    return adminMocks.state.hasAdminAccess
  },
  get supabaseAdmin() {
    return adminMocks.state.supabaseAdmin
  },
}))

describe('shouldRewriteHomeProfileOnInviteAccept', () => {
  it('rewrites when user has no home organization', () => {
    expect(
      shouldRewriteHomeProfileOnInviteAccept({
        existingOrganizationId: null,
        inviteOrganizationId: 'org-invite',
      })
    ).toBe(true)
  })

  it('rewrites when same org and not primary owner (role re-invite)', () => {
    expect(
      shouldRewriteHomeProfileOnInviteAccept({
        existingOrganizationId: 'org-1',
        existingIsPrimaryOwner: false,
        inviteOrganizationId: 'org-1',
      })
    ).toBe(true)
  })

  it('does not rewrite when already primary owner of the invite org', () => {
    expect(
      shouldRewriteHomeProfileOnInviteAccept({
        existingOrganizationId: 'org-1',
        existingIsPrimaryOwner: true,
        inviteOrganizationId: 'org-1',
      })
    ).toBe(false)
  })

  it('does not rewrite a different home org (membership-only multi-org join)', () => {
    expect(
      shouldRewriteHomeProfileOnInviteAccept({
        existingOrganizationId: 'org-home',
        existingIsPrimaryOwner: true,
        inviteOrganizationId: 'org-invite',
      })
    ).toBe(false)
  })
})

describe('isMultiOrgInviteJoin', () => {
  it('is true only when home org differs from invite org', () => {
    expect(
      isMultiOrgInviteJoin({
        existingOrganizationId: 'org-home',
        inviteOrganizationId: 'org-invite',
      })
    ).toBe(true)
  })

  it('is false for first-time joiners (no home org)', () => {
    expect(
      isMultiOrgInviteJoin({
        existingOrganizationId: null,
        inviteOrganizationId: 'org-invite',
      })
    ).toBe(false)
  })

  it('is false for same-org path (including primary-owner skip)', () => {
    expect(
      isMultiOrgInviteJoin({
        existingOrganizationId: 'org-1',
        inviteOrganizationId: 'org-1',
      })
    ).toBe(false)
  })
})

function claimChain(claimed: unknown) {
  return {
    eq: () => ({
      eq: () => ({
        gt: () => ({
          select: () => ({
            maybeSingle: async () => ({ data: claimed, error: null }),
          }),
        }),
      }),
    }),
  }
}

describe('acceptInviteViaAdmin', () => {
  beforeEach(() => {
    vi.resetModules()
    adminMocks.state.hasAdminAccess = true
  })

  it('claims pending invite, preserves primary membership, skips home rewrite for multi-org', async () => {
    const inviteRow = {
      id: 'invite-1',
      organization_id: 'org-invite',
      invited_by_user_id: 'owner-1',
      role: 'Driver',
      invite_email: 'driver@example.com',
      invite_token: 'tok',
      status: 'pending',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }

    const claimed = { ...inviteRow, status: 'accepted', accepted_by_user_id: 'user-1' }
    const membershipUpserts: unknown[] = []
    const profileUpdates: unknown[] = []
    const rosterLinkUpdates: unknown[] = []

    const from = vi.fn((table: string) => {
      if (table === 'team_invites') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: inviteRow, error: null }),
            }),
          }),
          update: (payload: unknown) => {
            if ((payload as { status?: string }).status === 'accepted') {
              return claimChain({ ...claimed, ...payload })
            }
            return {
              eq: () => ({
                eq: () => ({
                  eq: async () => ({ error: null }),
                }),
              }),
            }
          },
        }
      }
      if (table === 'organization_memberships') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    is_primary_owner: true,
                    role: 'Owner',
                    permissions: { mode: 'custom', custom: { equipment: true } },
                  },
                  error: null,
                }),
              }),
            }),
          }),
          upsert: async (payload: unknown) => {
            membershipUpserts.push(payload)
            return { error: null }
          },
        }
      }
      if (table === 'member_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  user_id: 'user-1',
                  organization_id: 'org-home',
                  is_primary_owner: true,
                  user_roles: ['Owner'],
                },
                error: null,
              }),
            }),
          }),
          update: (payload: unknown) => {
            profileUpdates.push(payload)
            return { eq: async () => ({ error: null }) }
          },
          insert: async () => ({ error: null }),
        }
      }
      if (table === 'team_member_profiles') {
        return {
          select: () => ({
            eq: () => ({
              is: async () => ({
                data: [
                  { id: 'roster-1', driver_email: 'Driver@Example.com' },
                  { id: 'roster-2', driver_email: 'other@example.com' },
                ],
                error: null,
              }),
            }),
          }),
          update: (payload: unknown) => {
            rosterLinkUpdates.push(payload)
            return {
              in: async () => ({ error: null }),
            }
          },
        }
      }
      return {}
    })

    adminMocks.state.supabaseAdmin = { from }

    const { acceptInviteViaAdmin } = await import('./team-invite-accept')
    const outcome = await acceptInviteViaAdmin({
      userId: 'user-1',
      acceptorEmail: 'driver@example.com',
      token: 'tok',
    })

    expect(outcome.multiOrgJoin).toBe(true)
    expect(outcome.invite.status).toBe('accepted')
    expect(membershipUpserts[0]).toMatchObject({
      is_primary_owner: true,
      role: 'Owner',
      permissions: { mode: 'custom', custom: { equipment: true } },
    })
    expect(profileUpdates).toHaveLength(0)
    expect(rosterLinkUpdates).toHaveLength(1)
  })

  it('inserts home profile for first-time invitee (rewrite path)', async () => {
    const inviteRow = {
      id: 'invite-2',
      organization_id: 'org-new',
      invited_by_user_id: 'owner-1',
      role: 'Driver',
      invite_email: 'new@example.com',
      invite_token: 'tok2',
      status: 'pending',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }
    const claimed = { ...inviteRow, status: 'accepted', accepted_by_user_id: 'user-new' }
    const inserts: unknown[] = []

    const from = vi.fn((table: string) => {
      if (table === 'team_invites') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: inviteRow, error: null }),
            }),
          }),
          update: () => claimChain(claimed),
        }
      }
      if (table === 'organization_memberships') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          upsert: async () => ({ error: null }),
        }
      }
      if (table === 'member_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert: async (payload: unknown) => {
            inserts.push(payload)
            return { error: null }
          },
        }
      }
      if (table === 'team_member_profiles') {
        return {
          select: () => ({
            eq: () => ({
              is: async () => ({ data: [], error: null }),
            }),
          }),
        }
      }
      return {}
    })

    adminMocks.state.supabaseAdmin = { from }
    const { acceptInviteViaAdmin } = await import('./team-invite-accept')
    const outcome = await acceptInviteViaAdmin({
      userId: 'user-new',
      acceptorEmail: 'new@example.com',
      token: 'tok2',
    })

    expect(outcome.multiOrgJoin).toBe(false)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      organization_id: 'org-new',
      is_primary_owner: false,
    })
  })

  it('accepts Permit Clerk invite as child under parent org (never primary owner bootstrap)', async () => {
    const inviteRow = {
      id: 'invite-clerk',
      organization_id: 'org-parent',
      invited_by_user_id: 'owner-1',
      role: 'Permit Clerk',
      invite_email: 'clerk@example.com',
      invite_token: 'tok-clerk',
      status: 'pending',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }
    const claimed = { ...inviteRow, status: 'accepted', accepted_by_user_id: 'user-clerk' }
    const membershipUpserts: unknown[] = []
    const profileInserts: unknown[] = []

    const from = vi.fn((table: string) => {
      if (table === 'team_invites') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: inviteRow, error: null }),
            }),
          }),
          update: () => claimChain(claimed),
        }
      }
      if (table === 'organization_memberships') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          upsert: async (payload: unknown) => {
            membershipUpserts.push(payload)
            return { error: null }
          },
        }
      }
      if (table === 'member_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert: async (payload: unknown) => {
            profileInserts.push(payload)
            return { error: null }
          },
        }
      }
      if (table === 'team_member_profiles') {
        return {
          select: () => ({
            eq: () => ({
              is: async () => ({ data: [], error: null }),
            }),
          }),
        }
      }
      if (table === 'organizations') {
        throw new Error('must not create organizations on team invite accept')
      }
      return {}
    })

    adminMocks.state.supabaseAdmin = { from }
    const { acceptInviteViaAdmin } = await import('./team-invite-accept')
    await acceptInviteViaAdmin({
      userId: 'user-clerk',
      acceptorEmail: 'clerk@example.com',
      token: 'tok-clerk',
    })

    expect(membershipUpserts[0]).toMatchObject({
      organization_id: 'org-parent',
      role: 'Permit Clerk',
      is_primary_owner: false,
    })
    expect(profileInserts[0]).toMatchObject({
      organization_id: 'org-parent',
      is_primary_owner: false,
      user_roles: ['Permit Clerk'],
    })
  })

  it('does not restore claim when membership succeeded but profile fails', async () => {
    const inviteRow = {
      id: 'invite-partial',
      organization_id: 'org-1',
      invited_by_user_id: 'owner-1',
      role: 'Driver',
      invite_email: 'partial@example.com',
      invite_token: 'tok-partial',
      status: 'pending',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }
    const claimed = { ...inviteRow, status: 'accepted', accepted_by_user_id: 'user-partial' }
    const restores: unknown[] = []

    const from = vi.fn((table: string) => {
      if (table === 'team_invites') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: inviteRow, error: null }),
            }),
          }),
          update: (payload: unknown) => {
            if ((payload as { status?: string }).status === 'pending') {
              restores.push(payload)
              return {
                eq: () => ({
                  eq: () => ({
                    eq: async () => ({ error: null }),
                  }),
                }),
              }
            }
            return claimChain(claimed)
          },
        }
      }
      if (table === 'organization_memberships') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          upsert: async () => ({ error: null }),
        }
      }
      if (table === 'member_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert: async () => ({ error: { message: 'profile insert failed' } }),
        }
      }
      return {}
    })

    adminMocks.state.supabaseAdmin = { from }
    const { acceptInviteViaAdmin } = await import('./team-invite-accept')
    await expect(
      acceptInviteViaAdmin({
        userId: 'user-partial',
        acceptorEmail: 'partial@example.com',
        token: 'tok-partial',
      })
    ).rejects.toThrow(/profile insert failed/i)
    expect(restores).toHaveLength(0)
  })

  it('restores pending claim when membership grant fails after claim', async () => {
    const inviteRow = {
      id: 'invite-fail',
      organization_id: 'org-1',
      invited_by_user_id: 'owner-1',
      role: 'Driver',
      invite_email: 'fail@example.com',
      invite_token: 'tok-fail',
      status: 'pending',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }
    const claimed = { ...inviteRow, status: 'accepted', accepted_by_user_id: 'user-fail' }
    const restores: unknown[] = []

    const from = vi.fn((table: string) => {
      if (table === 'team_invites') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: inviteRow, error: null }),
            }),
          }),
          update: (payload: unknown) => {
            if ((payload as { status?: string }).status === 'pending') {
              restores.push(payload)
              return {
                eq: () => ({
                  eq: () => ({
                    eq: async () => ({ error: null }),
                  }),
                }),
              }
            }
            return claimChain(claimed)
          },
        }
      }
      if (table === 'organization_memberships') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          upsert: async () => ({ error: { message: 'membership failed' } }),
        }
      }
      return {}
    })

    adminMocks.state.supabaseAdmin = { from }
    const { acceptInviteViaAdmin } = await import('./team-invite-accept')
    await expect(
      acceptInviteViaAdmin({
        userId: 'user-fail',
        acceptorEmail: 'fail@example.com',
        token: 'tok-fail',
      })
    ).rejects.toThrow(/membership failed/i)
    expect(restores).toHaveLength(1)
    expect(restores[0]).toMatchObject({ status: 'pending' })
  })

  it('rejects Owner invite roles via validateInviteRole', async () => {
    const inviteRow = {
      id: 'invite-owner',
      organization_id: 'org-1',
      invited_by_user_id: 'owner-1',
      role: 'Owner',
      invite_email: 'x@example.com',
      invite_token: 'tok',
      status: 'pending',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }

    const from = vi.fn((table: string) => {
      if (table === 'team_invites') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: inviteRow, error: null }),
            }),
          }),
        }
      }
      return {}
    })
    adminMocks.state.supabaseAdmin = { from }

    const { acceptInviteViaAdmin } = await import('./team-invite-accept')
    await expect(
      acceptInviteViaAdmin({
        userId: 'user-1',
        acceptorEmail: 'x@example.com',
        token: 'tok',
      })
    ).rejects.toThrow(/cannot be assigned via invite/i)
  })

  it('rejects missing acceptor email when invite is email-bound', async () => {
    const inviteRow = {
      id: 'invite-1',
      organization_id: 'org-1',
      invited_by_user_id: 'owner-1',
      role: 'Driver',
      invite_email: 'driver@example.com',
      invite_token: 'tok',
      status: 'pending',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }

    const from = vi.fn((table: string) => {
      if (table === 'team_invites') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: inviteRow, error: null }),
            }),
          }),
        }
      }
      return {}
    })
    adminMocks.state.supabaseAdmin = { from }

    const { acceptInviteViaAdmin } = await import('./team-invite-accept')
    await expect(
      acceptInviteViaAdmin({
        userId: 'user-1',
        acceptorEmail: null,
        token: 'tok',
      })
    ).rejects.toThrow(/email address that received/i)
  })
})
