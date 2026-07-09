import { describe, expect, it, vi } from 'vitest'
import {
  canUseServiceMode,
  carrierSummaryLabel,
  fetchCarrierPrimaryOwnerUserId,
  filterAccessibleCarriers,
  filterServiceModeCarriers,
  isServiceModeEligibleCarrier,
  resolveEquipmentScope,
  resolvePermitOrganizationId,
} from './service-mode-scope'
import type { AccessibleCarrier } from '@/types/organization'

const carriers: AccessibleCarrier[] = [
  {
    id: 'org-1',
    name: 'Acme Hauling',
    usdot_number: '123456',
    access_source: 'membership',
    membership_role: 'Permit Clerk',
  },
  {
    id: 'org-2',
    name: 'Beta Transport',
    usdot_number: '987654',
    access_source: 'membership',
    membership_role: 'Viewer',
  },
  {
    id: 'org-3',
    name: 'Own Carrier',
    usdot_number: '111',
    access_source: 'primary_owner',
    membership_role: 'Owner',
  },
  {
    id: 'org-4',
    name: 'Admin Multi Org',
    usdot_number: '222',
    access_source: 'membership',
    membership_role: 'Admin',
  },
]

describe('service-mode-scope', () => {
  it('resolvePermitOrganizationId uses effective org in service mode', () => {
    expect(
      resolvePermitOrganizationId({
        workspaceMode: 'service',
        ownOrganizationId: 'org-own',
        effectiveOrganizationId: 'org-client',
      })
    ).toBe('org-client')

    expect(
      resolvePermitOrganizationId({
        workspaceMode: 'carrier',
        ownOrganizationId: 'org-own',
        effectiveOrganizationId: 'org-client',
      })
    ).toBe('org-own')
  })

  it('resolveEquipmentScope uses carrier primary owner in service mode and never ownUserId for rigs', () => {
    expect(
      resolveEquipmentScope({
        workspaceMode: 'service',
        ownUserId: 'clerk-user',
        ownOrganizationId: 'org-clerk',
        effectiveOrganizationId: 'org-carrier',
        carrierPrimaryOwnerUserId: 'owner-user',
      })
    ).toEqual({
      organizationId: 'org-carrier',
      rigOwnerUserId: 'owner-user',
      canLoadEquipment: true,
      canLoadRigs: true,
    })

    expect(
      resolveEquipmentScope({
        workspaceMode: 'service',
        ownUserId: 'clerk-user',
        ownOrganizationId: 'org-clerk',
        effectiveOrganizationId: 'org-carrier',
        carrierPrimaryOwnerUserId: null,
      })
    ).toEqual({
      organizationId: 'org-carrier',
      rigOwnerUserId: null,
      canLoadEquipment: true,
      canLoadRigs: false,
    })

    expect(
      resolveEquipmentScope({
        workspaceMode: 'service',
        ownUserId: 'clerk-user',
        effectiveOrganizationId: null,
      })
    ).toEqual({
      organizationId: null,
      rigOwnerUserId: null,
      canLoadEquipment: false,
      canLoadRigs: false,
    })

    expect(
      resolveEquipmentScope({
        workspaceMode: 'carrier',
        ownUserId: 'owner-user',
        ownOrganizationId: 'org-carrier',
      })
    ).toEqual({
      organizationId: 'org-carrier',
      rigOwnerUserId: 'owner-user',
      canLoadEquipment: true,
      canLoadRigs: true,
    })
  })

  it('canUseServiceMode allows Permit Clerk only (no Owner/Admin/primary_owner bypass)', () => {
    expect(isServiceModeEligibleCarrier(carriers[0])).toBe(true)
    expect(isServiceModeEligibleCarrier(carriers[1])).toBe(false)
    expect(isServiceModeEligibleCarrier(carriers[2])).toBe(false)
    expect(isServiceModeEligibleCarrier(carriers[3])).toBe(false)
    expect(filterServiceModeCarriers(carriers)).toHaveLength(1)
    expect(canUseServiceMode(carriers)).toBe(true)
    expect(canUseServiceMode([carriers[1]])).toBe(false)
    expect(canUseServiceMode([carriers[2], carriers[3]])).toBe(false)
  })

  it('isServiceModeEligibleCarrier ignores primary_owner and created access_source', () => {
    expect(
      isServiceModeEligibleCarrier({
        id: 'org-x',
        name: 'Created Shell',
        access_source: 'created',
        membership_role: 'Owner',
      })
    ).toBe(false)
    expect(
      isServiceModeEligibleCarrier({
        id: 'org-y',
        name: 'Primary',
        access_source: 'primary_owner',
        membership_role: null,
      })
    ).toBe(false)
    expect(
      isServiceModeEligibleCarrier({
        id: 'org-z',
        name: 'Clerk via membership',
        access_source: 'membership',
        membership_role: 'Permit Clerk',
      })
    ).toBe(true)
  })

  it('fetchCarrierPrimaryOwnerUserId returns userId on success', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { user_id: 'owner-1' }, error: null }),
            }),
          }),
        }),
      }),
    }

    await expect(
      fetchCarrierPrimaryOwnerUserId(supabase as never, 'org-carrier')
    ).resolves.toEqual({ userId: 'owner-1', error: null })
  })

  it('fetchCarrierPrimaryOwnerUserId returns error when query fails', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'RLS denied' } }),
            }),
          }),
        }),
      }),
    }

    await expect(
      fetchCarrierPrimaryOwnerUserId(supabase as never, 'org-carrier')
    ).resolves.toEqual({ userId: null, error: 'RLS denied' })
  })

  it('fetchCarrierPrimaryOwnerUserId returns error when primary owner missing', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }

    await expect(
      fetchCarrierPrimaryOwnerUserId(supabase as never, 'org-carrier')
    ).resolves.toEqual({
      userId: null,
      error: 'No primary owner found for this carrier organization',
    })
  })

  it('filterAccessibleCarriers matches name, USDOT, and role', () => {
    expect(filterAccessibleCarriers(carriers, 'acme')).toHaveLength(1)
    expect(filterAccessibleCarriers(carriers, '987654')).toHaveLength(1)
    expect(filterAccessibleCarriers(carriers, 'permit clerk')).toHaveLength(1)
    expect(filterAccessibleCarriers(carriers, 'zzz')).toHaveLength(0)
    expect(filterAccessibleCarriers(carriers, '')).toHaveLength(4)
  })

  it('carrierSummaryLabel includes name, USDOT, and role', () => {
    expect(carrierSummaryLabel(carriers[0])).toContain('Acme Hauling')
    expect(carrierSummaryLabel(carriers[0])).toContain('USDOT 123456')
    expect(carrierSummaryLabel(carriers[0])).toContain('Permit Clerk')
  })
})