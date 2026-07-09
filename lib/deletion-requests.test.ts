import { describe, expect, it } from 'vitest'
import { deletionResourceLabel } from '@/lib/deletion-requests'
import { mapMemberSourceToResourceType } from '@/lib/team-permissions'

describe('deletion-requests helpers', () => {
  it('maps member list sources to resource types', () => {
    expect(mapMemberSourceToResourceType('member_profile')).toBe('team_member')
    expect(mapMemberSourceToResourceType('team_member_profile')).toBe('roster_member')
  })

  it('labels resource types for UI', () => {
    expect(deletionResourceLabel('team_member')).toBe('Team member')
    expect(deletionResourceLabel('roster_member')).toBe('Roster member')
  })
})