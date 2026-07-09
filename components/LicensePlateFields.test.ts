import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

describe('LicensePlateFields component module', () => {
  it('is defined in a standalone file outside EquipmentPage', () => {
    const filePath = path.join(process.cwd(), 'components', 'LicensePlateFields.tsx')
    const source = readFileSync(filePath, 'utf8')

    expect(source).toContain('export default function LicensePlateFields')
    expect(source).toContain('US_STATE_OPTIONS')
    expect(source).toContain('idPrefix')
  })

  it('is not re-defined inside equipment page', () => {
    const filePath = path.join(process.cwd(), 'app', 'equipment', 'page.tsx')
    const source = readFileSync(filePath, 'utf8')

    expect(source).not.toMatch(/function LicensePlateFields\s*\(/)
    expect(source).toContain("import LicensePlateFields from '@/components/LicensePlateFields'")
  })
})

describe('Equipment page license plate focus regression', () => {
  it('uses functional setState for plate fields without remounting keys', () => {
    const filePath = path.join(process.cwd(), 'app', 'equipment', 'page.tsx')
    const source = readFileSync(filePath, 'utf8')

    expect(source).toContain(
      'setEditingTractor((prev) => (prev ? { ...prev, license_plate: value } : prev))'
    )
    expect(source).toContain('setEditingTractor((prev) =>')
    expect(source).toContain(
      'setEditingTrailer((prev) => (prev ? { ...prev, license_plate: value } : prev))'
    )
    expect(source).toContain('setEditingTrailer((prev) =>')
    expect(source).not.toMatch(/key=\{[^}]*license_plate/)
    expect(source).not.toMatch(/key=\{[^}]*plate/)
  })
})