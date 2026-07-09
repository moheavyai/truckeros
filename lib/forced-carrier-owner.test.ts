import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  hasAdminAccess: false,
  supabaseAdmin: null,
}))

import {
  FORCED_CARRIER_OWNER_EMAIL,
  isForcedCarrierOwner,
  parseForcedCarrierOwnerEmails,
} from '@/lib/forced-carrier-owner'
import {
  buildCarrierOnlyApiSavePayload,
  canSaveCarrierInfo,
  emptyMemberProfileForm,
  prepareMemberProfileSave,
  validateBootstrapCarrierSaveRoles,
} from '@/lib/member-profile'
import { canActorSaveCarrierOnlyScope } from '@/lib/team-member-profiles-api'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('parseForcedCarrierOwnerEmails', () => {
  it('parses comma-separated env values case-insensitively', () => {
    expect(parseForcedCarrierOwnerEmails('A@Ex.com, b@ex.com ,')).toEqual([
      'a@ex.com',
      'b@ex.com',
    ])
  })

  it('falls back to legacy email when env empty outside production', () => {
    vi.stubEnv('NODE_ENV', 'test')
    expect(parseForcedCarrierOwnerEmails('')).toEqual([
      FORCED_CARRIER_OWNER_EMAIL.toLowerCase(),
    ])
    expect(parseForcedCarrierOwnerEmails('   ')).toEqual([
      FORCED_CARRIER_OWNER_EMAIL.toLowerCase(),
    ])
  })

  it('returns empty allowlist in production when env empty (no legacy hardcode)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_FORCED_CARRIER_OWNER_EMAILS', '')
    vi.stubEnv('FORCED_CARRIER_OWNER_EMAILS', '')
    expect(parseForcedCarrierOwnerEmails()).toEqual([])
    expect(parseForcedCarrierOwnerEmails('')).toEqual([])
  })

  it('prefers NEXT_PUBLIC_FORCED_CARRIER_OWNER_EMAILS over server-only', () => {
    vi.stubEnv('NEXT_PUBLIC_FORCED_CARRIER_OWNER_EMAILS', 'public@example.com')
    vi.stubEnv('FORCED_CARRIER_OWNER_EMAILS', 'server@example.com')
    expect(parseForcedCarrierOwnerEmails()).toEqual(['public@example.com'])
  })

  it('reads FORCED_CARRIER_OWNER_EMAILS when NEXT_PUBLIC_ empty', () => {
    vi.stubEnv('NEXT_PUBLIC_FORCED_CARRIER_OWNER_EMAILS', '')
    vi.stubEnv('FORCED_CARRIER_OWNER_EMAILS', 'ops@example.com,other@example.com')
    expect(parseForcedCarrierOwnerEmails()).toEqual([
      'ops@example.com',
      'other@example.com',
    ])
  })
})

describe('isForcedCarrierOwner', () => {
  it('matches the configured owner email case-insensitively (legacy fallback in test)', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('NEXT_PUBLIC_FORCED_CARRIER_OWNER_EMAILS', '')
    vi.stubEnv('FORCED_CARRIER_OWNER_EMAILS', '')
    expect(isForcedCarrierOwner(FORCED_CARRIER_OWNER_EMAIL)).toBe(true)
    expect(isForcedCarrierOwner(' AndreHampton1@Outlook.COM ')).toBe(true)
    expect(isForcedCarrierOwner('other@example.com')).toBe(false)
    expect(isForcedCarrierOwner(undefined)).toBe(false)
  })

  it('disables legacy forced owner in production when env empty', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_FORCED_CARRIER_OWNER_EMAILS', '')
    vi.stubEnv('FORCED_CARRIER_OWNER_EMAILS', '')
    expect(isForcedCarrierOwner(FORCED_CARRIER_OWNER_EMAIL)).toBe(false)
  })

  it('honors NEXT_PUBLIC allowlist on client-equivalent path', () => {
    vi.stubEnv('NEXT_PUBLIC_FORCED_CARRIER_OWNER_EMAILS', 'breakglass@example.com')
    expect(isForcedCarrierOwner('breakglass@example.com')).toBe(true)
    expect(isForcedCarrierOwner(FORCED_CARRIER_OWNER_EMAIL)).toBe(false)
  })

  it('honors server-only FORCED_CARRIER_OWNER_EMAILS when public unset', () => {
    vi.stubEnv('NEXT_PUBLIC_FORCED_CARRIER_OWNER_EMAILS', '')
    vi.stubEnv('FORCED_CARRIER_OWNER_EMAILS', 'server-only@example.com')
    expect(isForcedCarrierOwner('server-only@example.com')).toBe(true)
    expect(isForcedCarrierOwner(FORCED_CARRIER_OWNER_EMAIL)).toBe(false)
  })
})

describe('forced carrier owner save bypass', () => {
  const forcedEmail = FORCED_CARRIER_OWNER_EMAIL
  const driverProfile = {
    user_id: 'andre-1',
    organization_id: 'org-1',
    is_primary_owner: false,
    user_roles: ['Driver'],
    company_name: 'Old Name LLC',
  }

  it('always allows carrier save for the forced owner email', () => {
    expect(canSaveCarrierInfo(driverProfile, emptyMemberProfileForm(), forcedEmail)).toBe(true)
    expect(canActorSaveCarrierOnlyScope(driverProfile, emptyMemberProfileForm(), forcedEmail)).toBe(
      true
    )
    expect(
      validateBootstrapCarrierSaveRoles(emptyMemberProfileForm(), driverProfile, forcedEmail).ok
    ).toBe(true)
  })

  it('promotes forced owner to primary owner on carrier upsert payload', () => {
    const form = {
      ...emptyMemberProfileForm(),
      company_name: 'Andre Hauling LLC',
      user_roles: ['Driver'],
    }

    const payload = prepareMemberProfileSave(form, driverProfile.user_id!, driverProfile, forcedEmail)
    expect(payload.is_primary_owner).toBe(true)
    expect(payload.organization_id).toBe('org-1')
    expect(payload.company_name).toBe('Andre Hauling LLC')
    expect(payload.user_roles).toEqual(['Owner', 'Driver'])
  })

  it('bootstraps organization for forced owner without org', () => {
    const partialProfile = {
      user_id: 'andre-1',
      is_primary_owner: false,
      user_roles: ['Driver'],
      company_name: 'Partial Carrier',
    }
    const form = {
      ...emptyMemberProfileForm(),
      company_name: 'New Org Carrier',
      user_roles: ['Driver'],
    }

    const payload = prepareMemberProfileSave(form, partialProfile.user_id!, partialProfile, forcedEmail)
    expect(payload.is_primary_owner).toBe(true)
    expect(payload.organization_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )

    const apiPayload = buildCarrierOnlyApiSavePayload(form, partialProfile, forcedEmail)
    expect(apiPayload.company_name).toBe('New Org Carrier')
    expect(apiPayload.user_roles).toEqual(['Owner', 'Driver'])
    expect(apiPayload.organization_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })
})
