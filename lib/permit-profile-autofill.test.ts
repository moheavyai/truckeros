import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberProfile, TeamMemberListItem, TeamMemberProfile } from '@/types/member-profile'
import {
  buildDriverSelectOptions,
  defaultPermitDriverStorageKey,
  driverSelectionKey,
  EMPTY_PERMIT_CARRIER_DRIVER_FIELDS,
  filterDriverTeamMembers,
  formatDriverSummaryLine,
  formatDriverDetailLine,
  isDriverCdlMissing,
  getDriverCdlStatus,
  driverCdlStatusLabel,
  clearDefaultPermitDriverKey,
  getDefaultPermitDriverKey,
  memberProfileToPermitAutofill,
  mergePermitAutofillPatch,
  parseDriverSelectionKey,
  permitFormToLoadDetailsCarrierFields,
  pickPermitCarrierDriverFields,
  resolveDriverProfileForSelection,
  resolveOrgCarrierProfileForAutofill,
  setDefaultPermitDriverKey,
  sortDriverSelectOptionsWithDefault,
} from './permit-profile-autofill'

const ownerProfile: MemberProfile = {
  id: 'owner-row',
  user_id: 'owner-user',
  organization_id: 'org-1',
  is_primary_owner: true,
  company_name: 'Acme Hauling LLC',
  usdot_number: '1234567',
  mc_number: 'MC-999',
  ein: '12-3456789',
  carrier_address: '100 Main St, Dallas, TX',
  carrier_phone: '(555) 111-2222',
  carrier_email: 'dispatch@acme.com',
  insurance_contact: 'Agent Smith',
  driver_full_name: 'Alex Owner',
  cdl_number: 'O1234567',
  cdl_state: 'TX',
  driver_phone: '(555) 333-4444',
  driver_email: 'alex@acme.com',
  date_of_birth: '1980-01-15',
  emergency_contact: 'Pat Owner (555) 000-1111',
  user_roles: ['Owner / Admin'],
}

const driverProfile: MemberProfile = {
  id: 'driver-row',
  user_id: 'driver-user',
  organization_id: 'org-1',
  is_primary_owner: false,
  driver_full_name: 'Dana Driver',
  cdl_number: 'D7654321',
  cdl_state: 'OK',
  driver_phone: '(555) 555-6666',
  driver_email: 'dana@email.com',
  emergency_contact: 'Sam Driver',
  user_roles: ['Driver'],
}

const rosterProfile: TeamMemberProfile = {
  id: 'roster-1',
  organization_id: 'org-1',
  created_by_user_id: 'owner-user',
  driver_full_name: 'Riley Roster',
  cdl_number: 'R123',
  cdl_state: 'LA',
  driver_phone: '(555) 777-8888',
  user_roles: ['Driver'],
}

describe('memberProfileToPermitAutofill', () => {
  it('maps carrier and driver fields from a full profile row', () => {
    expect(memberProfileToPermitAutofill(ownerProfile)).toEqual({
      companyName: 'Acme Hauling LLC',
      usdotNumber: '1234567',
      mcNumber: 'MC-999',
      dotNumber: '1234567',
      ein: '12-3456789',
      carrierAddress: '100 Main St, Dallas, TX',
      carrierPhone: '(555) 111-2222',
      carrierEmail: 'dispatch@acme.com',
      insuranceContact: 'Agent Smith',
      driverFullName: 'Alex Owner',
      cdlNumber: 'O1234567',
      cdlState: 'TX',
      driverPhone: '(555) 333-4444',
      driverEmail: 'alex@acme.com',
      dateOfBirth: '1980-01-15',
      emergencyContact: 'Pat Owner (555) 000-1111',
    })
  })

  it('maps driver-only fields when carrier columns are empty', () => {
    expect(memberProfileToPermitAutofill(driverProfile)).toEqual({
      companyName: '',
      usdotNumber: '',
      mcNumber: '',
      dotNumber: '',
      ein: '',
      carrierAddress: '',
      carrierPhone: '',
      carrierEmail: '',
      insuranceContact: '',
      driverFullName: 'Dana Driver',
      cdlNumber: 'D7654321',
      cdlState: 'OK',
      driverPhone: '(555) 555-6666',
      driverEmail: 'dana@email.com',
      dateOfBirth: '',
      emergencyContact: 'Sam Driver',
    })
  })

  it('fills carrier from carrierSource when driver row lacks carrier columns', () => {
    expect(memberProfileToPermitAutofill(driverProfile, { carrierSource: ownerProfile })).toEqual({
      companyName: 'Acme Hauling LLC',
      usdotNumber: '1234567',
      mcNumber: 'MC-999',
      dotNumber: '1234567',
      ein: '12-3456789',
      carrierAddress: '100 Main St, Dallas, TX',
      carrierPhone: '(555) 111-2222',
      carrierEmail: 'dispatch@acme.com',
      insuranceContact: 'Agent Smith',
      driverFullName: 'Dana Driver',
      cdlNumber: 'D7654321',
      cdlState: 'OK',
      driverPhone: '(555) 555-6666',
      driverEmail: 'dana@email.com',
      dateOfBirth: '',
      emergencyContact: 'Sam Driver',
    })
  })

  it('returns empty patch for null profile', () => {
    expect(memberProfileToPermitAutofill(null)).toEqual({})
  })
})

describe('resolveOrgCarrierProfileForAutofill', () => {
  it('prefers actor profile when it has carrier data', () => {
    expect(resolveOrgCarrierProfileForAutofill(ownerProfile, [driverProfile])).toEqual(ownerProfile)
  })

  it('falls back to first org member with carrier data', () => {
    expect(resolveOrgCarrierProfileForAutofill(driverProfile, [driverProfile, ownerProfile])).toEqual(
      ownerProfile
    )
  })
})

describe('mergePermitAutofillPatch', () => {
  const existingCarrierDriver = {
    ...EMPTY_PERMIT_CARRIER_DRIVER_FIELDS,
    companyName: 'Acme Hauling LLC',
    usdotNumber: '1234567',
    mcNumber: 'MC-999',
    dotNumber: '1234567',
    driverFullName: 'Alex Owner',
  }

  it('preserves existing carrier fields when patch carrier values are empty', () => {
    const driverOnlyPatch = memberProfileToPermitAutofill(driverProfile)
    expect(mergePermitAutofillPatch(existingCarrierDriver, driverOnlyPatch)).toEqual({
      companyName: 'Acme Hauling LLC',
      usdotNumber: '1234567',
      mcNumber: 'MC-999',
      dotNumber: '1234567',
      ein: '',
      carrierAddress: '',
      carrierPhone: '',
      carrierEmail: '',
      insuranceContact: '',
      driverFullName: 'Dana Driver',
      cdlNumber: 'D7654321',
      cdlState: 'OK',
      driverPhone: '(555) 555-6666',
      driverEmail: 'dana@email.com',
      dateOfBirth: '',
      emergencyContact: 'Sam Driver',
    })
  })

  it('overwrites driver fields from patch including empty values', () => {
    expect(
      mergePermitAutofillPatch(existingCarrierDriver, {
        driverFullName: 'New Driver',
        driverEmail: '',
      })
    ).toMatchObject({
      companyName: 'Acme Hauling LLC',
      driverFullName: 'New Driver',
      driverEmail: '',
    })
  })

  it('documents deselect reset: merge keeps carrier but direct spread clears all fields', () => {
    expect(mergePermitAutofillPatch(existingCarrierDriver, EMPTY_PERMIT_CARRIER_DRIVER_FIELDS)).toEqual({
      ...existingCarrierDriver,
      driverFullName: '',
      cdlNumber: '',
      cdlState: '',
      driverPhone: '',
      driverEmail: '',
      dateOfBirth: '',
      emergencyContact: '',
    })

    expect(
      pickPermitCarrierDriverFields({
        ...existingCarrierDriver,
        weight: 80000,
      } as never)
    ).toEqual(existingCarrierDriver)

    expect({ ...existingCarrierDriver, ...EMPTY_PERMIT_CARRIER_DRIVER_FIELDS }).toEqual(
      EMPTY_PERMIT_CARRIER_DRIVER_FIELDS
    )
  })
})

const driverListItem: TeamMemberListItem = {
  id: 'driver-row',
  source: 'member_profile',
  user_id: 'driver-user',
  display_name: 'Dana Driver',
  user_roles: ['Driver'],
  driver_summary: 'CDL D7654321 (OK)',
  is_self: false,
}

const permitClerkListItem: TeamMemberListItem = {
  id: 'clerk-1',
  source: 'team_member_profile',
  display_name: 'Pat Clerk',
  user_roles: ['Permit Clerk'],
  driver_summary: 'CDL R123 (LA)',
  is_self: false,
}

const ownerOnlyListItem: TeamMemberListItem = {
  id: 'owner-row',
  source: 'member_profile',
  user_id: 'owner-user',
  display_name: 'Alex Owner',
  user_roles: ['Owner / Admin'],
  driver_summary: 'CDL O1234567 (TX)',
  is_self: true,
}

describe('filterDriverTeamMembers', () => {
  it('keeps only members with the Driver role', () => {
    expect(
      filterDriverTeamMembers([driverListItem, permitClerkListItem, ownerOnlyListItem])
    ).toEqual([driverListItem])
  })
})

describe('buildDriverSelectOptions', () => {
  it('builds labels with display name and driver summary, excluding non-drivers', () => {
    const teamMembers: TeamMemberListItem[] = [
      driverListItem,
      permitClerkListItem,
      {
        id: 'roster-1',
        source: 'team_member_profile',
        display_name: 'Riley Roster',
        user_roles: ['Driver'],
        driver_summary: 'CDL R123 (LA)',
        is_self: false,
      },
    ]

    expect(buildDriverSelectOptions(teamMembers)).toEqual([
      { id: 'driver-row', label: 'Dana Driver — CDL D7654321 (OK)', source: 'member_profile' },
      { id: 'roster-1', label: 'Riley Roster — CDL R123 (LA)', source: 'team_member_profile' },
    ])
  })

  it('falls back to display name when driver summary is empty', () => {
    expect(
      buildDriverSelectOptions([
        {
          ...driverListItem,
          driver_summary: 'No driver details',
        },
      ])
    ).toEqual([{ id: 'driver-row', label: 'Dana Driver', source: 'member_profile' }])
  })
})

describe('sortDriverSelectOptionsWithDefault', () => {
  it('marks default driver with a star and moves it to the top', () => {
    const options = buildDriverSelectOptions([
      driverListItem,
      {
        id: 'roster-1',
        source: 'team_member_profile',
        display_name: 'Riley Roster',
        user_roles: ['Driver'],
        driver_summary: 'CDL R123 (LA)',
        is_self: false,
      },
    ])
    const defaultKey = driverSelectionKey({ id: 'roster-1', source: 'team_member_profile' })

    expect(sortDriverSelectOptionsWithDefault(options, defaultKey)).toEqual([
      {
        id: 'roster-1',
        label: '★ Riley Roster — CDL R123 (LA)',
        source: 'team_member_profile',
        isDefault: true,
      },
      {
        id: 'driver-row',
        label: 'Dana Driver — CDL D7654321 (OK)',
        source: 'member_profile',
        isDefault: false,
      },
    ])
  })

  it('marks default with a star without reordering when it is already first', () => {
    const options = buildDriverSelectOptions([driverListItem])
    const defaultKey = driverSelectionKey({ id: 'driver-row', source: 'member_profile' })

    expect(sortDriverSelectOptionsWithDefault(options, defaultKey)).toEqual([
      {
        id: 'driver-row',
        label: '★ Dana Driver — CDL D7654321 (OK)',
        source: 'member_profile',
        isDefault: true,
      },
    ])
  })
})

describe('default permit driver localStorage helpers', () => {
  const orgId = 'org-1'
  const storageKey = defaultPermitDriverStorageKey(orgId)

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null
      },
      setItem(key: string, value: string) {
        this.store[key] = value
      },
      removeItem(key: string) {
        delete this.store[key]
      },
    })
    vi.stubGlobal('window', {
      localStorage: (globalThis as { localStorage: Storage }).localStorage,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads and writes per-organization default driver keys', () => {
    const compositeKey = 'member_profile:driver-row'

    setDefaultPermitDriverKey(orgId, compositeKey)
    expect(localStorage.getItem(storageKey)).toBe(compositeKey)
    expect(getDefaultPermitDriverKey(orgId)).toBe(compositeKey)
  })

  it('clears stored default driver key', () => {
    setDefaultPermitDriverKey(orgId, 'member_profile:driver-row')
    clearDefaultPermitDriverKey(orgId)
    expect(localStorage.getItem(storageKey)).toBeNull()
    expect(getDefaultPermitDriverKey(orgId)).toBeNull()
  })

  it('returns null when organization id is missing', () => {
    expect(getDefaultPermitDriverKey(null)).toBeNull()
    expect(setDefaultPermitDriverKey(null, 'member_profile:driver-row')).toBeUndefined()
    expect(clearDefaultPermitDriverKey(null)).toBeUndefined()
  })
})

describe('resolveDriverProfileForSelection', () => {
  it('resolves member_profile rows from org members', () => {
    const selection = { id: 'driver-row', source: 'member_profile' as const }
    expect(
      resolveDriverProfileForSelection(selection, [ownerProfile, driverProfile], [], ownerProfile)
    ).toEqual(driverProfile)
  })

  it('falls back to actor profile when org list is partial', () => {
    const selection = { id: 'owner-user', source: 'member_profile' as const }
    expect(resolveDriverProfileForSelection(selection, [], [], ownerProfile)).toEqual(ownerProfile)
  })

  it('resolves team_member_profile rows from roster', () => {
    const selection = { id: 'roster-1', source: 'team_member_profile' as const }
    expect(
      resolveDriverProfileForSelection(selection, [ownerProfile], [rosterProfile], ownerProfile)
    ).toEqual(rosterProfile)
  })

  it('returns null for unknown selection', () => {
    expect(
      resolveDriverProfileForSelection(
        { id: 'missing', source: 'member_profile' },
        [ownerProfile],
        [],
        ownerProfile
      )
    ).toBeNull()
  })
})

describe('driver selection key helpers', () => {
  it('round-trips composite keys', () => {
    const key = driverSelectionKey({ id: 'driver-row', source: 'member_profile' })
    expect(key).toBe('member_profile:driver-row')
    expect(parseDriverSelectionKey(key)).toEqual({
      id: 'driver-row',
      source: 'member_profile',
    })
  })

  it('returns null for invalid keys', () => {
    expect(parseDriverSelectionKey('')).toBeNull()
    expect(parseDriverSelectionKey('invalid')).toBeNull()
  })
})

describe('formatDriverSummaryLine', () => {
  it('formats first name and driver id only', () => {
    expect(
      formatDriverSummaryLine({
        driverFullName: 'Dana Driver',
        driverId: '4444444444',
      })
    ).toBe('Dana #4444444444')
  })

  it('returns a single dash when all fields are empty', () => {
    expect(
      formatDriverSummaryLine({
        driverFullName: '',
        driverId: '',
      })
    ).toBe('—')
  })

  it('uses first name only when no driver id', () => {
    expect(
      formatDriverSummaryLine({
        driverFullName: 'Dana Driver',
        driverId: '',
      })
    ).toBe('Dana')
  })

  it('uses #id only when no name', () => {
    expect(
      formatDriverSummaryLine({
        driverFullName: '',
        driverId: '12345',
      })
    ).toBe('#12345')
  })

  it('ignores phone and CDL (not included in smart title)', () => {
    expect(
      formatDriverSummaryLine({
        driverFullName: 'Riley Roster',
        driverId: '999',
      })
    ).toBe('Riley #999')
  })
})

describe('formatDriverDetailLine', () => {
  it('formats full name, phone, CDL, and expiration', () => {
    expect(
      formatDriverDetailLine({
        driverFullName: 'Dana Driver',
        driverPhone: '(555) 555-6666',
        cdlNumber: 'D7654321',
        cdlState: 'OK',
        cdlExpiration: '2026-12-01',
      })
    ).toBe('Dana Driver · (555) 555-6666 · CDL D7654321 (OK) · exp 2026-12-01')
  })

  it('omits empty parts', () => {
    expect(
      formatDriverDetailLine({
        driverFullName: '',
        driverPhone: '',
        cdlNumber: 'D7654321',
        cdlState: '',
        cdlExpiration: '',
      })
    ).toBe('CDL D7654321')
  })

  it('returns dash when nothing present', () => {
    expect(
      formatDriverDetailLine({
        driverFullName: '',
        driverPhone: '',
        cdlNumber: '',
        cdlState: '',
        cdlExpiration: '',
      })
    ).toBe('—')
  })
})

describe('isDriverCdlMissing', () => {
  it('is true when cdl number is blank', () => {
    expect(isDriverCdlMissing({ cdlNumber: '' })).toBe(true)
    expect(isDriverCdlMissing({ cdlNumber: '  ' })).toBe(true)
  })

  it('is false when cdl number is present', () => {
    expect(isDriverCdlMissing({ cdlNumber: 'D123' })).toBe(false)
  })
})

describe('getDriverCdlStatus', () => {
  const today = new Date(2026, 7, 16) // Aug 16, 2026 local

  it('returns missing when number is blank', () => {
    expect(getDriverCdlStatus({ cdlNumber: '', cdlExpiration: '2027-01-01' }, today)).toBe('missing')
  })

  it('returns ok when number present and no expiration', () => {
    expect(getDriverCdlStatus({ cdlNumber: 'D1', cdlExpiration: '' }, today)).toBe('ok')
  })

  it('returns expired when expiration is in the past', () => {
    expect(getDriverCdlStatus({ cdlNumber: 'D1', cdlExpiration: '2026-08-15' }, today)).toBe('expired')
  })

  it('returns expiring_soon within 30 days', () => {
    expect(getDriverCdlStatus({ cdlNumber: 'D1', cdlExpiration: '2026-09-01' }, today)).toBe(
      'expiring_soon'
    )
  })

  it('returns ok when expiration is beyond 30 days', () => {
    expect(getDriverCdlStatus({ cdlNumber: 'D1', cdlExpiration: '2027-01-01' }, today)).toBe('ok')
  })
})

describe('driverCdlStatusLabel', () => {
  it('labels missing and expired', () => {
    expect(driverCdlStatusLabel('missing')).toBe('CDL missing')
    expect(driverCdlStatusLabel('expired')).toBe('CDL expired')
  })

  it('includes expiration date when expiring soon', () => {
    expect(driverCdlStatusLabel('expiring_soon', { cdlExpiration: '2026-09-01' })).toBe(
      'CDL expires 2026-09-01'
    )
  })

  it('returns null for ok', () => {
    expect(driverCdlStatusLabel('ok')).toBeNull()
  })
})

describe('permitFormToLoadDetailsCarrierFields', () => {
  it('prefers dotNumber but falls back to usdotNumber', () => {
    expect(
      permitFormToLoadDetailsCarrierFields({
        dotNumber: '',
        usdotNumber: '1234567',
        mcNumber: 'MC-999',
      })
    ).toEqual({ dotNumber: '1234567', mcNumber: 'MC-999' })
  })

  it('omits empty carrier identifiers', () => {
    expect(
      permitFormToLoadDetailsCarrierFields({
        dotNumber: '',
        usdotNumber: '  ',
        mcNumber: '',
      })
    ).toEqual({})
  })
})