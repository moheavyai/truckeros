import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import {
  respondToCarrierLinkRequest,
  validateCreateLinkRequestInput,
} from './carrier-link-requests'

describe('validateCreateLinkRequestInput', () => {
  it('requires USDOT or email', () => {
    expect(() => validateCreateLinkRequestInput({})).toThrow(
      'Provide a USDOT number or company email to request access'
    )
  })

  it('normalizes USDOT and email', () => {
    const result = validateCreateLinkRequestInput({
      target_usdot: ' USDOT-1234567 ',
      target_email: ' Dispatch@Carrier.COM ',
      message: '  Need access  ',
    })

    expect(result).toEqual({
      target_usdot: '1234567',
      target_email: 'dispatch@carrier.com',
      message: 'Need access',
    })
  })

  it('accepts email-only requests', () => {
    const result = validateCreateLinkRequestInput({
      target_email: 'ops@carrier.com',
    })

    expect(result.target_usdot).toBeNull()
    expect(result.target_email).toBe('ops@carrier.com')
  })
})

describe('link-request approve membership role', () => {
  it('hard-codes Viewer (not Permit Clerk) on approve insert payload', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'lib', 'carrier-link-requests.ts'),
      'utf8'
    )
    const ensureStart = source.indexOf('async function ensureMembershipForApprovedRequest')
    expect(ensureStart).toBeGreaterThan(-1)
    const ensureFn = source.slice(ensureStart, ensureStart + 800)
    expect(ensureFn).toContain("role: 'Viewer'")
    expect(ensureFn).toContain('is_primary_owner: false')
    expect(ensureFn).toContain("permissions: { mode: 'global' }")
    expect(ensureFn).not.toContain("role: 'Permit Clerk'")
  })

  it('approve inserts organization_memberships with role Viewer via mock', async () => {
    const membershipInsert = vi.fn().mockResolvedValue({ error: null })
    const linkUpdateSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'req-1',
        from_user_id: 'requester-1',
        to_organization_id: 'org-1',
        status: 'approved',
        responded_by_user_id: 'owner-1',
      },
      error: null,
    })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'carrier_link_requests') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'req-1',
                    from_user_id: 'requester-1',
                    to_organization_id: 'org-1',
                    status: 'pending',
                    target_usdot: null,
                    target_email: null,
                  },
                  error: null,
                }),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: linkUpdateSingle,
                })),
              })),
            })),
          }
        }
        if (table === 'organization_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
            insert: membershipInsert,
          }
        }
        return {}
      }),
    }

    const result = await respondToCarrierLinkRequest(
      supabase as never,
      'req-1',
      'owner-1',
      'approve'
    )

    expect(result.status).toBe('approved')
    expect(membershipInsert).toHaveBeenCalledTimes(1)
    expect(membershipInsert).toHaveBeenCalledWith({
      organization_id: 'org-1',
      user_id: 'requester-1',
      role: 'Viewer',
      is_primary_owner: false,
      permissions: { mode: 'global' },
    })
    expect(membershipInsert.mock.calls[0][0].role).not.toBe('Permit Clerk')
  })

  it('approve skips membership insert when membership already exists', async () => {
    const membershipInsert = vi.fn()
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'carrier_link_requests') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'req-2',
                    from_user_id: 'requester-2',
                    to_organization_id: 'org-2',
                    status: 'pending',
                  },
                  error: null,
                }),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: 'req-2',
                      from_user_id: 'requester-2',
                      to_organization_id: 'org-2',
                      status: 'approved',
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }
        if (table === 'organization_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'mem-existing' },
                    error: null,
                  }),
                })),
              })),
            })),
            insert: membershipInsert,
          }
        }
        return {}
      }),
    }

    await respondToCarrierLinkRequest(supabase as never, 'req-2', 'owner-1', 'approve')
    expect(membershipInsert).not.toHaveBeenCalled()
  })
})