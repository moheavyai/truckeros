import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import {
  equipmentOrganizationIdForSave,
  equipmentProfilesLoadOrFilter,
  shouldUseOrganizationEquipmentFilter,
} from './equipment-persistence'

describe('equipmentOrganizationIdForSave', () => {
  it('returns trimmed organization id when present', () => {
    expect(equipmentOrganizationIdForSave(' org-1 ')).toBe('org-1')
  })

  it('returns null when organization is unset', () => {
    expect(equipmentOrganizationIdForSave(null)).toBeNull()
    expect(equipmentOrganizationIdForSave(undefined)).toBeNull()
    expect(equipmentOrganizationIdForSave('   ')).toBeNull()
  })
})

describe('equipmentProfilesLoadOrFilter', () => {
  it('includes org rows and legacy null-org rows for the owner', () => {
    expect(equipmentProfilesLoadOrFilter('org-1', 'user-1')).toBe(
      'organization_id.eq.org-1,and(organization_id.is.null,user_id.eq.user-1)'
    )
  })
})

describe('shouldUseOrganizationEquipmentFilter', () => {
  it('is true when scope has organizationId', () => {
    expect(
      shouldUseOrganizationEquipmentFilter({
        organizationId: 'org-1',
        rigOwnerUserId: 'user-1',
        canLoadEquipment: true,
        canLoadRigs: true,
      })
    ).toBe(true)
  })

  it('is false when organizationId is missing', () => {
    expect(
      shouldUseOrganizationEquipmentFilter({
        organizationId: null,
        rigOwnerUserId: 'user-1',
        canLoadEquipment: true,
        canLoadRigs: true,
      })
    ).toBe(false)
  })
})

describe('equipment page persistence wiring', () => {
  it('stamps organization_id on tractor and trailer saves and uses org-aware load filter', () => {
    const source = readFileSync(path.join(process.cwd(), 'app', 'equipment', 'page.tsx'), 'utf8')

    expect(source).toContain('equipmentOrganizationIdForSave')
    expect(source).toContain('equipmentProfilesLoadOrFilter')
    expect(source).toContain('shouldUseOrganizationEquipmentFilter')
    expect(source).toMatch(/saveTractor[\s\S]*equipmentOrganizationIdForSave\(ownOrganizationId\)/)
    expect(source).toMatch(/saveTrailer[\s\S]*equipmentOrganizationIdForSave\(ownOrganizationId\)/)
    expect(source).toMatch(/dbPayload\.organization_id = organizationId/)
    expect(source).toMatch(/query\.or\(\s*equipmentProfilesLoadOrFilter/)
  })
})