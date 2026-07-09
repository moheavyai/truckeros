import { describe, expect, it } from 'vitest'
import {
  assertNotSelfPermitClerkInvite,
  assertNotSelfPromoteToPermitClerk,
  buildInviteLink,
  buildTeamInviteRecord,
  generateInviteToken,
  inviteExpiresAt,
  shouldRewriteHomeProfileOnInviteAccept,
  validateAcceptTeamInvite,
  validateCreateTeamInviteInput,
} from './team-invites'

describe('generateInviteToken', () => {
  it('returns a long unique token', () => {
    const a = generateInviteToken()
    const b = generateInviteToken()
    expect(a.length).toBeGreaterThan(20)
    expect(a).not.toBe(b)
  })
})

describe('buildInviteLink', () => {
  it('builds an invite URL from base and token', () => {
    expect(buildInviteLink('https://app.example.com', 'abc123')).toBe(
      'https://app.example.com/invite/abc123'
    )
  })
})

describe('validateCreateTeamInviteInput', () => {
  it('requires email or phone', () => {
    expect(() =>
      validateCreateTeamInviteInput({
        organizationId: 'org-1',
        role: 'Driver',
      })
    ).toThrow(/email or phone/i)
  })

  it('accepts email invites for supported roles', () => {
    const result = validateCreateTeamInviteInput({
      organizationId: 'org-1',
      role: 'Permit Clerk',
      inviteEmail: 'clerk@example.com',
    })
    expect(result.invite_email).toBe('clerk@example.com')
    expect(result.role).toBe('Permit Clerk')
  })

  it('rejects Owner role invites', () => {
    expect(() =>
      validateCreateTeamInviteInput({
        organizationId: 'org-1',
        role: 'Owner',
        inviteEmail: 'owner@example.com',
      })
    ).toThrow(/cannot be assigned via invite/i)
  })
})

describe('assertNotSelfPermitClerkInvite', () => {
  it('blocks self email invite as Permit Clerk', () => {
    expect(() =>
      assertNotSelfPermitClerkInvite({
        role: 'Permit Clerk',
        inviteEmail: 'Owner@Example.com',
        inviterEmails: ['owner@example.com'],
      })
    ).toThrow(/yourself as Permit Clerk/i)
  })

  it('allows inviting another email as Permit Clerk', () => {
    expect(() =>
      assertNotSelfPermitClerkInvite({
        role: 'Permit Clerk',
        inviteEmail: 'clerk@example.com',
        inviterEmails: ['owner@example.com'],
      })
    ).not.toThrow()
  })

  it('allows self-invite for non-Clerk roles', () => {
    expect(() =>
      assertNotSelfPermitClerkInvite({
        role: 'Driver',
        inviteEmail: 'owner@example.com',
        inviterEmails: ['owner@example.com'],
      })
    ).not.toThrow()
  })

  it('blocks phone-only self invite as Permit Clerk when phones match', () => {
    expect(() =>
      assertNotSelfPermitClerkInvite({
        role: 'Permit Clerk',
        inviteEmail: null,
        invitePhone: '(555) 111-2222',
        inviterPhones: ['555-111-2222'],
      })
    ).toThrow(/yourself as Permit Clerk/i)
  })

  it('allows phone-only Permit Clerk invite when inviter phone unknown', () => {
    expect(() =>
      assertNotSelfPermitClerkInvite({
        role: 'Permit Clerk',
        inviteEmail: null,
        invitePhone: '(555) 111-2222',
        inviterPhones: [],
      })
    ).not.toThrow()
  })
})

describe('assertNotSelfPromoteToPermitClerk', () => {
  it('blocks self promotion to Permit Clerk when previous role was not Clerk', () => {
    expect(() =>
      assertNotSelfPromoteToPermitClerk({
        actorUserId: 'u1',
        targetUserId: 'u1',
        nextRole: 'Permit Clerk',
        previousRole: 'Owner',
      })
    ).toThrow(/own membership role to Permit Clerk/i)
    expect(() =>
      assertNotSelfPromoteToPermitClerk({
        actorUserId: 'u1',
        targetUserId: 'u1',
        nextRole: 'Permit Clerk',
        previousRole: null,
      })
    ).toThrow(/own membership role to Permit Clerk/i)
  })

  it('allows idempotent stay-as-Clerk self sync', () => {
    expect(() =>
      assertNotSelfPromoteToPermitClerk({
        actorUserId: 'u1',
        targetUserId: 'u1',
        nextRole: 'Permit Clerk',
        previousRole: 'Permit Clerk',
      })
    ).not.toThrow()
  })

  it('allows assigning Permit Clerk to another user', () => {
    expect(() =>
      assertNotSelfPromoteToPermitClerk({
        actorUserId: 'owner-1',
        targetUserId: 'clerk-1',
        nextRole: 'Permit Clerk',
        previousRole: 'Driver',
      })
    ).not.toThrow()
  })
})

describe('buildTeamInviteRecord', () => {
  it('creates a pending invite with link and expiry', () => {
    const record = buildTeamInviteRecord({
      organizationId: 'org-1',
      invitedByUserId: 'user-1',
      role: 'Driver',
      inviteEmail: 'driver@example.com',
      appBaseUrl: 'https://app.example.com',
      token: 'fixed-token',
    })

    expect(record.status).toBe('pending')
    expect(record.invite_token).toBe('fixed-token')
    expect(record.invite_link).toContain('/invite/fixed-token')
    expect(Date.parse(record.expires_at)).toBeGreaterThan(Date.now())
  })
})

describe('validateAcceptTeamInvite', () => {
  const baseInvite = buildTeamInviteRecord({
    organizationId: 'org-1',
    invitedByUserId: 'owner-1',
    role: 'Driver',
    inviteEmail: 'driver@example.com',
    token: 'tok',
  })

  it('rejects expired invites', () => {
    const result = validateAcceptTeamInvite(
      {
        ...baseInvite,
        id: 'invite-1',
        expires_at: inviteExpiresAt(new Date('2020-01-01')),
      },
      { token: 'tok', acceptorUserId: 'user-2', acceptorEmail: 'driver@example.com' }
    )
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.code).toBe('expired')
  })

  it('accepts valid pending invite for matching email', () => {
    const result = validateAcceptTeamInvite(
      { ...baseInvite, id: 'invite-1' },
      { token: 'tok', acceptorUserId: 'user-2', acceptorEmail: 'driver@example.com' }
    )
    expect(result.ok).toBe(true)
  })

  it('rejects email mismatch', () => {
    const result = validateAcceptTeamInvite(
      { ...baseInvite, id: 'invite-1' },
      { token: 'tok', acceptorUserId: 'user-2', acceptorEmail: 'other@example.com' }
    )
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.code).toBe('email_mismatch')
  })

  it('rejects missing acceptor email when invite is email-bound', () => {
    const result = validateAcceptTeamInvite(
      { ...baseInvite, id: 'invite-1' },
      { token: 'tok', acceptorUserId: 'user-2', acceptorEmail: null }
    )
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.code).toBe('email_mismatch')
  })
})

describe('shouldRewriteHomeProfileOnInviteAccept', () => {
  it('preserves a different home organization (membership-only join)', () => {
    expect(
      shouldRewriteHomeProfileOnInviteAccept({
        existingOrganizationId: 'org-home',
        inviteOrganizationId: 'org-invite',
      })
    ).toBe(false)
  })

  it('allows rewrite for first-time joiners', () => {
    expect(
      shouldRewriteHomeProfileOnInviteAccept({
        existingOrganizationId: null,
        inviteOrganizationId: 'org-invite',
      })
    ).toBe(true)
  })

  it('does not demote primary owner of the invite organization', () => {
    expect(
      shouldRewriteHomeProfileOnInviteAccept({
        existingOrganizationId: 'org-1',
        existingIsPrimaryOwner: true,
        inviteOrganizationId: 'org-1',
      })
    ).toBe(false)
  })
})

describe('isMultiOrgInviteJoin', () => {
  it('requires a different existing home org (not rewrite negation)', async () => {
    const { isMultiOrgInviteJoin } = await import('./team-invites')
    expect(
      isMultiOrgInviteJoin({
        existingOrganizationId: 'org-1',
        inviteOrganizationId: 'org-1',
      })
    ).toBe(false)
    expect(
      isMultiOrgInviteJoin({
        existingOrganizationId: null,
        inviteOrganizationId: 'org-1',
      })
    ).toBe(false)
    expect(
      isMultiOrgInviteJoin({
        existingOrganizationId: 'org-a',
        inviteOrganizationId: 'org-b',
      })
    ).toBe(true)
  })
})