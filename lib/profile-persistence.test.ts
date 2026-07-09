import { describe, expect, it } from 'vitest'
import {
  buildCarrierOnlyApiSavePayload,
  buildCarrierOnlySavePayload,
  memberProfileFromRow,
  prepareMemberProfileSave,
} from './member-profile'
import {
  mergeCarrierFieldsOntoProfile,
  profileFromSaveResponse,
  resolveRefreshedOwnProfile,
  teamMemberProfileFromSaveResponse,
} from './profile-persistence'

describe('profileFromSaveResponse', () => {
  it('extracts member profile rows from API success payloads', () => {
    expect(
      profileFromSaveResponse({
        data: {
          source: 'member_profile',
          data: { user_id: 'user-1', company_name: 'Acme Hauling' },
        },
      })
    ).toMatchObject({ user_id: 'user-1', company_name: 'Acme Hauling' })
  })

  it('returns null when response data is missing or not a member profile', () => {
    expect(profileFromSaveResponse({})).toBeNull()
    expect(
      profileFromSaveResponse({
        data: { source: 'team_member_profile', data: { id: 'roster-1' } },
      })
    ).toBeNull()
  })
})

describe('teamMemberProfileFromSaveResponse', () => {
  it('extracts roster rows from team_member_profile API payloads', () => {
    expect(
      teamMemberProfileFromSaveResponse({
        data: {
          source: 'team_member_profile',
          data: {
            id: 'roster-1',
            organization_id: 'org-1',
            created_by_user_id: 'owner-1',
            driver_full_name: 'Alex',
          },
        },
      })
    ).toMatchObject({
      id: 'roster-1',
      organization_id: 'org-1',
      created_by_user_id: 'owner-1',
    })
  })

  it('returns null for member_profile payloads or malformed roster rows', () => {
    expect(
      teamMemberProfileFromSaveResponse({
        data: {
          source: 'member_profile',
          data: { user_id: 'user-1' },
        },
      })
    ).toBeNull()
    expect(
      teamMemberProfileFromSaveResponse({
        data: {
          source: 'team_member_profile',
          data: { id: 'roster-1' },
        },
      })
    ).toBeNull()
  })
})

describe('resolveRefreshedOwnProfile', () => {
  const savedProfile = { user_id: 'user-1', company_name: 'Saved Carrier' }

  it('prefers API-returned profile when user ids match', () => {
    expect(resolveRefreshedOwnProfile('user-1', savedProfile, null, null)).toEqual(savedProfile)
  })

  it('falls back to refreshed query result when API row is absent', () => {
    const refreshed = { user_id: 'user-1', company_name: 'Refreshed Carrier' }
    expect(resolveRefreshedOwnProfile('user-1', null, refreshed, null)).toEqual(refreshed)
  })

  it('throws when fallback query fails or returns no row', () => {
    expect(() => resolveRefreshedOwnProfile('user-1', null, null, { message: 'db error' })).toThrow(
      'db error'
    )
    expect(() => resolveRefreshedOwnProfile('user-1', null, null, null)).toThrow(
      'Profile not found after save.'
    )
  })

  it('falls back to refreshed query when API row user_id does not match', () => {
    const refreshed = { user_id: 'user-1', company_name: 'Refreshed Carrier' }

    expect(
      resolveRefreshedOwnProfile('user-1', { user_id: 'other-user' }, refreshed, null)
    ).toEqual(refreshed)
  })
})

describe('mergeCarrierFieldsOntoProfile', () => {
  it('overlays carrier columns from the API save response', () => {
    const refreshed = {
      user_id: 'user-1',
      company_name: 'Stale Carrier',
      driver_full_name: 'Alex',
    }
    const saved = {
      user_id: 'user-1',
      company_name: 'Saved Carrier',
      usdot_number: '999999',
    }

    expect(mergeCarrierFieldsOntoProfile(refreshed, saved)).toMatchObject({
      company_name: 'Saved Carrier',
      usdot_number: '999999',
      driver_full_name: 'Alex',
    })
  })

  it('returns the refreshed profile when saved row user ids do not match', () => {
    const refreshed = { user_id: 'user-1', company_name: 'Refreshed Carrier' }
    expect(mergeCarrierFieldsOntoProfile(refreshed, { user_id: 'other-user' })).toEqual(refreshed)
  })
})

describe('carrier save payload with organization_id', () => {
  it('keeps organization_id on API and upsert payloads when company_name changes', () => {
    const existing = {
      user_id: 'owner-1',
      organization_id: 'org-persist',
      is_primary_owner: true,
      company_name: 'Before Rename',
      user_roles: ['Owner / Admin'],
    }
    const form = {
      ...memberProfileFromRow(existing),
      company_name: 'After Rename',
    }
    const carrierForm = buildCarrierOnlySavePayload(form, existing)
    const apiPayload = buildCarrierOnlyApiSavePayload(form, existing)
    const upsertPayload = prepareMemberProfileSave(carrierForm, 'owner-1', existing)

    expect(apiPayload.organization_id).toBe('org-persist')
    expect(apiPayload.company_name).toBe('After Rename')
    expect(upsertPayload.organization_id).toBe('org-persist')
    expect(upsertPayload.company_name).toBe('After Rename')
  })
})