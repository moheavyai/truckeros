import { beforeEach, describe, expect, it, vi } from 'vitest'

const fromMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  hasAdminAccess: true,
  supabaseAdmin: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

vi.mock('@/lib/invite-notifications', () => ({
  sendInviteNotifications: vi.fn(() => ({
    email: {
      channel: 'email',
      to: 'owner@example.com',
      role: 'Carrier Owner',
      invite_link: 'https://app.example.com/carrier-invite/tok',
      sent: false,
      stubbed: true,
      body: 'body',
    },
    sms: null,
  })),
}))

import {
  acceptCarrierConnectionInviteViaAdmin,
  assertAcceptDefenseInDepth,
  cleanupShellOrgIfOrphaned,
  createCarrierConnectionInvite,
} from './carrier-connection-invite-service'
import { sendInviteNotifications } from './invite-notifications'

function basePendingInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    invited_by_user_id: 'clerk-1',
    organization_id: 'org-1',
    company_name: 'ABC Trucking',
    invite_email: 'owner@example.com',
    invite_token: 'tok',
    status: 'pending',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    ...overrides,
  }
}

describe('createCarrierConnectionInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthorized roles', async () => {
    await expect(
      createCarrierConnectionInvite({
        actor: {
          user_id: 'd1',
          user_roles: ['Driver'],
          is_primary_owner: false,
        },
        invitedByUserId: 'd1',
        appBaseUrl: 'https://app.example.com',
        input: {
          company_name: 'ABC',
          invite_email: 'owner@example.com',
        },
      })
    ).rejects.toThrow(/forbidden/i)
  })

  it('creates org, Permit Clerk non-primary membership, invite, then revokes nothing when no priors', async () => {
    const inviteRow = basePendingInvite({
      invite_token: 'tok',
      invite_link: 'https://app.example.com/carrier-invite/tok',
      organization_id: 'org-generated',
    })

    const membershipInsert = vi.fn().mockResolvedValue({ error: null })
    const orgInsert = vi.fn().mockResolvedValue({ error: null })
    const inviteInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: inviteRow, error: null }),
      }),
    })

    fromMock.mockImplementation((table: string) => {
      if (table === 'organizations') {
        return {
          insert: orgInsert,
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }
      }
      if (table === 'organization_memberships') {
        return {
          insert: membershipInsert,
          upsert: vi.fn().mockResolvedValue({ error: null }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'carrier_connection_invites') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
                neq: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
          insert: inviteInsert,
        }
      }
      return {}
    })

    const result = await createCarrierConnectionInvite({
      actor: {
        user_id: 'clerk-1',
        user_roles: ['Permit Clerk'],
        is_primary_owner: false,
      },
      membershipRoles: ['Permit Clerk'],
      invitedByUserId: 'clerk-1',
      appBaseUrl: 'https://app.example.com',
      input: {
        company_name: 'ABC Trucking',
        invite_email: 'owner@example.com',
        invite_contact_name: 'Jane Doe',
        message: 'Please accept',
      },
    })

    expect(result.invite.company_name).toBe('ABC Trucking')
    expect(result.invite).not.toHaveProperty('invite_token')
    expect(result.email?.stubbed).toBe(true)
    expect(sendInviteNotifications).toHaveBeenCalled()
    expect(orgInsert).toHaveBeenCalled()
    expect(membershipInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'Permit Clerk',
        is_primary_owner: false,
      })
    )
    // Insert happens; revoke of empty priors is a no-op (no update.in without candidates).
    expect(inviteInsert).toHaveBeenCalled()
  })

  it('reuses shell org and revokes other pending invites on that org after insert', async () => {
    const shellOrgId = 'shell-org'
    const newInvite = basePendingInvite({
      id: 'inv-new',
      organization_id: shellOrgId,
      invite_email: 'newowner@example.com',
    })

    const priorOnShell = {
      id: 'inv-old',
      organization_id: shellOrgId,
      invite_email: 'oldowner@example.com',
    }

    const orgUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    const revokeUpdate = vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })
    const orgInsert = vi.fn()

    fromMock.mockImplementation((table: string) => {
      if (table === 'organizations') {
        return {
          insert: orgInsert,
          update: orgUpdate,
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: shellOrgId, created_by_user_id: 'clerk-1' },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'organization_memberships') {
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  // no primary owner
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'carrier_connection_invites') {
        return {
          select: vi.fn().mockImplementation(() => {
            const chain: Record<string, unknown> = {}
            const self = () => chain
            chain.eq = vi.fn(self)
            chain.order = vi.fn(self)
            chain.limit = vi.fn(self)
            chain.neq = vi.fn().mockResolvedValue({ data: [priorOnShell], error: null })
            chain.maybeSingle = vi.fn().mockResolvedValue({
              data: {
                id: 'inv-email-pending',
                organization_id: shellOrgId,
                invite_email: 'newowner@example.com',
              },
              error: null,
            })
            return chain
          }),
          update: revokeUpdate,
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: newInvite, error: null }),
            }),
          }),
        }
      }
      return {}
    })

    const result = await createCarrierConnectionInvite({
      actor: {
        user_id: 'clerk-1',
        user_roles: ['Permit Clerk'],
        is_primary_owner: false,
      },
      membershipRoles: ['Permit Clerk'],
      invitedByUserId: 'clerk-1',
      appBaseUrl: 'https://app.example.com',
      input: {
        company_name: 'ABC Trucking',
        invite_email: 'newowner@example.com',
      },
    })

    expect(result.invite.organization_id).toBe(shellOrgId)
    expect(orgInsert).not.toHaveBeenCalled()
    expect(revokeUpdate).toHaveBeenCalledWith({ status: 'revoked' })
  })

  it('does not cleanup reused shell when insert fails', async () => {
    const shellOrgId = 'shell-org'
    const orgDelete = vi.fn()

    fromMock.mockImplementation((table: string) => {
      if (table === 'organizations') {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
          delete: orgDelete,
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }
      }
      if (table === 'organization_memberships') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'carrier_connection_invites') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: 'prior',
                          organization_id: shellOrgId,
                          invite_email: 'owner@example.com',
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'insert failed' },
              }),
            }),
          }),
        }
      }
      return {}
    })

    await expect(
      createCarrierConnectionInvite({
        actor: {
          user_id: 'clerk-1',
          user_roles: ['Permit Clerk'],
          is_primary_owner: false,
        },
        membershipRoles: ['Permit Clerk'],
        invitedByUserId: 'clerk-1',
        appBaseUrl: 'https://app.example.com',
        input: {
          company_name: 'ABC Trucking',
          invite_email: 'owner@example.com',
        },
      })
    ).rejects.toThrow(/insert failed/i)

    expect(orgDelete).not.toHaveBeenCalled()
  })

  it('rejects when USDOT already exists with primary owner', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'organizations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'existing-org', created_by_user_id: 'other' },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'organization_memberships') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'primary-mem' },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'carrier_connection_invites') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      return {}
    })

    await expect(
      createCarrierConnectionInvite({
        actor: {
          user_id: 'clerk-1',
          user_roles: ['Permit Clerk'],
          is_primary_owner: false,
        },
        membershipRoles: ['Permit Clerk'],
        invitedByUserId: 'clerk-1',
        appBaseUrl: 'https://app.example.com',
        input: {
          company_name: 'ABC Trucking',
          usdot_number: '1234567',
          invite_email: 'owner@example.com',
        },
      })
    ).rejects.toThrow(/usdot already exists/i)
  })

  it('rejects Owner home roles without Permit Clerk membership', async () => {
    await expect(
      createCarrierConnectionInvite({
        actor: {
          user_id: 'owner-1',
          user_roles: ['Owner'],
          is_primary_owner: true,
        },
        membershipRoles: ['Owner'],
        invitedByUserId: 'owner-1',
        appBaseUrl: 'https://app.example.com',
        input: {
          company_name: 'ABC',
          invite_email: 'owner@example.com',
        },
      })
    ).rejects.toThrow(/only Permit Clerk/i)
  })
})

describe('cleanupShellOrgIfOrphaned', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes inviter membership and shell org when no primary and no pending invites', async () => {
    const membershipDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })
    const orgDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    fromMock.mockImplementation((table: string) => {
      if (table === 'organization_memberships') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }),
          delete: membershipDelete,
        }
      }
      if (table === 'carrier_connection_invites') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockResolvedValue({ count: 0, error: null }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      if (table === 'organizations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'shell', created_by_user_id: 'clerk-1' },
                error: null,
              }),
            }),
          }),
          delete: orgDelete,
        }
      }
      return {}
    })

    await cleanupShellOrgIfOrphaned({
      organizationId: 'shell',
      invitedByUserId: 'clerk-1',
      excludeInviteId: 'inv-1',
    })

    expect(membershipDelete).toHaveBeenCalled()
    expect(orgDelete).toHaveBeenCalled()
  })
})

describe('assertAcceptDefenseInDepth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when inviter membership missing', async () => {
    fromMock.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            neq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    }))

    await expect(
      assertAcceptDefenseInDepth({
        invite: basePendingInvite() as never,
        acceptorUserId: 'owner-1',
      })
    ).rejects.toThrow(/not found or no longer valid/i)
  })

  it('rejects when another primary owner exists', async () => {
    let call = 0
    fromMock.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: 'Permit Clerk', is_primary_owner: false },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { user_id: 'other-owner' },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }
    })

    await expect(
      assertAcceptDefenseInDepth({
        invite: basePendingInvite() as never,
        acceptorUserId: 'owner-1',
      })
    ).rejects.toThrow(/already has a primary owner/i)
  })

  it('rejects when inviter membership is Owner (not Permit Clerk)', async () => {
    fromMock.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'Owner', is_primary_owner: true },
              error: null,
            }),
          }),
        }),
      }),
    }))

    await expect(
      assertAcceptDefenseInDepth({
        invite: basePendingInvite() as never,
        acceptorUserId: 'owner-1',
      })
    ).rejects.toThrow(/not found or no longer valid/i)
  })
})

describe('acceptCarrierConnectionInviteViaAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('claim-first then grants primary Owner membership', async () => {
    const pendingInvite = basePendingInvite()
    const claimedInvite = {
      ...pendingInvite,
      status: 'accepted',
      accepted_by_user_id: 'owner-1',
    }

    const membershipUpsert = vi.fn().mockResolvedValue({ error: null })

    fromMock.mockImplementation((table: string) => {
      if (table === 'carrier_connection_invites') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: pendingInvite, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gt: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: claimedInvite,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'organization_memberships') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: 'Permit Clerk', is_primary_owner: false },
                  error: null,
                }),
                neq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
          upsert: membershipUpsert,
        }
      }
      if (table === 'member_profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      return {}
    })

    const outcome = await acceptCarrierConnectionInviteViaAdmin({
      token: 'tok',
      acceptorUserId: 'owner-1',
      acceptorEmail: 'owner@example.com',
    })

    expect(outcome.organizationId).toBe('org-1')
    expect(outcome.multiOrgJoin).toBe(false)
    expect(membershipUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'Owner',
        is_primary_owner: true,
        user_id: 'owner-1',
      }),
      expect.anything()
    )
  })

  it('reports multiOrgJoin when acceptor already has a different home org', async () => {
    const pendingInvite = basePendingInvite()
    const claimedInvite = { ...pendingInvite, status: 'accepted' }

    fromMock.mockImplementation((table: string) => {
      if (table === 'carrier_connection_invites') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: pendingInvite, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gt: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: claimedInvite,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'organization_memberships') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: 'Permit Clerk', is_primary_owner: false },
                  error: null,
                }),
                neq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      if (table === 'member_profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  user_id: 'owner-1',
                  organization_id: 'home-org-other',
                  is_primary_owner: true,
                  user_roles: ['Owner'],
                },
                error: null,
              }),
            }),
          }),
        }
      }
      return {}
    })

    const outcome = await acceptCarrierConnectionInviteViaAdmin({
      token: 'tok',
      acceptorUserId: 'owner-1',
      acceptorEmail: 'owner@example.com',
    })

    expect(outcome.multiOrgJoin).toBe(true)
  })

  it('restores claim when membership grant fails after claim', async () => {
    const pendingInvite = basePendingInvite()
    const claimedInvite = { ...pendingInvite, status: 'accepted' }
    const restoreUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    })

    let inviteUpdateCalls = 0
    fromMock.mockImplementation((table: string) => {
      if (table === 'carrier_connection_invites') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: pendingInvite, error: null }),
            }),
          }),
          update: vi.fn((payload: { status?: string }) => {
            inviteUpdateCalls += 1
            if (payload.status === 'accepted') {
              return {
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    gt: vi.fn().mockReturnValue({
                      select: vi.fn().mockReturnValue({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: claimedInvite,
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }
            }
            // restore path
            return restoreUpdate(payload)
          }),
        }
      }
      if (table === 'organization_memberships') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: 'Permit Clerk', is_primary_owner: false },
                  error: null,
                }),
                neq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
          upsert: vi.fn().mockResolvedValue({ error: { message: 'membership failed' } }),
        }
      }
      return {}
    })

    await expect(
      acceptCarrierConnectionInviteViaAdmin({
        token: 'tok',
        acceptorUserId: 'owner-1',
        acceptorEmail: 'owner@example.com',
      })
    ).rejects.toThrow(/membership failed/i)

    expect(inviteUpdateCalls).toBeGreaterThanOrEqual(2)
    expect(restoreUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        accepted_by_user_id: null,
        accepted_at: null,
      })
    )
  })

  it('rejects email mismatch before claim', async () => {
    fromMock.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: basePendingInvite(),
            error: null,
          }),
        }),
      }),
    }))

    await expect(
      acceptCarrierConnectionInviteViaAdmin({
        token: 'tok',
        acceptorUserId: 'owner-1',
        acceptorEmail: 'other@example.com',
      })
    ).rejects.toThrow(/email address that received/i)
  })

  it('does not restore claim when membership committed but profile insert fails', async () => {
    const pendingInvite = basePendingInvite()
    const claimedInvite = { ...pendingInvite, status: 'accepted' }
    const restorePayloads: unknown[] = []

    fromMock.mockImplementation((table: string) => {
      if (table === 'carrier_connection_invites') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: pendingInvite, error: null }),
            }),
          }),
          update: vi.fn((payload: { status?: string }) => {
            if (payload.status === 'pending') {
              restorePayloads.push(payload)
            }
            return {
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ error: null }),
                  gt: vi.fn().mockReturnValue({
                    select: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: claimedInvite,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }
          }),
        }
      }
      if (table === 'organization_memberships') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: 'Permit Clerk', is_primary_owner: false },
                  error: null,
                }),
                neq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      if (table === 'member_profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          insert: vi.fn().mockResolvedValue({ error: { message: 'profile insert failed' } }),
        }
      }
      return {}
    })

    await expect(
      acceptCarrierConnectionInviteViaAdmin({
        token: 'tok',
        acceptorUserId: 'owner-1',
        acceptorEmail: 'owner@example.com',
      })
    ).rejects.toThrow(/profile insert failed/i)

    // Membership already committed — claim must stay accepted (no restore).
    expect(restorePayloads).toHaveLength(0)
  })
})
