import { describe, expect, it } from 'vitest'
import {
  buildTeamMemberList,
  canDeleteMember,
  canEditMember,
  canWriteTeamData,
  formatMemberListSummary,
  isPrimaryOwner,
  isViewerOnly,
  memberDisplayName,
  shouldShowTeamSection,
} from './member-profile-permissions'
import type { MemberProfile, TeamMemberProfile } from '@/types/member-profile'

const ownerProfile: MemberProfile = {
  id: 'owner-row',
  user_id: 'owner-user',
  organization_id: 'org-1',
  is_primary_owner: true,
  driver_full_name: 'Alex Owner',
  company_name: 'Acme Hauling',
  user_roles: ['Owner'],
}

const driverProfile: MemberProfile = {
  id: 'driver-row',
  user_id: 'driver-user',
  organization_id: 'org-1',
  is_primary_owner: false,
  driver_full_name: 'Dana Driver',
  company_name: 'Acme Hauling',
  user_roles: ['Driver'],
}

const rosterProfile: TeamMemberProfile = {
  id: 'roster-1',
  organization_id: 'org-1',
  created_by_user_id: 'owner-user',
  driver_full_name: 'Riley Roster',
  cdl_number: 'R123',
  cdl_state: 'TX',
  user_roles: ['Driver'],
}

describe('isPrimaryOwner', () => {
  it('returns true only when is_primary_owner is set', () => {
    expect(isPrimaryOwner(ownerProfile)).toBe(true)
    expect(isPrimaryOwner(driverProfile)).toBe(false)
    expect(isPrimaryOwner(null)).toBe(false)
  })
})

describe('canEditMember', () => {
  it('allows everyone to edit their own profile', () => {
    expect(canEditMember(driverProfile, { user_id: 'driver-user', is_self: true })).toBe(true)
  })

  it('allows primary owner to edit other profiles', () => {
    expect(canEditMember(ownerProfile, { user_id: 'driver-user', is_self: false })).toBe(true)
  })

  it('denies non-primary users from editing others', () => {
    expect(canEditMember(driverProfile, { user_id: 'owner-user', is_self: false })).toBe(false)
  })
})

describe('canDeleteMember', () => {
  it('allows primary owner to delete others but not self', () => {
    expect(canDeleteMember(ownerProfile, { user_id: 'driver-user', is_self: false })).toBe(true)
    expect(canDeleteMember(ownerProfile, { user_id: 'owner-user', is_self: true })).toBe(false)
  })

  it('denies delete for non-primary users', () => {
    expect(canDeleteMember(driverProfile, { user_id: 'owner-user', is_self: false })).toBe(false)
  })
})

describe('formatMemberListSummary', () => {
  it('summarizes CDL and contact fields without repeating the name column', () => {
    expect(
      formatMemberListSummary({
        cdl_number: 'D123',
        cdl_state: 'CA',
        driver_phone: '555-0100',
        driver_email: 'jane@example.com',
      })
    ).toBe('CDL D123 (CA) · 555-0100 · jane@example.com')
  })

  it('falls back when driver details are missing', () => {
    expect(formatMemberListSummary({})).toBe('No driver details')
  })
})

describe('memberDisplayName', () => {
  it('prefers driver name, then email, then company', () => {
    expect(memberDisplayName({ driver_full_name: 'Pat', driver_email: 'pat@x.com', company_name: 'Co' })).toBe('Pat')
    expect(memberDisplayName({ driver_email: 'pat@x.com', company_name: 'Co' })).toBe('pat@x.com')
    expect(memberDisplayName({ company_name: 'Co' })).toBe('Co')
    expect(memberDisplayName({})).toBe('Unnamed member')
  })
})

describe('buildTeamMemberList', () => {
  it('returns only the current user for non-primary members', () => {
    const list = buildTeamMemberList(driverProfile, [ownerProfile, driverProfile], [rosterProfile], 'driver-user')
    expect(list).toHaveLength(1)
    expect(list[0].display_name).toBe('Dana Driver')
    expect(list[0].is_self).toBe(true)
  })

  it('returns org members and roster entries for the primary owner', () => {
    const list = buildTeamMemberList(ownerProfile, [ownerProfile, driverProfile], [rosterProfile], 'owner-user')
    expect(list.map((item) => item.display_name)).toEqual([
      'Alex Owner',
      'Dana Driver',
      'Riley Roster',
    ])
    expect(list[0].is_self).toBe(true)
    expect(list[2].source).toBe('team_member_profile')
  })

  it('deduplicates roster rows linked to existing member profiles', () => {
    const linkedRoster: TeamMemberProfile = {
      ...rosterProfile,
      id: 'roster-linked',
      linked_user_id: 'driver-user',
      driver_full_name: 'Should Hide',
    }

    const list = buildTeamMemberList(
      ownerProfile,
      [ownerProfile, driverProfile],
      [linkedRoster, rosterProfile],
      'owner-user'
    )

    expect(list.some((item) => item.display_name === 'Should Hide')).toBe(false)
    expect(list.some((item) => item.display_name === 'Riley Roster')).toBe(true)
  })
})

describe('viewer permissions', () => {
  it('treats Viewer-only accounts as read-only', () => {
    expect(isViewerOnly(['Viewer'])).toBe(true)
    expect(isViewerOnly(['Viewer', 'Driver'])).toBe(false)
    expect(canWriteTeamData({ user_roles: ['Viewer'], is_primary_owner: false })).toBe(false)
    expect(canWriteTeamData({ user_roles: ['Driver'], is_primary_owner: false })).toBe(true)
  })

  it('allows first-visit bootstrap writes when profile row is missing', () => {
    expect(canWriteTeamData(null)).toBe(true)
    expect(canWriteTeamData(undefined)).toBe(true)
  })
})

describe('shouldShowTeamSection', () => {
  it('shows after first save or when team members exist', () => {
    expect(shouldShowTeamSection(null, [])).toBe(false)
    expect(shouldShowTeamSection(ownerProfile, [])).toBe(true)
    expect(shouldShowTeamSection(null, [{ id: 'x', source: 'member_profile', display_name: 'A', user_roles: [], driver_summary: '', is_self: true }])).toBe(true)
  })
})