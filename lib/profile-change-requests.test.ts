import { describe, expect, it, vi } from 'vitest'
import { emptyMemberProfileForm } from './member-profile'
import {
  assertAllowedProfileChangeFieldKey,
  assertCanSubmitProfileChangeRequests,
  buildRestrictedChangeRequestPayload,
  buildRestrictedChangeRows,
  listPendingProfileChangeRequestsForOrg,
  parseRestrictedChangeRequestBody,
  pendingProfileChangeFieldKeys,
  profileChangeFieldLabel,
  replacePendingProfileChangeRequests,
  reviewProfileChangeRequest,
  submitProfileChangeRequests,
  withdrawPendingProfileChangeRequest,
} from './profile-change-requests'
import type { MemberProfile } from '@/types/member-profile'

const driverProfile: MemberProfile = {
  user_id: 'driver-1',
  organization_id: 'org-1',
  is_primary_owner: false,
  user_roles: ['Driver'],
}

function createMockSupabase(handlers: {
  delete?: ReturnType<typeof vi.fn>
  insert?: ReturnType<typeof vi.fn>
  update?: ReturnType<typeof vi.fn>
  selectResult?: { data: unknown; error: { message: string } | null }
  maybeSingleResult?: { data: unknown; error: { message: string } | null }
  singleResult?: { data: unknown; error: { message: string } | null }
  orderResult?: { data: unknown; error: { message: string } | null }
  deleteError?: { message: string } | null
  insertError?: { message: string } | null
  updateError?: { message: string } | null
} = {}) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    eq: vi.fn(),
    in: vi.fn(),
    select: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  }

  chain.eq.mockImplementation(() => chain)
  chain.in.mockImplementation(() => chain)
  chain.select.mockImplementation(() => {
    if (handlers.selectResult) return handlers.selectResult
    return chain
  })
  chain.order.mockImplementation(() => handlers.orderResult ?? { data: [], error: null })
  chain.maybeSingle.mockImplementation(
    () => handlers.maybeSingleResult ?? { data: null, error: null }
  )
  chain.single.mockImplementation(() => handlers.singleResult ?? { data: null, error: null })

  if (handlers.delete) {
    chain.delete.mockImplementation(handlers.delete)
  } else {
    chain.delete.mockImplementation(() => {
      if (handlers.deleteError) return { error: handlers.deleteError }
      return chain
    })
  }

  if (handlers.insert) {
    chain.insert.mockImplementation(handlers.insert)
  } else {
    chain.insert.mockImplementation(() => ({
      select: vi.fn(() =>
        handlers.insertError
          ? { data: null, error: handlers.insertError }
          : (handlers.selectResult ?? { data: [], error: null })
      ),
    }))
  }

  if (handlers.update) {
    chain.update.mockImplementation(handlers.update)
  } else {
    chain.update.mockImplementation(() => {
      if (handlers.updateError) return { error: handlers.updateError }
      const updateChain = {
        eq: vi.fn(() => updateChain),
        select: vi.fn(() => ({
          single: vi.fn(() => handlers.singleResult ?? { data: null, error: null }),
        })),
        then(resolve: (value: unknown) => void) {
          resolve({ error: null })
        },
      }
      return updateChain
    })
  }

  return {
    from: vi.fn(() => chain),
    chain,
  }
}

describe('assertCanSubmitProfileChangeRequests', () => {
  it('rejects non-driver actors', () => {
    const owner: MemberProfile = {
      user_id: 'owner-1',
      organization_id: 'org-1',
      is_primary_owner: true,
      user_roles: ['Owner / Admin'],
    }

    expect(() => assertCanSubmitProfileChangeRequests(owner, owner.user_id)).toThrow(
      'Forbidden – only driver accounts use profile change requests'
    )
  })

  it('rejects cross-user submissions', () => {
    expect(() => assertCanSubmitProfileChangeRequests(driverProfile, 'other-user')).toThrow(
      'Forbidden – can only submit change requests for your own profile'
    )
  })

  it('rejects drivers without organization_id', () => {
    expect(() =>
      assertCanSubmitProfileChangeRequests(
        { ...driverProfile, organization_id: null },
        driverProfile.user_id
      )
    ).toThrow('Organization not configured for this account')
  })
})

describe('buildRestrictedChangeRows', () => {
  it('maps restricted changes to pending rows', () => {
    const rows = buildRestrictedChangeRows(driverProfile, [
      {
        fieldKey: 'driver_full_name',
        currentValue: 'Jane',
        requestedValue: 'Janet',
      },
    ])

    expect(rows).toEqual([
      {
        organization_id: 'org-1',
        requester_user_id: 'driver-1',
        target_user_id: 'driver-1',
        field_key: 'driver_full_name',
        current_value: 'Jane',
        requested_value: 'Janet',
        status: 'pending',
      },
    ])
  })

  it('rejects invalid field keys', () => {
    expect(() =>
      buildRestrictedChangeRows(driverProfile, [
        {
          fieldKey: 'driver_phone' as 'driver_full_name',
          currentValue: null,
          requestedValue: '555',
        },
      ])
    ).toThrow('Forbidden – invalid profile change field')
  })
})

describe('pendingProfileChangeFieldKeys', () => {
  it('returns only pending field keys', () => {
    const keys = pendingProfileChangeFieldKeys([
      {
        field_key: 'cdl_number',
        status: 'pending',
      },
      {
        field_key: 'driver_full_name',
        status: 'approved',
      },
    ])

    expect(keys).toEqual(new Set(['cdl_number']))
  })
})

describe('profileChangeFieldLabel', () => {
  it('maps known field keys to labels', () => {
    expect(profileChangeFieldLabel('driver_full_name')).toBe('Full Name')
    expect(() => assertAllowedProfileChangeFieldKey('invalid_field')).toThrow(
      'Forbidden – invalid profile change field'
    )
  })
})

describe('replacePendingProfileChangeRequests', () => {
  it('deletes existing pending rows before insert', async () => {
    const deleteMock = vi.fn(function (this: { eq: ReturnType<typeof vi.fn> }) {
      return this
    })
    const insertMock = vi.fn(() => ({
      select: vi.fn(() => ({
        data: [{ id: 'req-1', field_key: 'cdl_number', status: 'pending' }],
        error: null,
      })),
    }))

    const supabase = createMockSupabase({
      delete: deleteMock,
      insert: insertMock,
    })

    const rows = buildRestrictedChangeRows(driverProfile, [
      {
        fieldKey: 'cdl_number',
        currentValue: 'A1',
        requestedValue: 'B2',
      },
    ])

    const created = await replacePendingProfileChangeRequests(supabase as never, driverProfile, rows)

    expect(supabase.from).toHaveBeenCalledWith('profile_change_requests')
    expect(deleteMock).toHaveBeenCalled()
    expect(insertMock).toHaveBeenCalledWith(rows)
    expect(created).toHaveLength(1)
  })
})

describe('restricted change request payload helpers', () => {
  it('builds delta-only client payloads', () => {
    expect(
      buildRestrictedChangeRequestPayload([
        {
          fieldKey: 'driver_full_name',
          currentValue: 'Jane',
          requestedValue: 'Janet',
        },
        {
          fieldKey: 'cdl_number',
          currentValue: 'A1',
          requestedValue: null,
        },
      ])
    ).toEqual({
      driver_full_name: 'Janet',
      cdl_number: '',
    })
  })

  it('parses only restricted keys from POST bodies', () => {
    const parsed = parseRestrictedChangeRequestBody({
      driver_full_name: 'Janet',
      driver_phone: '555-0100',
      baseline_profile: { driver_full_name: 'Ignored' },
    })

    expect(parsed.driver_full_name).toBe('Janet')
    expect(parsed.driver_phone).toBe('')
    expect(parsed.cdl_number).toBe('')
  })
})

describe('listPendingProfileChangeRequestsForOrg', () => {
  it('rejects non-primary owners', async () => {
    const supabase = createMockSupabase()
    await expect(
      listPendingProfileChangeRequestsForOrg(supabase as never, driverProfile)
    ).rejects.toThrow('Forbidden – only primary owners can list org change requests')
  })

  it('queries pending requests for the owner organization', async () => {
    const owner: MemberProfile = {
      user_id: 'owner-1',
      organization_id: 'org-1',
      is_primary_owner: true,
      user_roles: ['Owner / Admin'],
    }
    const supabase = createMockSupabase({
      orderResult: {
        data: [{ id: 'req-1', field_key: 'cdl_number', status: 'pending' }],
        error: null,
      },
    })

    const rows = await listPendingProfileChangeRequestsForOrg(supabase as never, owner)

    expect(rows).toHaveLength(1)
    expect(supabase.chain.eq).toHaveBeenCalledWith('organization_id', 'org-1')
    expect(supabase.chain.eq).toHaveBeenCalledWith('status', 'pending')
  })
})

describe('reviewProfileChangeRequest', () => {
  it('approves by applying the requested field to member_profiles', async () => {
    const owner: MemberProfile = {
      user_id: 'owner-1',
      organization_id: 'org-1',
      is_primary_owner: true,
      user_roles: ['Owner / Admin'],
    }
    const supabase = createMockSupabase({
      maybeSingleResult: {
        data: {
          id: 'req-1',
          field_key: 'driver_full_name',
          requested_value: 'Janet Doe',
          target_user_id: 'driver-1',
          organization_id: 'org-1',
          status: 'pending',
        },
        error: null,
      },
      singleResult: {
        data: { id: 'req-1', status: 'approved' },
        error: null,
      },
    })

    const updated = await reviewProfileChangeRequest(supabase as never, owner, 'req-1', 'approve')

    expect(updated.status).toBe('approved')
    expect(supabase.chain.update).toHaveBeenCalled()
  })

  it('rejects without updating member_profiles', async () => {
    const owner: MemberProfile = {
      user_id: 'owner-1',
      organization_id: 'org-1',
      is_primary_owner: true,
      user_roles: ['Owner / Admin'],
    }
    const supabase = createMockSupabase({
      maybeSingleResult: {
        data: {
          id: 'req-1',
          field_key: 'driver_full_name',
          requested_value: 'Janet Doe',
          target_user_id: 'driver-1',
          organization_id: 'org-1',
          status: 'pending',
        },
        error: null,
      },
      singleResult: {
        data: { id: 'req-1', status: 'rejected' },
        error: null,
      },
    })

    const updated = await reviewProfileChangeRequest(supabase as never, owner, 'req-1', 'reject')

    expect(updated.status).toBe('rejected')
    expect(supabase.from).toHaveBeenCalledWith('profile_change_requests')
  })

  it('throws when pending request is not found', async () => {
    const owner: MemberProfile = {
      user_id: 'owner-1',
      organization_id: 'org-1',
      is_primary_owner: true,
      user_roles: ['Owner / Admin'],
    }
    const supabase = createMockSupabase({
      maybeSingleResult: { data: null, error: null },
    })

    await expect(
      reviewProfileChangeRequest(supabase as never, owner, 'missing', 'approve')
    ).rejects.toThrow('Change request not found')
  })
})

describe('withdrawPendingProfileChangeRequest', () => {
  it('deletes a pending request owned by the driver', async () => {
    const supabase = createMockSupabase({
      maybeSingleResult: {
        data: { id: 'req-1', status: 'pending', target_user_id: 'driver-1' },
        error: null,
      },
    })

    await withdrawPendingProfileChangeRequest(supabase as never, driverProfile, 'req-1')

    expect(supabase.chain.delete).toHaveBeenCalled()
    expect(supabase.chain.eq).toHaveBeenCalledWith('status', 'pending')
  })
})

describe('submitProfileChangeRequests', () => {
  it('uses server baseline and no-ops when there are no changes', async () => {
    const supabase = createMockSupabase({})
    const form = {
      ...emptyMemberProfileForm(),
      driver_full_name: 'Jane Doe',
    }
    const actor = {
      ...driverProfile,
      driver_full_name: 'Jane Doe',
    }

    const created = await submitProfileChangeRequests(supabase as never, actor, form)

    expect(created).toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('inserts pending rows when restricted values change', async () => {
    const deleteMock = vi.fn(function (this: { eq: ReturnType<typeof vi.fn> }) {
      return this
    })
    const insertMock = vi.fn(() => ({
      select: vi.fn(() => ({
        data: [{ id: 'req-1', field_key: 'driver_full_name', status: 'pending' }],
        error: null,
      })),
    }))
    const supabase = createMockSupabase({
      delete: deleteMock,
      insert: insertMock,
    })
    const actor = {
      ...driverProfile,
      driver_full_name: 'Jane Doe',
    }
    const form = {
      ...emptyMemberProfileForm(),
      driver_full_name: 'Janet Doe',
    }

    const created = await submitProfileChangeRequests(supabase as never, actor, form)

    expect(created).toHaveLength(1)
    expect(insertMock).toHaveBeenCalled()
  })

  it('propagates Supabase insert errors', async () => {
    const supabase = createMockSupabase({
      insertError: { message: 'insert failed' },
    })
    const actor = {
      ...driverProfile,
      driver_full_name: 'Jane Doe',
    }
    const form = {
      ...emptyMemberProfileForm(),
      driver_full_name: 'Janet Doe',
    }

    await expect(submitProfileChangeRequests(supabase as never, actor, form)).rejects.toThrow(
      'insert failed'
    )
  })
})