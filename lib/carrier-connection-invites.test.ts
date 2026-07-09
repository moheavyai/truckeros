import { describe, expect, it } from 'vitest'
import {
  buildCarrierConnectionInviteLink,
  buildCarrierConnectionInviteRecord,
  canCreateCarrierConnectionInvite,
  filterActivePendingCarrierConnectionInvites,
  formatCarrierConnectionEmailBody,
  formatCarrierConnectionEmailSubject,
  formatCarrierConnectionSmsBody,
  isUsdotConflictError,
  redactCarrierConnectionInviteForClient,
  validateAcceptCarrierConnectionInvite,
  validateCreateCarrierConnectionInviteInput,
} from './carrier-connection-invites'

describe('canCreateCarrierConnectionInvite', () => {
  it('denies primary owner without Permit Clerk membership', () => {
    expect(
      canCreateCarrierConnectionInvite({ is_primary_owner: true, user_roles: [] })
    ).toBe(false)
    expect(
      canCreateCarrierConnectionInvite({ is_primary_owner: true, user_roles: ['Owner'] })
    ).toBe(false)
  })

  it('denies Owner and Admin roles without Permit Clerk membership', () => {
    expect(
      canCreateCarrierConnectionInvite({ is_primary_owner: false, user_roles: ['Owner'] })
    ).toBe(false)
    expect(
      canCreateCarrierConnectionInvite({ is_primary_owner: false, user_roles: ['Admin'] })
    ).toBe(false)
  })

  it('denies home user_roles Permit Clerk without membership role', () => {
    expect(
      canCreateCarrierConnectionInvite({
        is_primary_owner: false,
        user_roles: ['Permit Clerk'],
      })
    ).toBe(false)
    expect(
      canCreateCarrierConnectionInvite(
        { is_primary_owner: false, user_roles: ['Permit Clerk'] },
        []
      )
    ).toBe(false)
  })

  it('allows membership-only Permit Clerk without home roles', () => {
    expect(
      canCreateCarrierConnectionInvite(
        { is_primary_owner: false, user_roles: [] },
        ['Permit Clerk']
      )
    ).toBe(true)
  })

  it('denies Viewer and Driver memberships', () => {
    expect(
      canCreateCarrierConnectionInvite({ is_primary_owner: false, user_roles: ['Viewer'] }, [
        'Viewer',
      ])
    ).toBe(false)
    expect(
      canCreateCarrierConnectionInvite({ is_primary_owner: false, user_roles: ['Driver'] }, [
        'Driver',
      ])
    ).toBe(false)
    expect(canCreateCarrierConnectionInvite(null)).toBe(false)
  })
})

describe('validateCreateCarrierConnectionInviteInput', () => {
  it('requires company name', () => {
    expect(() =>
      validateCreateCarrierConnectionInviteInput({
        invite_email: 'owner@example.com',
      })
    ).toThrow(/company name is required/i)
  })

  it('requires invite email (phone-only rejected)', () => {
    expect(() =>
      validateCreateCarrierConnectionInviteInput({
        company_name: 'ABC Trucking',
        invite_phone: '(555) 111-2222',
      })
    ).toThrow(/invite email is required/i)
  })

  it('normalizes fields', () => {
    const result = validateCreateCarrierConnectionInviteInput({
      company_name: '  ABC Trucking  ',
      usdot_number: 'USDOT-1234567',
      invite_email: ' Owner@Carrier.COM ',
      invite_phone: ' (555) 111-2222 ',
      invite_contact_name: ' Jane Doe ',
      message: '  Hello  ',
    })

    expect(result.company_name).toBe('ABC Trucking')
    expect(result.usdot_number).toBe('1234567')
    expect(result.invite_email).toBe('owner@carrier.com')
    expect(result.invite_phone).toBe('(555) 111-2222')
    expect(result.invite_contact_name).toBe('Jane Doe')
    expect(result.carrier_email).toBe('owner@carrier.com')
    expect(result.message).toBe('Hello')
  })
})

describe('buildCarrierConnectionInviteRecord', () => {
  it('builds tokenized invite with link', () => {
    const validated = validateCreateCarrierConnectionInviteInput({
      company_name: 'ABC Trucking',
      invite_email: 'owner@example.com',
    })

    const record = buildCarrierConnectionInviteRecord({
      invitedByUserId: 'clerk-1',
      organizationId: 'org-1',
      validated,
      appBaseUrl: 'https://app.example.com',
      token: 'tok123',
    })

    expect(record.invite_token).toBe('tok123')
    expect(record.invite_link).toBe('https://app.example.com/carrier-invite/tok123')
    expect(record.status).toBe('pending')
    expect(record.organization_id).toBe('org-1')
    expect(record.company_name).toBe('ABC Trucking')
  })
})

describe('buildCarrierConnectionInviteLink', () => {
  it('encodes token path', () => {
    expect(buildCarrierConnectionInviteLink('https://app.example.com/', 'a/b')).toBe(
      'https://app.example.com/carrier-invite/a%2Fb'
    )
  })
})

describe('validateAcceptCarrierConnectionInvite', () => {
  const baseInvite = {
    id: 'inv-1',
    invited_by_user_id: 'clerk-1',
    company_name: 'ABC',
    invite_token: 'tok',
    status: 'pending' as const,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    invite_email: 'owner@example.com',
  }

  it('accepts matching email', () => {
    const result = validateAcceptCarrierConnectionInvite(baseInvite, {
      token: 'tok',
      acceptorUserId: 'u1',
      acceptorEmail: 'Owner@Example.com',
    })
    expect(result.ok).toBe(true)
  })

  it('rejects email mismatch', () => {
    const result = validateAcceptCarrierConnectionInvite(baseInvite, {
      token: 'tok',
      acceptorUserId: 'u1',
      acceptorEmail: 'other@example.com',
    })
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.code).toBe('email_mismatch')
    }
  })

  it('rejects missing invite email', () => {
    const result = validateAcceptCarrierConnectionInvite(
      { ...baseInvite, invite_email: null },
      {
        token: 'tok',
        acceptorUserId: 'u1',
        acceptorEmail: 'owner@example.com',
      }
    )
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.code).toBe('invalid')
    }
  })

  it('rejects expired invites', () => {
    const result = validateAcceptCarrierConnectionInvite(
      {
        ...baseInvite,
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
      {
        token: 'tok',
        acceptorUserId: 'u1',
        acceptorEmail: 'owner@example.com',
      }
    )
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.code).toBe('expired')
    }
  })

  it('rejects already accepted', () => {
    const result = validateAcceptCarrierConnectionInvite(
      { ...baseInvite, status: 'accepted' },
      {
        token: 'tok',
        acceptorUserId: 'u1',
        acceptorEmail: 'owner@example.com',
      }
    )
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.code).toBe('accepted')
    }
  })
})

describe('filterActivePendingCarrierConnectionInvites', () => {
  it('keeps only unexpired pending', () => {
    const rows = [
      {
        status: 'pending' as const,
        expires_at: new Date(Date.now() + 10000).toISOString(),
      },
      {
        status: 'pending' as const,
        expires_at: new Date(Date.now() - 10000).toISOString(),
      },
      {
        status: 'accepted' as const,
        expires_at: new Date(Date.now() + 10000).toISOString(),
      },
    ]
    expect(filterActivePendingCarrierConnectionInvites(rows)).toHaveLength(1)
  })
})

describe('redactCarrierConnectionInviteForClient', () => {
  it('strips invite_token', () => {
    const redacted = redactCarrierConnectionInviteForClient({
      id: 'inv-1',
      invited_by_user_id: 'clerk-1',
      company_name: 'ABC',
      invite_email: 'o@example.com',
      invite_token: 'secret-token',
      status: 'pending',
      expires_at: new Date().toISOString(),
    })
    expect(redacted).not.toHaveProperty('invite_token')
    expect(redacted.company_name).toBe('ABC')
  })
})

describe('carrier connection notification copy', () => {
  it('includes company name, link, and optional message', () => {
    expect(formatCarrierConnectionEmailSubject('ABC LLC')).toContain('ABC LLC')
    const body = formatCarrierConnectionEmailBody(
      'https://app.example.com/carrier-invite/x',
      'ABC LLC',
      'Jane',
      'Please accept soon'
    )
    expect(body).toContain('https://app.example.com/carrier-invite/x')
    expect(body).toContain('Please accept soon')
    expect(formatCarrierConnectionSmsBody('https://x', 'ABC LLC', 'Hi')).toContain('ABC LLC')
  })
})

describe('isUsdotConflictError', () => {
  it('detects unique index conflicts', () => {
    expect(isUsdotConflictError('duplicate key value violates unique constraint "idx_organizations_usdot_number_unique"')).toBe(true)
    expect(isUsdotConflictError('something else')).toBe(false)
  })
})
