import { describe, expect, it } from 'vitest'
import {
  applyDriverRestrictedFieldBaseline,
  canDirectlyPersistProfileField,
  canEditProfileField,
  detectRestrictedFieldChanges,
  DRIVER_EDITABLE_FIELD_KEYS,
  DRIVER_RESTRICTED_FIELD_KEYS,
  hasDriverRole,
  hasFullProfileEditAccess,
  hasPendingRestrictedFieldEdits,
  isDriverRestrictedField,
  isDriverSelfServiceActor,
  requiresAdminApproval,
} from './profile-field-permissions'
import { emptyMemberProfileForm } from './member-profile'
import type { MemberProfile } from '@/types/member-profile'

const ownerProfile: MemberProfile = {
  user_id: 'owner-1',
  is_primary_owner: true,
  user_roles: ['Owner / Admin'],
}

const driverProfile: MemberProfile = {
  user_id: 'driver-1',
  is_primary_owner: false,
  user_roles: ['Driver'],
}

describe('isDriverRestrictedField', () => {
  it('marks identity fields as restricted', () => {
    for (const key of DRIVER_RESTRICTED_FIELD_KEYS) {
      expect(isDriverRestrictedField(key)).toBe(true)
      expect(requiresAdminApproval(key)).toBe(true)
    }
    expect(isDriverRestrictedField('driver_phone')).toBe(false)
  })
})

describe('role helpers', () => {
  it('detects driver and full-edit actors', () => {
    expect(hasDriverRole(driverProfile)).toBe(true)
    expect(hasFullProfileEditAccess(driverProfile)).toBe(false)
    expect(hasFullProfileEditAccess(ownerProfile)).toBe(true)
    expect(hasDriverRole(ownerProfile)).toBe(false)
  })

  it('treats dual-role Driver+Owner/Admin as full-edit, not self-service driver', () => {
    const dualRoleProfile: MemberProfile = {
      user_id: 'dual-1',
      is_primary_owner: false,
      user_roles: ['Driver', 'Owner / Admin'],
    }

    expect(hasDriverRole(dualRoleProfile)).toBe(true)
    expect(hasFullProfileEditAccess(dualRoleProfile)).toBe(true)
    expect(isDriverSelfServiceActor(dualRoleProfile)).toBe(false)
    expect(canDirectlyPersistProfileField(dualRoleProfile, 'driver_full_name')).toBe(true)
  })

  it('grants full field access when actor is null (pre-profile bootstrap only)', () => {
    expect(canEditProfileField(null, 'company_name')).toBe(true)
    expect(canEditProfileField(null, 'driver_full_name')).toBe(true)
    expect(canDirectlyPersistProfileField(null, 'driver_full_name')).toBe(true)
  })
})

describe('canEditProfileField', () => {
  it('grants owners full field access', () => {
    expect(canEditProfileField(ownerProfile, 'company_name')).toBe(true)
    expect(canEditProfileField(ownerProfile, 'driver_full_name')).toBe(true)
    expect(canDirectlyPersistProfileField(ownerProfile, 'driver_full_name')).toBe(true)
  })

  it('allows drivers to edit contact fields directly', () => {
    for (const key of DRIVER_EDITABLE_FIELD_KEYS) {
      expect(canEditProfileField(driverProfile, key)).toBe(true)
      expect(canDirectlyPersistProfileField(driverProfile, key)).toBe(true)
    }
  })

  it('allows drivers to edit restricted fields in UI but not persist directly', () => {
    expect(canEditProfileField(driverProfile, 'driver_full_name')).toBe(true)
    expect(canDirectlyPersistProfileField(driverProfile, 'driver_full_name')).toBe(false)
    expect(canEditProfileField(driverProfile, 'company_name')).toBe(false)
    expect(canEditProfileField(driverProfile, 'user_roles')).toBe(false)
  })
})

describe('detectRestrictedFieldChanges', () => {
  it('detects changed restricted values against baseline', () => {
    const baseline = {
      ...emptyMemberProfileForm(),
      driver_full_name: 'Jane Doe',
      cdl_number: 'D123',
    }
    const form = {
      ...baseline,
      driver_full_name: 'Janet Doe',
      driver_phone: '(555) 111-2222',
    }

    expect(detectRestrictedFieldChanges(form, baseline)).toEqual([
      {
        fieldKey: 'driver_full_name',
        currentValue: 'Jane Doe',
        requestedValue: 'Janet Doe',
      },
    ])
    expect(hasPendingRestrictedFieldEdits(form, baseline)).toBe(true)
  })

  it('detects each restricted field key individually', () => {
    const baseline = emptyMemberProfileForm()

    for (const fieldKey of DRIVER_RESTRICTED_FIELD_KEYS) {
      const form = {
        ...baseline,
        [fieldKey]: fieldKey === 'date_of_birth' ? '1990-01-01' : `updated-${fieldKey}`,
      }

      expect(detectRestrictedFieldChanges(form, baseline)).toEqual([
        {
          fieldKey,
          currentValue: null,
          requestedValue: fieldKey === 'date_of_birth' ? '1990-01-01' : `updated-${fieldKey}`,
        },
      ])
    }
  })

  it('treats whitespace-only differences as unchanged', () => {
    const baseline = {
      ...emptyMemberProfileForm(),
      driver_full_name: 'Jane Doe',
      cdl_state: 'TX',
    }
    const form = {
      ...baseline,
      driver_full_name: '  Jane Doe  ',
      cdl_state: ' TX ',
    }

    expect(detectRestrictedFieldChanges(form, baseline)).toEqual([])
    expect(hasPendingRestrictedFieldEdits(form, baseline)).toBe(false)
  })

  it('reverts restricted fields to baseline for direct driver saves', () => {
    const baseline = {
      ...emptyMemberProfileForm(),
      driver_full_name: 'Jane Doe',
      driver_phone: '555-0000',
    }
    const form = {
      ...baseline,
      driver_full_name: 'Janet Doe',
      driver_phone: '555-9999',
    }

    expect(applyDriverRestrictedFieldBaseline(form, baseline)).toMatchObject({
      driver_full_name: 'Jane Doe',
      driver_phone: '555-9999',
    })
  })
})