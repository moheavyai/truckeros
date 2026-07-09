import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canReinviteMember,
  resolveInviteRoleFromMemberRoles,
  resolveMemberInviteContact,
} from './team-invite-helpers'
import type { MemberProfile, TeamMemberListItem, TeamMemberProfile } from '@/types/member-profile'

describe('resolveInviteRoleFromMemberRoles', () => {
  it('skips Owner and picks first allowed role', () => {
    expect(resolveInviteRoleFromMemberRoles(['Owner', 'Driver'])).toBe('Driver')
    expect(resolveInviteRoleFromMemberRoles(['Admin'])).toBe('Admin')
    expect(resolveInviteRoleFromMemberRoles([])).toBe('Driver')
  })
})

describe('resolveMemberInviteContact', () => {
  const rosterMember: TeamMemberListItem = {
    id: 'roster-1',
    source: 'team_member_profile',
    display_name: 'Roster Driver',
    user_roles: ['Driver'],
    driver_summary: '—',
    is_self: false,
  }

  const rosterRows: TeamMemberProfile[] = [
    {
      id: 'roster-1',
      organization_id: 'org-1',
      driver_full_name: 'Roster Driver',
      driver_email: 'roster@example.com',
      driver_phone: '555-111-2222',
      user_roles: ['Driver'],
    } as TeamMemberProfile,
  ]

  it('reads contact from roster rows', () => {
    expect(resolveMemberInviteContact(rosterMember, [], rosterRows)).toEqual({
      email: 'roster@example.com',
      phone: '555-111-2222',
    })
  })
})

describe('canReinviteMember', () => {
  const actor = {
    user_roles: ['Owner'],
    is_primary_owner: true,
  } as MemberProfile

  it('allows re-invite when contact exists and member is not owner/self', () => {
    const member: TeamMemberListItem = {
      id: 'm-1',
      source: 'team_member_profile',
      display_name: 'Driver',
      user_roles: ['Driver'],
      driver_summary: '—',
      is_self: false,
      is_primary_owner: false,
    }

    expect(
      canReinviteMember(actor, member, { email: 'driver@example.com', phone: null })
    ).toBe(true)
  })

  it('blocks primary owner and self', () => {
    const ownerMember: TeamMemberListItem = {
      id: 'owner-1',
      source: 'member_profile',
      display_name: 'Owner',
      user_roles: ['Owner'],
      driver_summary: '—',
      is_self: false,
      is_primary_owner: true,
    }

    expect(
      canReinviteMember(actor, ownerMember, { email: 'owner@example.com', phone: null })
    ).toBe(false)

    const selfMember: TeamMemberListItem = {
      id: 'self-1',
      source: 'member_profile',
      display_name: 'Me',
      user_roles: ['Admin'],
      driver_summary: '—',
      is_self: true,
      is_primary_owner: false,
    }

    expect(
      canReinviteMember(actor, selfMember, { email: 'me@example.com', phone: null })
    ).toBe(false)
  })
})

describe('createTeamInviteViaApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns error when response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ success: false, error: 'Forbidden' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createTeamInviteViaApi } = await import('./team-invite-helpers')
    const result = await createTeamInviteViaApi('token-1', {
      role: 'Driver',
      invite_email: 'driver@example.com',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Forbidden')
  })
})