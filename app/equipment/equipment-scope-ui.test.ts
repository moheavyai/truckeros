/**
 * Equipment page service-mode scope tests use static source inspection.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const equipmentPagePath = path.join(process.cwd(), 'app', 'equipment', 'page.tsx')

function readEquipmentSource() {
  return readFileSync(equipmentPagePath, 'utf8')
}

describe('Equipment page — service mode scoping', () => {
  it('skips equipment loads without a selected carrier in service mode', () => {
    const source = readEquipmentSource()

    expect(source).toContain('isServiceModeReadOnly')
    expect(source).toContain("workspaceMode === 'service' && !effectiveOrganizationId")
    expect(source).toContain('resolveEquipmentScope')
    expect(source).toContain('canLoadEquipment')
    expect(source).toContain('canLoadRigs')
    expect(source).toContain('rigOwnerUserId')
    expect(source).toContain('equipmentProfilesLoadOrFilter')
    expect(source).toContain('equipmentOrganizationIdForSave')
  })

  it('blocks create/edit/delete actions in service mode', () => {
    const source = readEquipmentSource()

    expect(source).toContain('if (isServiceModeReadOnly) return')
    expect(source).toContain('equipment is read-only')
    expect(source).toContain('result.userId')
    expect(source).toContain('carrierPrimaryOwnerError')
    expect(source).toContain('loadingPrimaryOwner')
    expect(source).toContain('saveTractor')
    expect(source).toContain('saveTrailer')
    expect(source).toContain('saveCurrentRig')
    expect(source).toContain('deleteRig')
  })

  it('shows empty-state CTA when no carrier is selected', () => {
    const source = readEquipmentSource()

    expect(source).toContain('Select a carrier in the workspace bar above')
  })
})